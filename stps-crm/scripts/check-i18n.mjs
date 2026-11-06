#!/usr/bin/env node
// Prüft die Mehrsprachigkeit (Deutsch/Englisch) – Aufruf: node scripts/check-i18n.mjs  (npm run check:i18n)
//
//  1. Parität: de.js und en.js haben dieselben Schlüssel, dieselben Pluralformen und dieselben {Platzhalter}.
//  2. Verwendung: jeder im Code mit t()/tn()/th()/tryT()/has() verwendete Schlüssel existiert; ungenutzte Schlüssel werden gemeldet.
//  3. Deutsche Texte im Code: Zeichenketten mit deutschem Wortlaut ausserhalb der Wörterbücher (js/i18n/) werden aufgelistet.
//     Erlaubt sind gespeicherte Datenwerte (js/config.js, js/seed.js), die deutschen CSV-/Excel-Spaltenüberschriften (js/csv.js)
//     und Kommentare. Alles andere gehört in die Wörterbücher.
// Beendet sich mit Code 1, wenn Parität/Verwendung verletzt sind oder (mit --strict) deutsche Texte gefunden werden.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = join(root, "js");
const strict = process.argv.includes("--strict");

const de = (await import(pathToFileURL(join(jsDir, "i18n/de.js")))).default;
const en = (await import(pathToFileURL(join(jsDir, "i18n/en.js")))).default;
const config = await import(pathToFileURL(join(jsDir, "config.js")));
const billing = await import(pathToFileURL(join(jsDir, "billing.js")));

let problems = 0;
const bad = (msg) => { problems++; console.log("  ✗ " + msg); };

// ------------------------------------------------------------ 1. Parität
console.log("1. Parität de ↔ en");
const placeholders = (v) => {
  const parts = typeof v === "string" ? [v] : Object.values(v);
  return [...new Set(parts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(",");
};
const forms = (v) => (typeof v === "string" ? "text" : Object.keys(v).sort().join(","));
for (const k of Object.keys(de)) if (!(k in en)) bad(`fehlt in en.js: ${k}`);
for (const k of Object.keys(en)) if (!(k in de)) bad(`fehlt in de.js: ${k}`);
for (const k of Object.keys(de)) {
  if (!(k in en)) continue;
  if (forms(de[k]) !== forms(en[k]) && !(typeof de[k] === "object" && typeof en[k] === "object")) bad(`Form ungleich (Text/Plural): ${k}`);
  const a = placeholders(de[k]), b = placeholders(en[k]);
  if (a !== b) bad(`Platzhalter ungleich bei ${k}: de {${a}} ↔ en {${b}}`);
  for (const [lang, d] of [["de", de], ["en", en]]) {
    const vals = typeof d[k] === "string" ? [d[k]] : Object.values(d[k]);
    if (vals.some((s) => !s.trim() && !/\.(nr)$/.test(k))) bad(`leerer Text (${lang}): ${k}`);
  }
}
console.log(`   ${Object.keys(de).length} Schlüssel (de), ${Object.keys(en).length} (en)`);

// ------------------------------------------------------------ Quelltext in Zeichenketten zerlegen
/**
 * Findet alle Zeichenketten eines JavaScript-Quelltexts (mit Zeilennummer). Kommentare und Regex-Literale werden übersprungen;
 * bei Template-Strings zählt der feste Text (ohne ${…}); Ausdrücke in ${…} werden rekursiv ebenfalls untersucht.
 */
function literals(src) {
  const out = [];
  const line = (pos) => src.slice(0, pos).split("\n").length;
  function scan(i, end, stopAtBrace) {
    let depth = 0, prev = "";
    while (i < end) {
      const c = src[i], n = src[i + 1];
      if (c === "/" && n === "/") { while (i < end && src[i] !== "\n") i++; continue; }
      if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2); i = i < 0 ? end : i + 2; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1, v = "";
        while (j < end && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") { v += src[j + 1]; j += 2; } else v += src[j++]; }
        out.push({ text: v, line: line(i) });
        i = j + 1; prev = '"'; continue;
      }
      if (c === "`") {
        let j = i + 1, v = "";
        while (j < end && src[j] !== "`") {
          if (src[j] === "\\") { v += src[j + 1]; j += 2; continue; }
          if (src[j] === "$" && src[j + 1] === "{") { j = scan(j + 2, end, true); v += " ⟨…⟩ "; continue; }
          v += src[j++];
        }
        out.push({ text: v, line: line(i), template: true });
        i = j + 1; prev = '"'; continue;
      }
      if (c === "/" && /[(,=:\[!&|?{};]|^$/.test(prev)) { // Regex-Literal
        let j = i + 1, inClass = false;
        while (j < end && src[j] !== "\n") { if (src[j] === "\\") j++; else if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false; else if (src[j] === "/" && !inClass) break; j++; }
        i = j + 1; prev = "x"; continue;
      }
      if (stopAtBrace) { if (c === "{") depth++; else if (c === "}") { if (depth === 0) return i + 1; depth--; } }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return i;
  }
  scan(0, src.length, false);
  return out;
}

const files = (function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "i18n" ? [] : walk(p)) : p.endsWith(".js") ? [p] : [];
  });
})(jsDir);
const lits = new Map(files.map((f) => [f, literals(readFileSync(f, "utf8"))]));

