// Import der Produktkategorien-Matrix (CSV; Spalten Hauptkategorie, Unterkategorie, optional Code) in den bestehenden Kategorienbaum
// (settings.billing.warengruppen). Rein rechnerisch und ohne Browser-APIs, damit es sich in Node testen lässt (scripts/test-wpc.mjs).
// Zusammenführen heisst: Vorhandenes bleibt unverändert (IDs, Codes, Nummernbereiche, Namen), nur Fehlendes wird ergänzt – nichts wird gelöscht oder umbenannt.
import { uid } from "./util.js";

/** Vorlage zum Herunterladen: Beispiele für die erwartete Struktur (Semikolon, damit Excel sie direkt öffnet) */
export const TEMPLATE_ROWS = [
  ["Hauptkategorie", "Unterkategorie", "Code"],
  ["Gewindestangen", "Gewindestangen verzinkt", "GS"],
  ["Gewindestangen", "Gewindestangen Edelstahl A2", "GS"],
  ["Gewindestangen", "Gewindestangen Edelstahl A4", "GS"],
  ["Rohrschellen", "Rohrschellen mit Gummieinlage", "RS"],
  ["Rohrschellen", "Rohrschellen ohne Einlage", "RS"],
  ["Rohrschellen", "Rohrschellen Schnellmontage", "RS"],
  ["Hänger/Abhängungen", "Rohrhänger", "HA"],
  ["Hänger/Abhängungen", "Schnellabhänger", "HA"],
  ["Hänger/Abhängungen", "Gewindestangenhänger", "HA"],
  ["Schrauben/Bolzen", "Sechskantschrauben", "SB"],
  ["Schrauben/Bolzen", "Ankerbolzen", "SB"],
  ["Schrauben/Bolzen", "Gewindebolzen", "SB"],
  ["Schrauben/Bolzen", "Holzschrauben", "SB"],
];
const q = (v) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const templateCsv = () => TEMPLATE_ROWS.map((r) => r.map(q).join(";")).join("\r\n") + "\r\n";

/** CSV in Zeilen/Zellen zerlegen (Anführungszeichen, "" als Escape, CRLF/LF, Trennzeichen ; , oder Tab – automatisch erkannt an der Kopfzeile, BOM wird entfernt) */
export function parseCsv(text) {
  text = String(text ?? "").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const count = (ch) => (firstLine.match(new RegExp(ch === "\t" ? "\t" : `\\${ch}`, "g")) || []).length;
  const delim = [";", ",", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const sep = delim[1] ? delim[0] : ";";
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"' && cell === "") inQ = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== "")), delimiter: sep };
}

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const HEAD = {
  haupt: ["hauptkategorie", "haupt-kategorie", "main category", "maincategory", "warengruppe", "kategorie", "category"],
  unter: ["unterkategorie", "unter-kategorie", "subcategory", "sub category", "sub-category", "unterkat."],
  code: ["code", "kürzel", "kuerzel", "kategoriecode"],
};

/**
 * Matrix lesen. @returns {{ rows: {line:number, haupt:string, unter:string, code:string}[], errors: string[] (Schlüssel + Parameter), delimiter }}
 * errors: [{ key, params }] mit i18n-Schlüsseln (cat.imp.err.*)
 */
export function parseMatrix(text) {
  const { rows: raw, delimiter } = parseCsv(text);
  const errors = [];
  if (!raw.length) return { rows: [], errors: [{ key: "cat.imp.err.empty", params: {} }], delimiter };
  const head = raw[0].map(norm);
  const col = (names) => head.findIndex((h) => names.includes(h));
  const iH = col(HEAD.haupt), iU = col(HEAD.unter), iC = col(HEAD.code);
  if (iH < 0) return { rows: [], errors: [{ key: "cat.imp.err.noHeader", params: {} }], delimiter };
  const rows = [];
  raw.slice(1).forEach((r, i) => {
    const line = i + 2;
    const haupt = (r[iH] || "").trim();
    const unter = iU >= 0 ? (r[iU] || "").trim() : "";
    const code = iC >= 0 ? (r[iC] || "").trim() : "";
    if (!haupt) { errors.push({ key: "cat.imp.err.noMain", params: { line } }); return; }
    if (code.length > 12) { errors.push({ key: "cat.imp.err.codeLong", params: { line, code } }); return; }
    rows.push({ line, haupt, unter, code });
  });
  return { rows, errors, delimiter };
}

const subsOf = (g) => (Array.isArray(g?.unterkategorien) ? g.unterkategorien.filter((s) => s && typeof s === "object" && s.id && String(s.name || "").trim()) : []);

/**
 * Vorschau: was würde mit dem bestehenden Baum geschehen?
 * @returns {{ items: {line, haupt, unter, code, main: "existing"|"new", sub: ""|"existing"|"new"|"dup", warn: string}[],
 *   newMain: number, newSub: number, existing: number, dup: number, warnings: {key, params}[] }}
 * Zeilen derselben Hauptkategorie dürfen mehrfach vorkommen (eine Zeile je Unterkategorie); gleiche Namen auf derselben Ebene zählen nur einmal.
 */
export function planMerge(groups, rows) {
  const mainByName = new Map(groups.map((g) => [norm(g.name), g]));
  const codes = new Map(groups.map((g) => [norm(g.code), g]));
  const seenMain = new Set(), seenSub = new Set(), codeOf = new Map();
  const items = [];
  const warnings = [];
  let newMain = 0, newSub = 0, existing = 0, dup = 0;
  for (const r of rows) {
    const key = norm(r.haupt);
    const g = mainByName.get(key);
    let main = g ? "existing" : "new";
    let warn = "";
    if (r.code) {
      const prev = codeOf.get(key);
      if (prev && norm(prev) !== norm(r.code)) { warnings.push({ key: "cat.imp.warn.codeDiffers", params: { line: r.line, name: r.haupt, code: prev } }); warn = "codeDiffers"; }
      else if (!prev) codeOf.set(key, r.code);
      if (!g && !prev) {
        const taken = codes.get(norm(r.code));
        if (taken) { warnings.push({ key: "cat.imp.warn.codeTaken", params: { line: r.line, code: r.code, name: taken.name } }); warn = "codeTaken"; }
      } else if (g && norm(g.code) !== norm(r.code) && !prev) {
        warnings.push({ key: "cat.imp.warn.codeKept", params: { line: r.line, name: g.name, code: g.code } });
      }
    }
    if (!seenMain.has(key)) { seenMain.add(key); if (g) existing++; else newMain++; }
    let sub = "";
    if (r.unter) {
      const sk = key + "\u0000" + norm(r.unter);
      const has = g && subsOf(g).some((s) => norm(s.name) === norm(r.unter));
      if (seenSub.has(sk)) { sub = "dup"; dup++; } else { seenSub.add(sk); sub = has ? "existing" : "new"; if (!has) newSub++; }
    }
    items.push({ ...r, main, sub, warn });
  }
  return { items, newMain, newSub, existing, dup, warnings };
}

function nextCode(used) {
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c.toLowerCase())) return c; }
  for (let n = 1; ; n++) if (!used.has(("G" + n).toLowerCase())) return "G" + n;
}

