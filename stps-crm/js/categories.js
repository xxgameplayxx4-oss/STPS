// Produktkategorien: EIN Baum für Artikel, Kunden und Lieferanten = die Warengruppen aus den Einstellungen (settings.billing.warengruppen),
// erweitert um Unterkategorien (g.unterkategorien = [{ id, name }]). Kunden und Lieferanten speichern eine Liste von Kategorie-IDs
// (Warengruppe oder Unterkategorie) in `kategorien`. Ältere Datensätze ohne `kategorien` bleiben gültig (leere Liste).
// Dazu das Lieferanten-Matching (matchSuppliers): welche Lieferanten decken die Kategorien eines Kunden ab, geprüfte zuerst.
import * as store from "./store.js";
import { uid } from "./util.js";

const groups = () => store.getBilling().warengruppen || [];

/** Unterkategorien einer Warengruppe (nur gültige Einträge) */
export const subsOf = (g) => (Array.isArray(g?.unterkategorien) ? g.unterkategorien.filter((s) => s && typeof s === "object" && s.id && String(s.name || "").trim()) : []);

/** «A · Rohre» bzw. «A · Rohre › Schellen» */
const groupLabel = (g) => [g.code, g.name].filter(Boolean).join(" · ");

/** Alle Kategorien als Map id → { id, kind: "group"|"sub", group, sub, parentId, name, label } */
export function catIndex() {
  const m = new Map();
  for (const g of groups()) {
    m.set(g.id, { id: g.id, kind: "group", group: g, sub: null, parentId: null, name: g.name, label: groupLabel(g) });
    for (const s of subsOf(g)) m.set(s.id, { id: s.id, kind: "sub", group: g, sub: s, parentId: g.id, name: s.name, label: `${groupLabel(g)} › ${s.name}` });
  }
  return m;
}
export const catLabel = (id) => catIndex().get(id)?.label || "";
/** Kurzname für Chips: Warengruppe = Name, Unterkategorie = «Name › Unterkategorie» */
export function catShort(id) {
  const c = catIndex().get(id);
  if (!c) return "";
  return c.kind === "group" ? c.name || c.group.code : `${c.group.name || c.group.code} › ${c.name}`;
}
/** Flache Liste für Filter: { value: id, label } (Unterkategorien eingerückt gedacht, hier mit › im Label) */
export const catOptions = () => [...catIndex().values()].map((c) => ({ value: c.id, label: c.label }));
export const subOptions = (groupId) => subsOf(groups().find((g) => g.id === groupId)).map((s) => ({ value: s.id, label: s.name }));
export const subOf = (id) => { for (const g of groups()) { const s = subsOf(g).find((x) => x.id === id); if (s) return s; } return null; };

/** Kategorie-IDs eines Datensatzes (nur bekannte, ohne Doppelte; Reihenfolge wie im Baum) */
export function kategorienOf(rec) {
  const raw = Array.isArray(rec?.kategorien) ? rec.kategorien : [];
  const idx = catIndex();
  return [...idx.keys()].filter((id) => raw.includes(id));
}

// ------------------------------------------------------------ Anlegen (inline, z. B. aus dem Kunden-/Lieferantenformular)

/** Wie in den Einstellungen: nur Team-Admins (im Lokalen Modus alle) ändern die Warengruppen; der Server erzwingt das ebenfalls. */
export const canEditCategories = () => store.S.mode === "local" || store.isTeamAdmin();

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function nextCode(list) {
  const used = new Set(list.map((g) => String(g.code || "").toLowerCase()));
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c.toLowerCase())) return c; }
  for (let n = 1; ; n++) if (!used.has(("G" + n).toLowerCase())) return "G" + n;
}

/**
 * Neue Hauptkategorie (Warengruppe, Nummernbereich automatisch: die nächsten 100 Nummern) oder, mit parentId, eine Unterkategorie.
 * Gibt es den Namen auf derselben Ebene schon, wird die bestehende Kategorie zurückgegeben (keine Doppelten).
 * @returns {{ id: string, created: boolean }|null} null bei leerem Namen
 */