// ------------------------------------------------------------ 2. Verwendung
console.log("2. Verwendete Schlüssel");
const used = new Set();
// val.<Gruppe>.<Wert> (tv/tvAny) und err.<Code>[.<Grund>] (errorText) werden in js/i18n.js zur Laufzeit zusammengesetzt
const prefixes = new Set(["val.", "err."]);
const callRe = /\b(?:t|tn|th|tryT|has)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
for (const f of files) {
  const src = stripComments(readFileSync(f, "utf8"));
  for (const m of src.matchAll(callRe)) {
    const key = m[2];
    if (key.includes("${") || key.endsWith(".")) { prefixes.add(key.split("${")[0]); continue; }
    if (!(key in de)) bad(`${relative(root, f)}: Schlüssel fehlt: ${key}`);
  }
  // Schlüssel, die als Zeichenketten weitergereicht werden (blank: "form.noCustomer", {key: "pres.editRecord"}, "store.offlineCache" …)
  for (const l of lits.get(f)) {
    if (l.text in de) used.add(l.text);
    else if (/^(?:form|store|err|pres|toast)\.[A-Za-z0-9_.]+$/.test(l.text) && !l.text.endsWith(".")) bad(`${relative(root, f)}:${l.line}: Schlüssel fehlt: ${l.text}`);
  }
}
// Statische Texte in index.html: data-i18n="schlüssel" und data-i18n-attr="attr:schlüssel;attr2:schlüssel2"
{
  const page = readFileSync(join(root, "index.html"), "utf8");
  const keys = [
    ...[...page.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
    ...[...page.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(";").map((p) => p.split(":")[1]?.trim()).filter(Boolean)),
  ];
  for (const k of keys) {
    if (!(k in de)) bad(`index.html: Schlüssel fehlt: ${k}`);
    used.add(k);
  }
}
const dynUsed = (k) => [...prefixes].some((p) => k.startsWith(p));
for (const p of prefixes) if (!Object.keys(de).some((k) => k.startsWith(p))) bad(`Präfix ohne Schlüssel: ${p}…`);
const unused = Object.keys(de).filter((k) => !used.has(k) && !dynUsed(k));
console.log(`   ${used.size} Schlüssel als Zeichenkette im Code, ${prefixes.size} dynamische Präfixe: ${[...prefixes].join(" ")}`);
if (unused.length) console.log(`   Hinweis: ${unused.length} Schlüssel ohne erkennbare Verwendung:\n     ${unused.join("\n     ")}`);

// ------------------------------------------------------------ Importe: benannte Importe vorhanden, Übersetzungs-Funktionen importiert
console.log("2a. Importe");
{
  const all = (function walk(dir) {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
    });
  })(jsDir);
  const exportsOf = new Map(all.map((f) => {
    const src = readFileSync(f, "utf8");
    const names = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(",")) if (n.trim()) names.add(n.split(" as ").pop().trim());
    if (/export\s+default/.test(src)) names.add("default");
    return [f, names];
  }));
  const HELPERS = ["t", "tn", "th", "tv", "tvAny", "tryT", "has", "serverText"];
  for (const f of all) {
    const src = stripComments(readFileSync(f, "utf8"));
    const imported = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)) {
      const target = join(dirname(f), m[2]);
      for (const part of m[1].split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (!name) continue;
        imported.add(alias || name);
        if (!exportsOf.has(target)) bad(`${relative(root, f)}: Importziel fehlt: ${m[2]}`);
        else if (!exportsOf.get(target).has(name)) bad(`${relative(root, f)}: «${name}» wird aus ${m[2]} importiert, dort aber nicht exportiert`);
      }
    }
    if (f.includes("/js/i18n/")) continue;
    for (const h of HELPERS) {
      const used = new RegExp(`(?<![\\w$.])${h}\\(`).test(src);
      const declared = new RegExp(`(?:function|const|let|var)\\s+${h}\\b|[(,]\\s*${h}\\s*(?:[,)=]|=>)|\\{[^}]*\\b${h}\\b[^}]*\\}\\s*=`).test(src);
      if (used && !imported.has(h) && !declared && !f.endsWith("/js/i18n.js")) bad(`${relative(root, f)}: ${h}() wird verwendet, aber nicht importiert`);
    }
  }
}

