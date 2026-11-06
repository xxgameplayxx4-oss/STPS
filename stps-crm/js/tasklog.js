// «Aufgaben & Aktivitäten»: eine gemeinsame Sicht auf die beiden gespeicherten Sammlungen «tasks» (Aufgaben/To-dos) und
// «activities» (Kontakt-Aktivitäten). Die Daten bleiben unverändert in ihren Sammlungen (Excel, CSV, SharePoint, Protokoll);
// dieses Modul bildet sie nur auf einheitliche Zeilen ab und enthält die Listenlogik (Reiter, Typfilter, Suche).
// Reine Funktionen ohne DOM/Store-Zugriff, damit sie mit Node getestet werden können (scripts/test-tasklog.mjs).

export const ROUTE = "aufgaben-aktivitaeten";
export const TODO = "__todo"; // Typ-Filterwert für Aufgaben (To-dos); Aktivitäten filtern nach ihrem gespeicherten Typ
export const TABS = ["open", "done", "history"];
export const DEFAULT_TAB = "open";
/** Alte Adressen → Ziel-Reiter der zusammengeführten Seite */
export const LEGACY_ROUTES = { aufgaben: "open", aktivitaeten: "history" };

export const itemKey = (coll, id) => `${coll}:${id}`;
/** «tasks:abc» → { coll: "tasks", id: "abc" } (null bei ungültigem Schlüssel) */
export function parseKey(key) {
  const i = String(key ?? "").indexOf(":");
  if (i < 0) return null;
  const coll = key.slice(0, i);
  return coll === "tasks" || coll === "activities" ? { coll, id: key.slice(i + 1) } : null;
}

const isDone = (rec) => rec.status === "Erledigt";

/**
 * Einheitliche Zeile je Aufgabe/Aktivität.
 * date = Zeitpunkt für Verlauf/Erledigt (Aktivität: Datum · Aufgabe: erledigt am, sonst fällig am), due = Fälligkeit (faellig).
 */
export function toItem(coll, rec) {
  if (coll === "tasks") {
    return {
      id: itemKey("tasks", rec.id), coll: "tasks", recId: rec.id, rec, nr: rec.nr, kind: "todo", typ: TODO,
      title: rec.aufgabe || "", detail: rec.kommentar || "", date: rec.erledigtAm || rec.faellig || "", due: rec.faellig || "",
      status: rec.status || "", done: isDone(rec), owner: rec.owner || "", customerId: rec.customerId || "", supplierId: rec.supplierId || "", prio: rec.prioritaet || "",
    };
  }
  return {
    id: itemKey("activities", rec.id), coll: "activities", recId: rec.id, rec, nr: rec.nr, kind: "activity", typ: rec.typ || "",
    title: rec.naechsterSchritt || rec.notiz || "", detail: rec.naechsterSchritt ? rec.notiz || "" : "", date: rec.datum || "", due: rec.faellig || "",
    status: rec.status || "", done: isDone(rec), owner: rec.owner || "", customerId: rec.customerId || "", supplierId: rec.supplierId || "", prio: "",
  };
}

/** Alle Zeilen beider Sammlungen (db = { tasks, activities }) */
export function unify(db) {
  return [...(db.tasks || []).map((r) => toItem("tasks", r)), ...(db.activities || []).map((r) => toItem("activities", r))];
}

/**
 * Reiter: Offen = nicht erledigt (auch «In Arbeit»/«Blockiert») · Erledigt = Status «Erledigt» · Verlauf = alles, neueste zuerst.
 */
export function inTab(item, tab) {
  if (tab === "open") return !item.done;
  if (tab === "done") return item.done;
  return true; // history (und unbekannte Werte)
}

export const tabCounts = (items) => ({ open: items.filter((i) => inTab(i, "open")).length, done: items.filter((i) => inTab(i, "done")).length, history: items.length });

/** Typ-Filter: «Aufgabe» oder ein gespeicherter Aktivitätstyp; leer = alle */
export const matchesType = (item, typ) => !typ || item.typ === typ;

/** Auswahl für den Typfilter: To-do, die Typen der Liste (Einstellungen), dazu in den Daten vorkommende, nicht gelistete Typen */
export function typeOptions(listTypes, items) {
  const seen = new Set(listTypes);
  const extra = [...new Set(items.filter((i) => i.kind === "activity" && i.typ && !seen.has(i.typ)).map((i) => i.typ))].sort();
  return [TODO, ...listTypes, ...extra];
}

/** Standard-Sortierung je Reiter: Offen nach Fälligkeit aufsteigend, sonst neueste zuerst */
export const TAB_SORT = { open: { key: "due", dir: "asc" }, done: { key: "date", dir: "desc" }, history: { key: "date", dir: "desc" } };

/** Zählung offener Elemente mit überfälliger Frist (Menü-Badge); today = ISO-Datum */
export const overdueCount = (items, today) => items.filter((i) => !i.done && i.due && i.due < today).length;

/** Offene Elemente mit Frist im Zeitraum [from, to] (ISO-Tage, einschliesslich) – Quelle für den Kalender */
export const dueIn = (items, from, to) => items.filter((i) => !i.done && i.due && i.due >= from && i.due <= to);

/** Hash-Adresse der zusammengeführten Seite, optional mit Reiter/Typ */
export function href({ tab, typ, q } = {}) {
  const p = new URLSearchParams();
  if (tab) p.set("tab", tab);
  if (typ) p.set("typ", typ);
  if (q) p.set("q", q);
  const s = p.toString();
  return `#/${ROUTE}${s ? "?" + s : ""}`;
}