export function addCategory(name, parentId = "") {
  name = String(name || "").trim();
  if (!name) return null;
  const list = groups().map((g) => ({ ...g }));
  if (parentId) {
    const g = list.find((x) => x.id === parentId);
    if (!g) return null;
    const ex = subsOf(g).find((s) => sameName(s.name, name));
    if (ex) return { id: ex.id, created: false };
    const id = "uk_" + uid().slice(0, 8);
    g.unterkategorien = [...subsOf(g), { id, name }];
    store.setBilling({ warengruppen: list });
    return { id, created: true };
  }
  const ex = list.find((g) => sameName(g.name, name));
  if (ex) return { id: ex.id, created: false };
  const maxBis = list.reduce((m, g) => Math.max(m, Number(g.bis) || 0), 0);
  const von = maxBis ? maxBis + 1 : 100001;
  const id = "wg_" + uid().slice(0, 8);
  list.push({ id, code: nextCode(list), name, von, bis: von + 99, unterkategorien: [] });
  store.setBilling({ warengruppen: list });
  return { id, created: true };
}

/** Wie viele Datensätze (Artikel, Kunden, Lieferanten) verwenden diese Kategorie? Zum Schutz beim Entfernen in den Einstellungen. */
export function usageCount(id) {
  const idx = catIndex();
  const c = idx.get(id);
  if (!c) return 0;
  const ids = c.kind === "group" ? [id, ...subsOf(c.group).map((s) => s.id)] : [id];
  const has = (r) => Array.isArray(r.kategorien) && r.kategorien.some((k) => ids.includes(k));
  return store.all("customers").filter(has).length + store.all("suppliers").filter(has).length
    + (c.kind === "sub" ? store.all("articles").filter((a) => a.unterkategorieId === id).length : 0);
}

// ------------------------------------------------------------ Matching

/**
 * Deckt der Lieferant die gewünschte Kategorie ab?
 * Ja, wenn er sie selbst hat, bei einer Unterkategorie die ganze Warengruppe hat, oder bei einer Warengruppe mindestens eine ihrer Unterkategorien hat.
 */
export function supplierCovers(supplierIds, catId, idx = catIndex()) {
  const set = supplierIds instanceof Set ? supplierIds : new Set(supplierIds);
  if (set.has(catId)) return true;
  const c = idx.get(catId);
  if (!c) return false;
  if (c.kind === "sub") return set.has(c.parentId);
  return subsOf(c.group).some((s) => set.has(s.id));
}

const OUT = new Set(["Gesperrt", "Inaktiv"]);

/**
 * Lieferanten, die mindestens eine der gewünschten Kategorien abdecken.
 * Sortierung: geprüfte zuerst, dann die meisten abgedeckten Kategorien, dann Bewertung, dann Name. Gesperrte/inaktive Lieferanten werden ausgelassen (hidden zählt sie).
 * @returns {{ rows: {supplier, covered: string[], missing: string[], total: number, vetted: boolean}[], hidden: number }}
 */
export function matchSuppliers(wanted, suppliers = store.all("suppliers")) {
  const idx = catIndex();
  const want = [...new Set(wanted)].filter((id) => idx.has(id));
  const rows = [];
  let hidden = 0;
  for (const s of suppliers) {
    const set = new Set(kategorienOf(s));
    const covered = want.filter((id) => supplierCovers(set, id, idx));
    if (!covered.length) continue;
    if (OUT.has(s.status)) { hidden++; continue; }
    rows.push({ supplier: s, covered, missing: want.filter((id) => !covered.includes(id)), total: want.length, vetted: Boolean(s.geprueft) });
  }
  rows.sort((a, b) =>
    Number(b.vetted) - Number(a.vetted)
    || b.covered.length - a.covered.length
    || (Number(b.supplier.bewertung) || 0) - (Number(a.supplier.bewertung) || 0)
    || String(a.supplier.firma).localeCompare(String(b.supplier.firma), "de"));
  return { rows, hidden, wanted: want };
}