/**
 * Zusammenführen → neue Warengruppenliste. Vorhandene Einträge (ids, Namen, Codes, Nummernbereiche, Unterkategorien) bleiben unverändert,
 * Fehlendes wird angehängt (Nummernbereich: die nächsten 100 Nummern, wie beim Anlegen im Formular).
 * @param {object[]} groups bestehende Warengruppen (werden nicht verändert)
 * @param {{haupt, unter, code}[]} rows aus parseMatrix
 * @param {() => string} newId liefert eine eindeutige ID (Standard: uid)
 */
export function applyMerge(groups, rows, newId = uid) {
  const out = groups.map((g) => ({ ...g, unterkategorien: subsOf(g).map((s) => ({ ...s })) }));
  // Unterkategorien, die ungültig waren (ohne Name), nicht verlieren: Originalfelder bleiben, falls nichts ergänzt wird
  const byName = new Map(out.map((g) => [norm(g.name), g]));
  const usedCodes = new Set(out.map((g) => norm(g.code)));
  let maxBis = out.reduce((m, g) => Math.max(m, Number(g.bis) || 0), 0);
  for (const r of rows) {
    const key = norm(r.haupt);
    let g = byName.get(key);
    if (!g) {
      const von = maxBis ? maxBis + 1 : 100001;
      maxBis = von + 99;
      const code = r.code && !usedCodes.has(norm(r.code)) ? r.code : nextCode(usedCodes);
      usedCodes.add(norm(code));
      g = { id: "wg_" + newId().slice(0, 8), code, name: r.haupt, von, bis: von + 99, unterkategorien: [] };
      out.push(g);
      byName.set(key, g);
    }
    if (r.unter && !g.unterkategorien.some((s) => norm(s.name) === norm(r.unter))) g.unterkategorien.push({ id: "uk_" + newId().slice(0, 8), name: r.unter });
  }
  // unveränderte Gruppen mit unveränderten Unterkategorien exakt wie vorher zurückgeben (inkl. evtl. ungültiger Alt-Einträge)
  return out.map((g, i) => (i < groups.length && g.unterkategorien.length === subsOf(groups[i]).length ? groups[i] : g));
}