// ------------------------------------------------------------ Dynamisch gebildete Schlüssel: vollständig vorhanden?
console.log("2b. Dynamisch gebildete Schlüssel (Felder, Entitäten, Navigation, Datenwerte)");
const need = (k, why) => { if (!(k in de)) bad(`fehlt: ${k}  (${why})`); };
{
  const model = readFileSync(join(jsDir, "model.js"), "utf8");
  for (const m of model.matchAll(/\bfld\("(\w+)",\s*"(\w+)",\s*"(\w+)"(?:,\s*(\{[^\n]*?\}))?\)/g)) {
    need(`f.${m[1]}.${m[2]}`, "model.js Feld");
    if (/help:\s*true/.test(m[4] || "")) need(`f.${m[1]}.${m[2]}.help`, "Hilfetext");
    if (/placeholder:\s*true/.test(m[4] || "")) need(`f.${m[1]}.${m[2]}.ph`, "Platzhalter");
  }
  for (const m of model.matchAll(/\bCONTACT\("(\w+)"/g)) need(`f.contact.${m[1]}`, "Kontaktfeld");
  for (const m of model.matchAll(/\bentity\("(\w+)"/g)) for (const k of ["singular", "singularLc", "plural", "pluralLc"]) need(`ent.${m[1]}.${k}`, "Entität");
  for (const c of ["customers", "suppliers", "rfqs", "deals", "activities", "tasks", "articles", "invoices"]) need(`ent.${c}.count`, "Zählwort");
  for (const c of ["customers", "suppliers", "deals", "activities", "tasks", "articles", "invoices"]) need(`ent.${c}.nr`, "Nummernbezeichnung");
  for (const r of config.NAV) need(`nav.${r.route}`, "config.js NAV");
  need("nav.benutzer", "Unterseite");
  for (const p of config.CUSTOMER_PIPELINE) need(`pipe.cust.${p.phase}`, "Kundenpipeline");
  for (const p of config.SUPPLIER_PIPELINE) need(`pipe.supp.${p.phase}`, "Lieferantenpipeline");
  for (const a of config.SHOPFLOOR_AGENDA) need(`agenda.${a.n}`, "Agenda");
  for (const n of Object.keys(config.DEFAULT_LISTS)) { need(`list.${n}.label`, "Liste"); need(`list.${n}.hint`, "Liste"); }
  const groups = {
    phase: [...config.KUNDENPHASEN, ...config.LIEFERANTENPHASEN], suppStatus: config.LIEFERANTENSTATUS, taskStatus: config.AUFGABENSTATUS,
    yesNo: config.JA_NEIN, source: config.DEFAULT_LISTS.quellen, actType: config.DEFAULT_LISTS.aktivitaetstypen, custStatus: config.DEFAULT_LISTS.kundenstatus,
    ownerRole: config.DEFAULT_LISTS.owners.map((o) => o.role),
    invStatus: [...billing.INVOICE_STATUS, billing.OVERDUE],
  };
  for (const [g, vals] of Object.entries(groups)) for (const v of vals) need(`val.${g}.${v}`, "Datenwert");
  for (const c of config.COLLECTIONS) need(`set.label.${c}`, "Einstellungen");
  for (const c of ["customers", "suppliers", "deals", "rfqs", "activities", "tasks", "focus", "approvals", "articles", "invoices", "settings", "lists", "import", "team"]) need(`team.area.${c}`, "Team-Protokoll");
  for (const c of ["customers", "suppliers", "deals", "rfqs", "activities", "tasks", "focus", "approvals", "articles", "invoices", "settings", "lists"]) need(`team.areaPlural.${c}`, "Team-Protokoll");
  for (const a of ["create", "update", "delete", "import", "enter"]) need(`team.verb.${a}`, "Team-Protokoll");
  for (const r of ["superadmin", "admin", "member"]) need(`role.${r}`, "Rolle");
  for (const t of ["manuell", "geplant"]) need(`sp.trigger.${t}`, "SharePoint-Auslöser");
  for (const t of ["customers", "suppliers", "contacts", "deals", "rfqs", "activities", "tasks", "focus", "approvals"]) need(`imp.table.${t}`, "Importvorschau");
  const csv = readFileSync(join(jsDir, "csv.js"), "utf8");
  for (const m of csv.matchAll(/\bid:\s*"(\w+)"/g)) need(`csv.${m[1]}`, "CSV-Schaltfläche");
  for (const c of ["deals", "rfqs", "activities", "tasks", "focus", "invoices"]) need(`dep.${c}`, "Löschbestätigung");
}

// ------------------------------------------------------------ 3. Deutsche Texte im Code
console.log("3. Deutsche Zeichenketten ausserhalb der Wörterbücher");
const dataValues = new Set(["(gelöscht)", "(remote gelöscht)"]);
(function collect(v) {
  if (typeof v === "string") dataValues.add(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
})([...Object.entries(config).filter(([k]) => k !== "APP"), ...Object.entries(billing)].map(([, v]) => v)); // billing.js: Rechnungsstatus, Fehlerschlüssel der Warengruppen
dataValues.add("Aktivität"); // Rückfall-Typ im Protokoll (audit.mjs)

const SKIP_FILES = new Set(["seed.js", "csv.js", "countries.js"]); // Beispieldaten und CSV-Spalten sind bewusst deutsch
const WORDS = /(?:^|[^A-Za-zÄÖÜäöüß])(und|oder|nicht|bitte|wird|werden|keine?|noch|für|mit|von|bei|zum|zur|der|die|das|ein|eine|einen|Kunden?|Lieferanten?|Aufgaben?|Angebote?|Speichern|Abbrechen|bearbeiten|löschen|Löschen|Hinzufügen|Einstellungen|Benutzer|Passwort|Fehler|Datei|Daten|Seite|Alle|Neu|Suchen|erfolgreich|fehlgeschlagen|gespeichert|angelegt|gelöscht|Erledigt|Offen|Übersicht|Zuordnung|Aktivitäten|Anmelden|Abmelden)(?=$|[^A-Za-zÄÖÜäöüß])/;
const UMLAUT = /[äöüÄÖÜß]/;
const hits = [];
for (const f of files) {
  const rel = relative(root, f);
  if (SKIP_FILES.has(rel.split("/").pop())) continue;
  for (const l of lits.get(f)) {
    const text = l.text.replace(/ ⟨…⟩ /g, " ").trim();
    if (text.length < 2 || dataValues.has(text) || text in de) continue;
    if (/^[#\/]/.test(text) || /^[a-z][\w.-]*$/.test(text)) continue; // Routen, Bezeichner, Attribute
    if (UMLAUT.test(text) || WORDS.test(text)) hits.push(`${rel}:${l.line}: ${text.length > 110 ? text.slice(0, 107) + "…" : text}`);
  }
}
if (!hits.length) console.log("   keine");
else {
  console.log(`   ${hits.length} Treffer (zu prüfen):`);
  for (const h of hits) console.log("     " + h);
  if (strict) problems += hits.length;
}

console.log(problems ? `\n${problems} Problem(e)` : "\nOK");
process.exit(problems ? 1 : 0);
