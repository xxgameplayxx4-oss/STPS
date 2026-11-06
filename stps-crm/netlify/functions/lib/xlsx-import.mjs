// STPS CRM – Excel-Import im Format der Vorlage STPS_CRM_v.1.0 (und des eigenen Exports, siehe xlsx-export.mjs).
//
//   parseWorkbook(buffer)            -> geparste Tabellen (noch ohne Bezug zur Datenbank)
//   mergeImport(db, parsed, opts)    -> { db, summary, changed }   Merge in eine bestehende Datenbank, löscht nie etwas
//
// Reine Logik (nur exceljs + node:crypto), daher direkt testbar. Meldungen sind deutsch.
import { randomUUID } from "node:crypto";
import {
  APP, NR_BASE, DEFAULT_LISTS, COLLECTIONS, KUNDENPHASEN, LIEFERANTENPHASEN, PRIORITAETEN, LIEFERANTENSTATUS, AUFGABENSTATUS, WAEHRUNGEN, MAX_FOCUS,
} from "../../../js/config.js";
import { parseDate, parseAmount } from "../../../js/util.js";
import { defaultBilling, normalizeBilling } from "../../../js/billing.js";

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
    this.status = 400;
  }
}

export const MAX_ROWS_PER_SHEET = 20000;
const MAX_WARNINGS_PER_TABLE = 60;

// ---------------------------------------------------------------- Tabellen-Definitionen (Spalten der Vorlage)

const normText = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const normHeader = (s) => normText(s).replace(/[‐-―−]/g, "-").replace(/[*:]+$/, "").trim();
const f = (key, headers, type, opts = {}) => ({ key, headers: headers.map(normHeader), type, ...opts });

const MAIN_CONTACT = [
  f("_cName", ["Kontaktperson"], "text"),
  f("_cEmail", ["E-Mail"], "text"),
  f("_cTel", ["Telefon"], "text"),
];

export const TABLES = {
  customers: {
    label: "Kunden", sheets: ["Kunden"], anchor: ["Kunde / Firma"], headerRow: 4,
    numbering: { mode: "count", key: "firma" }, nrRange: [NR_BASE.customers, NR_BASE.customers + 9999],
    fields: [
      f("nr", ["Kundennr."], "int", { ref: true }),
      f("firma", ["Kunde / Firma", "Firma"], "text"),
      ...MAIN_CONTACT,
      f("prioritaet", ["Priorität"], "enum", { list: PRIORITAETEN, upper: true }),
      f("produkt", ["Produkt / Projekt"], "text"),
      f("phase", ["Phase"], "enum", { list: KUNDENPHASEN }),
      f("potenzial", ["Potenzial CHF"], "money"),
      f("angebot", ["Angebot CHF"], "money"),
      f("naechsterSchritt", ["Nächster Schritt"], "text"),
      f("termin", ["Termin"], "date"),
      f("kommentar", ["Kommentar"], "text"),
      f("owner", ["Verantwortlich", "Owner"], "text"),
      f("quelle", ["Quelle"], "text"),
      f("erstkontakt", ["Erstkontakt"], "date"),
      f("letzterKontakt", ["Letzter Kontakt"], "date"),
      f("followUp", ["Nächster Follow-up"], "date"),
      f("chance", ["Chance %"], "percent"),
      f("status", ["Kundenstatus"], "text"),
    ],
  },
  suppliers: {
    label: "Lieferanten", sheets: ["Lieferantenstamm"], anchor: ["Lieferant / Firma"], headerRow: 4,
    numbering: { mode: "count", key: "firma" }, nrRange: [NR_BASE.suppliers, NR_BASE.suppliers + 9999],
    fields: [
      f("firma", ["Lieferant / Firma", "Firma"], "text"),
      f("nr", ["Lieferantennr."], "int", { ref: true }),
      ...MAIN_CONTACT,
      f("ort", ["Ort / Land"], "text"),
      f("produkte", ["Produkte / Verfahren"], "text"),
      f("qualitaet", ["Qualität / Zertifikate"], "text"),
      f("status", ["Status"], "enum", { list: LIEFERANTENSTATUS }),
      f("notiz", ["Notiz", "Notizen"], "text"),
      f("owner", ["Verantwortlich", "Owner"], "text"),
      f("seit", ["Lieferant seit"], "date"),
      f("bewertung", ["Bewertung 1-5"], "rating"),
      f("letzterKontakt", ["Letzter Kontakt"], "date"),
      f("followUp", ["Nächster Follow-up"], "date"),
      f("zahlungskonditionen", ["Zahlungskonditionen"], "text"),
    ],
  },
  contacts: {
    label: "Kontaktpersonen", sheets: ["Kontakte"], anchor: ["Name"], headerRow: 4,
    fields: [
      f("typ", ["Typ"], "text", { ref: true }),
      f("kundennr", ["Kundennr."], "int", { ref: true }),
      f("lieferantennr", ["Lieferantennr."], "int", { ref: true }),
      f("firma", ["Firma"], "text", { ref: true }),
      f("name", ["Name"], "text"),
      f("funktion", ["Funktion / Rolle", "Funktion"], "text"),
      f("email", ["E-Mail"], "text"),
      f("telefon", ["Telefon"], "text"),
      f("mobile", ["Mobile", "Mobil"], "text"),
      f("notiz", ["Notiz"], "text"),
      f("haupt", ["Hauptkontakt"], "yesno"),
    ],
  },
  deals: {
    label: "Angebote", sheets: ["Angebote"], anchor: ["Projekt / Produkt"], headerRow: 4,
    numbering: { mode: "row", key: "kundennr" }, nrRange: [NR_BASE.deals, NR_BASE.deals + 9999],
    fields: [
      f("nr", ["Angebotsnr."], "int", { ref: true }),
      f("kundennr", ["Kundennr."], "int", { ref: true }),
      f("kunde", ["Kunde"], "text", { ref: true }),
      f("produkt", ["Projekt / Produkt"], "text"),
      f("erstellt", ["Angebot erstellt"], "date"),
      f("gesendet", ["Angebot gesendet"], "date"),
      f("wert", ["Angebotswert CHF"], "money"),
      f("phase", ["Phase"], "enum", { list: KUNDENPHASEN }),
      f("chance", ["Chance %"], "percent"),
      f("erwarteterAbschluss", ["Erwarteter Abschluss"], "date"),
      f("naechsterSchritt", ["Nächster Schritt"], "text"),
      f("owner", ["Owner", "Verantwortlich"], "text"),
      f("kommentar", ["Kommentar"], "text"),
    ],
  },
  rfqs: {
    label: "Zuordnungen", sheets: ["Lieferanten", "Lieferantenzuordnung"], anchor: ["Lieferant auswählen"], headerRow: 4,
    fields: [
      f("kundennr", ["Kundennr."], "int"),
      f("kunde", ["Kunde"], "text", { ref: true }),
      f("lieferant", ["Lieferant auswählen", "Lieferant"], "text"),
      f("lieferantennr", ["Lieferantennr."], "int", { ref: true }),
      f("kontakt", ["Kontaktperson Lieferant"], "text", { ref: true }),
      f("_email", ["E-Mail Lieferant"], "text", { ref: true }),
      f("produkt", ["Produkt / Projekt"], "text"),
      f("phase", ["Lieferantenphase"], "enum", { list: LIEFERANTENPHASEN }),
      f("gesendetAm", ["Angebot gesendet am"], "date"),
      f("erhaltenAm", ["Angebot erhalten am"], "date"),
      f("angebot", ["Angebot Lieferant"], "money"),
      f("waehrung", ["Währung"], "enum", { list: WAEHRUNGEN, upper: true }),
      f("moq", ["MOQ"], "text"),
      f("leadTime", ["Lead Time"], "text"),
      f("naechsterSchritt", ["Nächster Schritt"], "text"),
      f("kommentar", ["Kommentar / Qualität"], "text"),
      f("angebotsnr", ["Angebotsnr."], "int", { ref: true }),
    ],
  },
  activities: {
    label: "Aktivitäten", sheets: ["Aktivitäten"], anchor: ["Datum"], headerRow: 4,
    numbering: { mode: "row", key: "datum" }, nrRange: [NR_BASE.activities, NR_BASE.activities + 9999],
    fields: [
      f("nr", ["Aktivitätsnr."], "int", { ref: true }),
      f("datum", ["Datum"], "date"),
      f("typ", ["Typ"], "text"),
      f("kundennr", ["Kundennr."], "int", { ref: true }),
      f("kunde", ["Kunde"], "text", { ref: true }),
      f("lieferantennr", ["Lieferantennr."], "int", { ref: true }),
      f("lieferant", ["Lieferant"], "text", { ref: true }),
      f("owner", ["Owner", "Verantwortlich"], "text"),
      f("notiz", ["Notiz"], "text"),
      f("naechsterSchritt", ["Nächster Schritt"], "text"),
      f("faellig", ["Fällig am"], "date"),
      f("status", ["Status"], "enum", { list: AUFGABENSTATUS }),
    ],
  },
  tasks: {
    label: "Aufgaben", sheets: ["Aufgaben"], anchor: ["Aufgabe"], headerRow: 3,
    numbering: { mode: "row", key: "faellig" }, nrRange: [NR_BASE.tasks, NR_BASE.tasks + 9999],
    fields: [
      f("nr", ["Aufgabennr."], "int", { ref: true }),
      f("faellig", ["Fällig am"], "date"),
      f("owner", ["Owner", "Verantwortlich"], "text"),
      f("kundennr", ["Kundennr."], "int", { ref: true }),
      f("kunde", ["Kunde"], "text", { ref: true }),
      f("lieferant", ["Lieferant"], "text", { ref: true }),
      f("lieferantennr", ["Lieferantennr."], "int", { ref: true }),
      f("aufgabe", ["Aufgabe"], "text"),
      f("prioritaet", ["Priorität"], "enum", { list: PRIORITAETEN, upper: true }),
      f("status", ["Status"], "enum", { list: AUFGABENSTATUS }),
      f("erledigtAm", ["Erledigt am"], "date"),
      f("kommentar", ["Kommentar"], "text"),
    ],
  },
  focus: {
    label: "Wochenfokus", sheets: ["Wochenfokus", "Shopfloor"], anchor: ["Entscheid / Blocker"], headerRow: 13,
    fields: [
      f("kundennr", ["Kundennr."], "int"),
      f("kunde", ["Kunde"], "text", { ref: true }),
      f("blocker", ["Entscheid / Blocker"], "text"),
      f("owner", ["Owner"], "text"),
      f("diese", ["Diese Woche"], "yesno"),
      f("kommentar", ["Kommentar"], "text"),
    ],
  },
  approvals: {
    label: "Freigaben", sheets: ["Freigaben", "Shopfloor"], anchor: ["Thema"], headerRow: 27,
    fields: [
      f("kundennr", ["Kundennr."], "int", { ref: true }),
      f("thema", ["Thema"], "text"),
      f("entscheidung", ["Entscheidung / Aufgabe"], "text"),
      f("termin", ["Termin"], "date"),
      f("status", ["Status"], "enum", { list: AUFGABENSTATUS }),
    ],
  },
};

export const TABLE_ORDER = ["customers", "suppliers", "contacts", "deals", "rfqs", "activities", "tasks", "focus", "approvals"];

// ---------------------------------------------------------------- Zellen lesen

/** exceljs-Zellwert -> { v, formula, cached }  (v: string | number | boolean | Date | null) */
function unwrap(value) {
  let v = value;
  let formula = false;
  let cached = true;
  for (let i = 0; i < 5 && v !== null && v !== undefined && typeof v === "object" && !(v instanceof Date); i++) {
    if ("formula" in v || "sharedFormula" in v) {
      formula = true;
      v = v.result;
      if (v === undefined) cached = false;
    } else if ("richText" in v) v = v.richText.map((r) => r.text ?? "").join("");
    else if ("hyperlink" in v) v = v.text ?? String(v.hyperlink).replace(/^mailto:/i, "");
    else if ("error" in v) v = null;
    else if ("text" in v) v = v.text;
    else v = String(v);
  }
  if (v === undefined) v = null;
  if (typeof v === "string" && v.trim() === "") v = null;
  return { v, formula, cached };
}

const isoUTC = (d) => (Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10));

function toText(v) {
  if (v === null) return undefined;
  if (v instanceof Date) return isoUTC(v) ?? undefined;
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  const s = String(v).replace(/\r\n?/g, "\n").trim();
  return s === "" ? undefined : s;
}

const serialToIso = (n) => isoUTC(new Date(Math.round((n - 25569) * 86400000)));

/** Wandelt den Zellwert gemäss Feldtyp um. Gibt undefined zurück bei leer; wirft Error(Text) bei ungültig. */
function convert(fd, cell) {
  const v = cell.v;
  if (v === null) return undefined;
  switch (fd.type) {
    case "text":
      return toText(v);
    case "int": {
      const n = typeof v === "number" ? v : /^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
      if (!Number.isInteger(n)) throw new Error(`«${toText(v)}» ist keine gültige Nummer`);
      return n;
    }
    case "date": {
      if (v instanceof Date) return isoUTC(v) ?? undefined;
      if (typeof v === "number") {
        if (v > 20000 && v < 80000) return serialToIso(v);
        throw new Error(`«${v}» ist kein gültiges Datum`);
      }
      const iso = parseDate(String(v));
      if (iso === null) throw new Error(`«${toText(v)}» ist kein gültiges Datum (TT.MM.JJJJ erwartet)`);
      return iso || undefined;
    }
    case "money": {
      const n = typeof v === "number" ? v : parseAmount(String(v));
      if (n === null) return undefined;
      if (Number.isNaN(n)) throw new Error(`«${toText(v)}» ist kein gültiger Betrag`);
      return n;
    }
    case "percent": {
      let n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace("%", ""));
      if (Number.isNaN(n)) throw new Error(`«${toText(v)}» ist kein gültiger Prozentwert`);
      // Excel speichert 40 % als 0.4 (Zahlenformat 0%) – die Vorlage rechnet Betrag × Chance. Ohne %-Format gilt: ≤ 1 = Anteil.
      const isFraction = typeof v === "number" && ((cell.fmt && cell.fmt.includes("%")) || n <= 1);
      if (isFraction) n = n * 100;
      n = Math.round(n * 1e4) / 1e4;
      if (n < 0 || n > 100) throw new Error(`Chance «${toText(v)}» liegt nicht zwischen 0 und 100 %`);
      return n;
    }
    case "rating": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error(`Bewertung «${toText(v)}» liegt nicht zwischen 1 und 5`);
      return String(Math.round(n));
    }
    case "yesno": {
      const s = normText(toText(v) ?? "");
      if (["ja", "j", "yes", "true", "x", "1"].includes(s)) return "Ja";
      if (["nein", "n", "no", "false", "0"].includes(s)) return "Nein";
      throw new Error(`«${toText(v)}» ist weder Ja noch Nein`);
    }
    case "enum": {
      const s = toText(v);
      if (s === undefined) return undefined;
      const hit = fd.list.find((x) => normText(x) === normText(s));
      if (!hit) throw new Error(`«${s}» ist kein gültiger Wert für «${fd.headers[0]}» (erlaubt: ${fd.list.join(", ")})`);
      return hit;
    }
    default:
      return toText(v);
  }
}

// ---------------------------------------------------------------- Schutz vor «Zip-Bomben»

/** Prüft das Zip-Verzeichnis (ohne zu entpacken): Magic, Anzahl Einträge, entpackte Gesamtgrösse. */
export function assertSafeXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new ImportError("Die Datei ist keine gültige .xlsx-Datei (Excel-Arbeitsmappe). Ältere .xls- und .csv-Dateien bitte in Excel als .xlsx speichern.");
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError("Die Datei ist beschädigt (Zip-Verzeichnis nicht gefunden).");
  const entries = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || off === 0xffffffff) throw new ImportError("Die Datei ist zu gross oder ungewöhnlich aufgebaut (Zip64).");
  if (entries > 5000) throw new ImportError("Die Datei enthält ungewöhnlich viele Teile.");
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new ImportError("Die Datei ist beschädigt (Zip-Verzeichnis).");
    const size = buf.readUInt32LE(off + 24);
    if (size === 0xffffffff) throw new ImportError("Die Datei ist zu gross oder ungewöhnlich aufgebaut (Zip64).");
    total += size;
    if (size > 100 * 1024 * 1024 || total > 200 * 1024 * 1024) throw new ImportError("Die Datei ist entpackt zu gross (über 200 MB).");
    off += 46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
}

// ---------------------------------------------------------------- Parser

async function loadExcelJs() {
  const mod = await import("exceljs");
  return mod.default ?? mod;
}

function findSheet(wb, names) {
  for (const n of names) {
    const hit = wb.worksheets.find((ws) => normText(ws.name) === normText(n));
    if (hit) return hit;
  }
  return null;
}

/** Kopfzeile suchen: erste Zeile, in der der Ankertitel vorkommt und mind. 3 bekannte Spalten stehen. */
function findHeader(ws, spec) {
  const known = new Map();
  for (const fd of spec.fields) for (const h of fd.headers) if (!known.has(h)) known.set(h, fd.key);
  const anchors = spec.anchor.map(normHeader);
  const last = Math.min(ws.rowCount, 40);
  const tryRow = (r) => {
    const cols = new Map();
    let anchorSeen = false;
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.max(ws.columnCount, 1); c++) {
      const { v } = unwrap(row.getCell(c).value);
      if (v === null) continue;
      const h = normHeader(toText(v) ?? "");
      if (anchors.includes(h)) anchorSeen = true;
      const key = known.get(h);
      if (key && !cols.has(key)) cols.set(key, c);
    }
    return anchorSeen && cols.size >= 3 ? cols : null;
  };
  const order = [spec.headerRow, ...Array.from({ length: last }, (_, i) => i + 1)];
  for (const r of order) {
    const cols = tryRow(r);
    if (cols) return { row: r, cols };
  }
  return null;
}

function parseSheet(ws, spec, tableKey) {
  const out = { sheet: ws.name, headerRow: 0, rows: [], warnings: [] };
  const hdr = findHeader(ws, spec);
  if (!hdr) {
    out.warnings.push(`Blatt «${ws.name}»: Kopfzeile nicht gefunden (erwartet u. a. «${spec.anchor[0]}») – Blatt übersprungen`);
    out.unreadable = true;
    return out;
  }
  out.headerRow = hdr.row;
  const fields = spec.fields.filter((fd) => hdr.cols.has(fd.key));
  const stopAtEmpty = normText(ws.name) === "shopfloor";
  const lastRow = Math.min(ws.rowCount, hdr.row + MAX_ROWS_PER_SHEET);
  if (ws.rowCount > lastRow) out.warnings.push(`Blatt «${ws.name}»: nur die ersten ${MAX_ROWS_PER_SHEET} Zeilen gelesen`);
  let seq = 0;
  for (let r = hdr.row + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (stopAtEmpty && !row.hasValues) break;
    const v = {};
    let content = 0;
    let nrState = "none"; // none | value | derive
    for (const fd of fields) {
      const cell = row.getCell(hdr.cols.get(fd.key));
      const u = unwrap(cell.value);
      u.fmt = cell.numFmt;
      if (fd.key === "nr") {
        if (u.formula && !u.cached) nrState = "derive";
        else if (u.v !== null) {
          try { v.nr = convert(fd, u); nrState = "value"; } catch (e) { out.warnings.push(`Zeile ${r}: ${spec.fields[0].headers[0]} – ${e.message} (ignoriert)`); }
        }
        continue;
      }
      let val;
      try {
        val = convert(fd, u);
      } catch (e) {
        out.warnings.push(`Zeile ${r}: ${e.message} – Feld «${fd.headers[0]}» ignoriert`);
        if (!fd.ref) content++; // die Zeile war nicht leer
        continue;
      }
      if (val === undefined) continue;
      v[fd.key] = val;
      if (!fd.ref) content++;
    }
    if (content === 0) continue; // leere Zeile (Vorlage enthält vorbereitete Leerzeilen)
    const item = { row: r, v };
    if (spec.numbering) {
      const keyPresent = v[spec.numbering.key] !== undefined;
      if (spec.numbering.mode === "count") {
        if (keyPresent) seq++;
        if (nrState === "derive" && keyPresent) { item.derivedNr = spec.nrRange[0] + seq - 1; }
      } else if (nrState === "derive" && keyPresent) {
        item.derivedNr = spec.nrRange[0] + (r - hdr.row - 1);
      }
    }
    out.rows.push(item);
  }
  return out;
}

/**
 * Liest eine Excel-Arbeitsmappe (Buffer) in Tabellen. Fehlende Blätter sind kein Fehler.
 * @returns {{tables: Record<string, {sheet:string|null, headerRow:number, rows:object[], warnings:string[]}>, sheets:string[]}}
 */
export async function parseWorkbook(buffer) {
  assertSafeXlsx(buffer);
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw new ImportError(`Die Datei konnte nicht gelesen werden (${String(err?.message || err).slice(0, 120)}). Bitte als .xlsx speichern.`);
  }
  const tables = {};
  let found = 0;
  for (const key of TABLE_ORDER) {
    const spec = TABLES[key];
    const ws = findSheet(wb, spec.sheets);
    if (!ws) { tables[key] = { sheet: null, headerRow: 0, rows: [], warnings: [] }; continue; }
    const t = parseSheet(ws, spec, key);
    if (!t.unreadable) found++;
    tables[key] = t;
  }
  if (!found) {
    throw new ImportError(`Die Datei enthält keines der erwarteten Blätter (${["Kunden", "Lieferantenstamm", "Lieferanten", "Aktivitäten", "Angebote", "Aufgaben"].join(", ")}). Ist es die STPS-CRM-Vorlage?`);
  }
  return { tables, sheets: wb.worksheets.map((w) => w.name) };
}

// ---------------------------------------------------------------- Datenbank-Hilfen

export function emptyDb(now = new Date()) {
  const d = { schema: APP.schema, meta: { createdAt: new Date(now).toISOString(), lastNr: {} }, lists: {}, settings: { billing: defaultBilling() } };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

/** Ergänzt fehlende Tabellen/Felder einer (serverseitig gespeicherten) Datenbank. Verändert und gibt `db` zurück. */
export function ensureDbShape(db) {
  if (!Number.isInteger(db.schema)) db.schema = APP.schema;
  db.meta = db.meta && typeof db.meta === "object" ? db.meta : {};
  db.meta.lastNr = db.meta.lastNr && typeof db.meta.lastNr === "object" ? db.meta.lastNr : {};
  db.lists = db.lists && typeof db.lists === "object" ? db.lists : {};
  // Abrechnung (Artikel, Rechnungen, Positionen): Standardwerte für alte Datenbanken. Der Excel-Import berührt diese Daten nicht.
  db.settings = db.settings && typeof db.settings === "object" && !Array.isArray(db.settings) ? db.settings : {};
  db.settings.billing = normalizeBilling(db.settings.billing);
  for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
  for (const c of ["customers", "suppliers"]) for (const r of db[c]) if (!Array.isArray(r.contacts)) r.contacts = [];
  return db;
}

const sameVal = (a, b) => {
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a ?? "") === String(b ?? "");
};

const digits = (s) => String(s ?? "").replace(/\D/g, "").replace(/^00/, "");
const samePhone = (a, b) => digits(a) !== "" && digits(a) === digits(b);

// ---------------------------------------------------------------- Merge

const newTableSummary = (key, parsed) => {
  const t = parsed.tables[key];
  return { label: TABLES[key].label, found: Boolean(t?.sheet), sheet: t?.sheet ?? null, added: 0, updated: 0, unchanged: 0, skipped: 0, warnings: [], warningCount: 0 };
};

/**
 * Führt die geparsten Tabellen in eine bestehende Datenbank zusammen (merge, löscht nie).
 * Kunden/Lieferanten: Zuordnung über Nummer, sonst über den Firmennamen (ohne Beachtung der Gross-/Kleinschreibung).
 * Nur im Excel gefüllte Felder überschreiben bestehende Werte.
 * @param dbIn   aktuelle Datenbank (wird nicht verändert)
 * @param opts   { now?: Date, stampBy?: string }
 * @returns {{db:object, summary:object, changed:boolean}}
 */
export function mergeImport(dbIn, parsed, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const ts = now.toISOString();
  const stampBy = opts.stampBy || "Excel-Import";
  const db = ensureDbShape(structuredClone(dbIn ?? emptyDb(now)));

  const summary = {};
  for (const key of TABLE_ORDER) summary[key] = newTableSummary(key, parsed);

  const warn = (key, msg) => {
    const s = summary[key];
    s.warningCount++;
    if (s.warnings.length < MAX_WARNINGS_PER_TABLE) s.warnings.push(msg);
  };
  for (const key of TABLE_ORDER) for (const w of parsed.tables[key]?.warnings ?? []) warn(key, w);

  const stampNew = (rec) => { rec.createdAt = ts; rec.createdBy = stampBy; rec.updatedAt = ts; rec.updatedBy = stampBy; };
  const stampUpd = (rec) => { rec.updatedAt = ts; rec.updatedBy = stampBy; };
  const list = (name) => (Array.isArray(db.lists[name]) ? db.lists[name] : DEFAULT_LISTS[name]);

  // ---- Nummernkreise
  const nrSet = {};
  const maxNr = {};
  for (const [coll, base] of Object.entries(NR_BASE)) {
    nrSet[coll] = new Set(db[coll].map((r) => r.nr));
    maxNr[coll] = db[coll].reduce((m, r) => Math.max(m, Number(r.nr) || 0), Math.max(base - 1, Number(db.meta.lastNr[coll]) || 0));
  }
  const claimNr = (coll, want) => {
    if (want != null && !nrSet[coll].has(want)) {
      nrSet[coll].add(want);
      maxNr[coll] = Math.max(maxNr[coll], want);
      return { nr: want, renumbered: false };
    }
    let n = maxNr[coll] + 1;
    while (nrSet[coll].has(n)) n++;
    nrSet[coll].add(n);
    maxNr[coll] = n;
    return { nr: n, renumbered: want != null };
  };
  const touchedColl = new Set();
  const recState = new Map(); // Kunde/Lieferant (id) -> 'added' | 'updated' | 'unchanged'

  // ---- Auswahllisten (bearbeitbar): Schreibweise angleichen, unbekannte Werte einmalig melden
  const unknown = {};
  const canon = (table, field, listName, value) => {
    if (value === undefined) return undefined;
    const items = listName === "owners" ? list("owners").map((o) => o.name) : list(listName);
    const hit = items.find((x) => normText(x) === normText(value));
    if (hit) return hit;
    ((unknown[table] ??= {})[field] ??= new Set()).add(value);
    return value;
  };

  const rowFields = (v, keys) => {
    const p = {};
    for (const k of keys) if (v[k] !== undefined) p[k] = v[k];
    return p;
  };
  const applyPatch = (rec, patch) => {
    const ch = [];
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      if (!sameVal(rec[k], val)) { rec[k] = val; ch.push(k); }
    }
    return ch;
  };

  // ---------------------------------------------------------------- Kontaktpersonen

  const primaryOf = (rec) => rec.contacts.find((c) => c.primary) || rec.contacts[0] || null;

  // Kontaktdaten stehen in der Datei doppelt (Spalten im Kunden-/Lieferantenblatt und Blatt «Kontakte»). Ein Wert, der dem Stand
  // VOR dem Import entspricht, gilt als unverändert und überschreibt keine Änderung aus dem anderen Blatt.
  const origContact = new Map();
  for (const coll of ["customers", "suppliers"]) for (const r of db[coll]) for (const c of r.contacts) origContact.set(c.id, { ...c });

  const setPrimary = (rec, c) => {
    let ch = false;
    for (const x of rec.contacts) {
      const want = x === c;
      if (Boolean(x.primary) !== want) { x.primary = want; ch = true; }
    }
    return ch;
  };

  /** Legt eine Kontaktperson an oder ergänzt sie (nur gefüllte Felder). Gibt 'added' | 'updated' | 'unchanged' | null zurück. */
  const upsertContact = (rec, c, { primary = false, singlePhone = false } = {}) => {
    const hasAny = c.name || c.email || c.telefon || c.mobile;
    if (!hasAny) return null;
    let found = null;
    if (c.name) found = rec.contacts.find((x) => normText(x.name) === normText(c.name)) || null;
    if (!found && c.email) found = rec.contacts.find((x) => x.email && normText(x.email) === normText(c.email)) || null;
    if (!found && !c.name) found = primaryOf(rec); // nur E-Mail/Telefon angegeben: gilt für den Hauptkontakt
    if (found) {
      let ch = false;
      const o = origContact.get(found.id);
      const set = (k, val) => {
        if (!val || sameVal(found[k], val) || (o && sameVal(o[k], val))) return;
        found[k] = val;
        ch = true;
      };
      if (c.name) set("name", c.name);
      set("funktion", c.funktion);
      set("email", c.email);
      set("notiz", c.notiz);
      if (singlePhone) {
        const same = (x) => samePhone(c.telefon, x);
        if (c.telefon && !same(found.telefon) && !same(found.mobile) && !(o && (same(o.telefon) || same(o.mobile)))) { found.telefon = c.telefon; ch = true; }
      } else {
        set("telefon", c.telefon);
        set("mobile", c.mobile);
        // Das Blatt «Kontakte» ist genauer als die einspaltige Telefon-Angabe: steht dieselbe Nummer dort als Mobile, nicht doppelt führen.
        if (c.mobile && !c.telefon && samePhone(found.telefon, c.mobile) && !(o && samePhone(o.telefon, found.telefon))) { found.telefon = ""; ch = true; }
      }
      if (primary && !found.primary && setPrimary(rec, found)) ch = true;
      return ch ? "updated" : "unchanged";
    }
    const nc = {
      id: randomUUID(),
      name: c.name || c.email || c.telefon || c.mobile,
      funktion: c.funktion || "", email: c.email || "", telefon: c.telefon || "", mobile: c.mobile || "", notiz: c.notiz || "",
      primary: false,
    };
    rec.contacts.push(nc);
    if (primary || rec.contacts.length === 1) setPrimary(rec, nc);
    return "added";
  };

  const countContact = (res) => { if (res) summary.contacts[res]++; return res === "added" || res === "updated"; };

  // ---------------------------------------------------------------- Kunden / Lieferanten

  const party = {
    customers: { coll: "customers", key: "customers", noun: "Kundennr.", byNr: new Map(), byName: new Map(), xNr: new Map(), xName: new Map() },
    suppliers: { coll: "suppliers", key: "suppliers", noun: "Lieferantennr.", byNr: new Map(), byName: new Map(), xNr: new Map(), xName: new Map() },
  };
  const indexParty = (P, rec) => {
    P.byNr.set(rec.nr, rec);
    const k = normText(rec.firma);
    if (!P.byName.has(k)) P.byName.set(k, []);
    P.byName.get(k).push(rec);
  };
  for (const P of Object.values(party)) for (const rec of db[P.coll]) indexParty(P, rec);

  const resolveParty = (P, nr, name) => {
    if (nr != null) { const r = P.xNr.get(nr) ?? P.byNr.get(nr); if (r) return r; }
    const k = normText(name);
    if (k) { const r = P.xName.get(k) ?? P.byName.get(k)?.[0]; if (r) return r; }
    return null;
  };

  const PARTY_KEYS = {
    customers: ["prioritaet", "produkt", "phase", "potenzial", "angebot", "naechsterSchritt", "termin", "kommentar", "quelle", "erstkontakt", "letzterKontakt", "followUp", "chance", "status", "owner"],
    suppliers: ["ort", "produkte", "qualitaet", "status", "notiz", "seit", "bewertung", "letzterKontakt", "followUp", "zahlungskonditionen", "owner"],
  };
  const PARTY_DEFAULTS = {
    customers: () => ({ prioritaet: "B", phase: "Akquise", status: "Lead" }),
    suppliers: () => ({ status: "In Prüfung" }),
  };

  function mergeParty(P) {
    const sum = summary[P.key];
    const rows = parsed.tables[P.key]?.rows ?? [];
    const touched = new Set();
    const [lo, hi] = TABLES[P.key].nrRange;
    for (const row of rows) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      let nr = v.nr ?? null;
      const derived = nr == null && row.derivedNr != null;
      if (nr != null && (nr < lo || nr > hi)) { warn(P.key, `${where}: ${P.noun} ${nr} liegt ausserhalb des Nummernkreises ${lo}–${hi} – Nummer ignoriert`); nr = null; }
      if (derived) nr = row.derivedNr;
      if (P.key === "customers") { v.status = canon("customers", "Kundenstatus", "kundenstatus", v.status); v.quelle = canon("customers", "Quelle", "quellen", v.quelle); }
      v.owner = canon(P.key, "Verantwortlich", "owners", v.owner);
      const patch = rowFields(v, PARTY_KEYS[P.key]);
      if (!v.firma) {
        // Zeile ohne Firma, aber mit Inhalt (z. B. Beispielzeile der Vorlage): Platzhaltername statt überspringen.
        if (!Object.keys(patch).length && !v._cName && !v._cEmail && !v._cTel) { sum.skipped++; warn(P.key, `${where}: Firma fehlt – Zeile übersprungen`); continue; }
        if (nr == null && row.row >= 5) nr = lo + (row.row - 5); // Nummer aus der Zeilenposition der Vorlage (Daten ab Zeile 5)
        v.firma = `${P.key === "customers" ? "Kunde" : "Lieferant"} ${nr ?? "ohne Namen"}`;
        warn(P.key, `${where}: Firma fehlt – als «${v.firma}» übernommen, bitte im CRM ergänzen`);
      }

      let match = null;
      let via = "";
      if (nr != null && !derived) { match = P.byNr.get(nr) ?? null; if (match) via = "nr"; }
      if (!match) {
        const cands = P.byName.get(normText(v.firma));
        if (cands?.length) {
          match = cands[0];
          via = "name";
          if (cands.length > 1) warn(P.key, `${where}: «${v.firma}» ist im CRM mehrfach vorhanden – ${P.noun} ${match.nr} verwendet`);
          else if (nr != null && !derived && match.nr !== nr) warn(P.key, `${where}: ${P.noun} ${nr} nicht im CRM – «${v.firma}» über den Namen der ${P.noun} ${match.nr} zugeordnet`);
        }
      }

      let rec;
      if (match) {
        rec = match;
        if (touched.has(rec.id)) warn(P.key, `${where}: «${v.firma}» kommt mehrfach in der Datei vor – Angaben zusammengeführt`);
        touched.add(rec.id);
        const ch = applyPatch(rec, { ...patch, ...(via === "nr" ? { firma: v.firma } : {}) });
        if (via === "nr" && ch.includes("firma")) warn(P.key, `${where}: ${P.noun} ${rec.nr} – Firma wird geändert (Excel: «${v.firma}»)`);
        const cres = upsertContact(rec, { name: v._cName, email: v._cEmail, telefon: v._cTel }, { singlePhone: true });
        const contactChanged = countContact(cres);
        if (ch.length || contactChanged) { stampUpd(rec); sum.updated++; recState.set(rec.id, "updated"); } else { sum.unchanged++; if (!recState.has(rec.id)) recState.set(rec.id, "unchanged"); }
      } else {
        const claim = claimNr(P.coll, nr);
        if (claim.renumbered && !derived) warn(P.key, `${where}: ${P.noun} ${nr} ist bereits vergeben – «${v.firma}» erhält ${claim.nr}`);
        rec = { id: randomUUID(), nr: claim.nr, firma: v.firma, ...PARTY_DEFAULTS[P.key](), ...patch, contacts: [] };
        countContact(upsertContact(rec, { name: v._cName, email: v._cEmail, telefon: v._cTel }, { singlePhone: true, primary: true }));
        stampNew(rec);
        db[P.coll].push(rec);
        indexParty(P, rec);
        touchedColl.add(P.coll);
        touched.add(rec.id);
        sum.added++;
        recState.set(rec.id, "added");
      }
      if (nr != null) P.xNr.set(nr, rec);
      P.xName.set(normText(v.firma), rec);
    }
  }
  mergeParty(party.customers);
  mergeParty(party.suppliers);

  // ---------------------------------------------------------------- Kontakte (Blatt «Kontakte»)

  {
    const sum = summary.contacts;
    for (const row of parsed.tables.contacts?.rows ?? []) {
      const v = row.v;
      const where = `Zeile ${row.row}`;
      const typ = normText(v.typ ?? "");
      let P = null;
      let owner = null;
      if (v.kundennr != null || typ === "kunde") { P = party.customers; owner = resolveParty(P, v.kundennr ?? null, v.firma); }
      else if (v.lieferantennr != null || typ === "lieferant") { P = party.suppliers; owner = resolveParty(P, v.lieferantennr ?? null, v.firma); }
      else {
        P = party.customers; owner = resolveParty(P, null, v.firma);
        if (!owner) { P = party.suppliers; owner = resolveParty(P, null, v.firma); }
      }
      if (!owner) {
        sum.skipped++;
        warn("contacts", `${where}: Kunde/Lieferant nicht gefunden (${v.kundennr ?? v.lieferantennr ?? v.firma ?? "ohne Angabe"}) – «${v.name || v.email || "Kontakt"}» übersprungen`);
        continue;
      }
      const res = upsertContact(owner, { name: v.name, funktion: v.funktion, email: v.email, telefon: v.telefon, mobile: v.mobile, notiz: v.notiz }, { primary: v.haupt === "Ja" });
      if (!res) { sum.skipped++; warn("contacts", `${where}: Name, E-Mail und Telefon fehlen – Zeile übersprungen`); continue; }
      sum[res]++;
      if (res === "added" || res === "updated") {
        stampUpd(owner);
        // Der Kunde/Lieferant gilt damit als geändert (sofern er nicht ohnehin neu oder schon als geändert gezählt ist).
        const st = recState.get(owner.id);
        if (st === "unchanged") { summary[P.key].unchanged--; summary[P.key].updated++; recState.set(owner.id, "updated"); }
        else if (st === undefined) { summary[P.key].updated++; recState.set(owner.id, "updated"); }
      }
    }
  }

  // ---------------------------------------------------------------- Hilfen für Datensätze mit Verweisen

  const refLabel = (nr, name) => (nr != null ? String(nr) : name ? `«${name}»` : "ohne Angabe");
  const idOf = (r) => r?.id ?? "";
  const compat = (rec, cust, sup) =>
    (!cust || rec.customerId === cust.id) && (!sup || rec.supplierId === sup.id);

  // ---------------------------------------------------------------- Angebote

  const dealByNr = new Map(db.deals.map((d) => [d.nr, d]));
  const dealXNr = new Map();
  const dealKey = (custId, produkt) => `${custId}|${normText(produkt)}`;
  const dealByKey = new Map();
  for (const d of db.deals) if (d.produkt) dealByKey.set(dealKey(d.customerId, d.produkt), d);

  {
    const sum = summary.deals;
    const touched = new Set();
    const [lo, hi] = TABLES.deals.nrRange;
    for (const row of parsed.tables.deals?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      const cust = resolveParty(party.customers, v.kundennr ?? null, v.kunde);
      if (!cust) { sum.skipped++; warn("deals", `${where}: Kunde ${refLabel(v.kundennr, v.kunde)} nicht gefunden – Angebot übersprungen`); continue; }
      let nr = v.nr ?? null;
      const derived = nr == null && row.derivedNr != null;
      if (nr != null && (nr < lo || nr > hi)) { warn("deals", `${where}: Angebotsnr. ${nr} liegt ausserhalb des Nummernkreises – Nummer ignoriert`); nr = null; }
      if (derived) nr = row.derivedNr;
      v.owner = canon("deals", "Owner", "owners", v.owner);
      const patch = { customerId: cust.id, ...rowFields(v, ["produkt", "erstellt", "gesendet", "wert", "phase", "chance", "erwarteterAbschluss", "naechsterSchritt", "owner", "kommentar"]) };

      let match = null;
      if (nr != null && !derived) {
        const m = dealByNr.get(nr);
        if (m && m.customerId === cust.id) match = m;
        else if (m) warn("deals", `${where}: Angebotsnr. ${nr} gehört im CRM zu einem anderen Kunden – wird als neues Angebot behandelt`);
      }
      if (!match && v.produkt) match = dealByKey.get(dealKey(cust.id, v.produkt)) ?? null;

      let rec;
      if (match) {
        rec = match;
        if (touched.has(rec.id)) warn("deals", `${where}: Angebot «${rec.produkt}» kommt mehrfach in der Datei vor – Angaben zusammengeführt`);
        touched.add(rec.id);
        if (applyPatch(rec, patch).length) { stampUpd(rec); sum.updated++; } else sum.unchanged++;
      } else {
        const claim = claimNr("deals", nr);
        if (claim.renumbered && !derived) warn("deals", `${where}: Angebotsnr. ${nr} ist bereits vergeben – neue Nr. ${claim.nr}`);
        rec = { id: randomUUID(), nr: claim.nr, phase: "Angebot erstellt", ...patch };
        stampNew(rec);
        db.deals.push(rec);
        dealByNr.set(rec.nr, rec);
        if (rec.produkt) dealByKey.set(dealKey(cust.id, rec.produkt), rec);
        touchedColl.add("deals");
        touched.add(rec.id);
        sum.added++;
      }
      if (nr != null) dealXNr.set(nr, rec);
    }
  }

  // ---------------------------------------------------------------- Lieferantenzuordnung (RFQs)

  {
    const sum = summary.rfqs;
    const touched = new Set();
    const rfqKey = (c, s, p) => `${c}|${s}|${normText(p)}`;
    const rfqIdx = new Map(db.rfqs.map((r) => [rfqKey(r.customerId, r.supplierId, r.produkt), r]));
    for (const row of parsed.tables.rfqs?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      const cust = resolveParty(party.customers, v.kundennr ?? null, v.kunde);
      if (!cust) { sum.skipped++; warn("rfqs", `${where}: Kunde ${refLabel(v.kundennr, v.kunde)} nicht gefunden – Zuordnung übersprungen`); continue; }
      let sup = resolveParty(party.suppliers, v.lieferantennr ?? null, v.lieferant);
      if (!sup && v.lieferant) {
        // Lieferant nur in der Zuordnung erfasst, nicht im Stamm: im Stamm neu anlegen statt Zeile verwerfen.
        const P = party.suppliers;
        const claim = claimNr("suppliers", v.lieferantennr ?? null);
        sup = { id: randomUUID(), nr: claim.nr, firma: String(v.lieferant), ...PARTY_DEFAULTS.suppliers(), contacts: [] };
        if (v.kontakt || v.email) countContact(upsertContact(sup, { name: v.kontakt, email: v.email }, { primary: true }));
        stampNew(sup);
        db.suppliers.push(sup);
        indexParty(P, sup);
        touchedColl.add("suppliers");
        summary.suppliers.added++;
        recState.set(sup.id, "added");
        P.xNr.set(sup.nr, sup);
        P.xName.set(normText(sup.firma), sup);
        warn("rfqs", `${where}: Lieferant «${sup.firma}» war nicht im Lieferantenstamm – als Lieferantennr. ${sup.nr} neu angelegt`);
      }
      if (!sup) { sum.skipped++; warn("rfqs", `${where}: Lieferant ${refLabel(v.lieferantennr, v.lieferant)} nicht im Lieferantenstamm gefunden – Zuordnung übersprungen`); continue; }
      const patch = { customerId: cust.id, supplierId: sup.id, ...rowFields(v, ["produkt", "phase", "gesendetAm", "erhaltenAm", "angebot", "waehrung", "moq", "leadTime", "naechsterSchritt", "kommentar"]) };
      if (v.kontakt) {
        const c = sup.contacts.find((x) => normText(x.name) === normText(v.kontakt));
        if (c && !c.primary) patch.contactId = c.id; // Hauptkontakt = Standard (leer lassen)
      }
      if (v.angebotsnr != null) {
        const d = dealXNr.get(v.angebotsnr) ?? dealByNr.get(v.angebotsnr);
        if (d && d.customerId === cust.id) patch.dealId = d.id;
        else warn("rfqs", `${where}: Angebotsnr. ${v.angebotsnr} gehört nicht zu diesem Kunden – Verknüpfung ignoriert`);
      }

      let match = rfqIdx.get(rfqKey(cust.id, sup.id, v.produkt ?? "")) ?? null;
      if (!match && !v.produkt) {
        const same = db.rfqs.filter((r) => r.customerId === cust.id && r.supplierId === sup.id);
        if (same.length === 1) match = same[0];
      }
      if (match) {
        if (touched.has(match.id)) warn("rfqs", `${where}: Zuordnung Kunde ${cust.nr} ↔ Lieferant ${sup.nr} kommt mehrfach in der Datei vor – Angaben zusammengeführt`);
        touched.add(match.id);
        if (applyPatch(match, patch).length) { stampUpd(match); sum.updated++; } else sum.unchanged++;
      } else {
        const rec = { id: randomUUID(), contactId: "", dealId: "", produkt: "", phase: "Lieferant zugeordnet", waehrung: "CHF", ...patch };
        stampNew(rec);
        db.rfqs.push(rec);
        rfqIdx.set(rfqKey(cust.id, sup.id, rec.produkt), rec);
        touched.add(rec.id);
        sum.added++;
      }
    }
  }

  // ---------------------------------------------------------------- Aktivitäten

  {
    const sum = summary.activities;
    const touched = new Set();
    const byNr = new Map(db.activities.map((a) => [a.nr, a]));
    const key = (a, c, s) => [a.datum, normText(a.typ), idOf(c) || a.customerId || "", idOf(s) || a.supplierId || "", normText(a.notiz)].join("|");
    const idx = new Map(db.activities.map((a) => [key(a, null, null), a]));
    const [lo, hi] = TABLES.activities.nrRange;
    for (const row of parsed.tables.activities?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      if (!v.datum) { sum.skipped++; warn("activities", `${where}: Datum fehlt – Aktivität übersprungen`); continue; }
      const hasC = v.kundennr != null || v.kunde;
      const hasS = v.lieferantennr != null || v.lieferant;
      const cust = hasC ? resolveParty(party.customers, v.kundennr ?? null, v.kunde) : null;
      const sup = hasS ? resolveParty(party.suppliers, v.lieferantennr ?? null, v.lieferant) : null;
      if (hasC && !cust) warn("activities", `${where}: Kunde ${refLabel(v.kundennr, v.kunde)} nicht gefunden`);
      if (hasS && !sup) warn("activities", `${where}: Lieferant ${refLabel(v.lieferantennr, v.lieferant)} nicht gefunden`);
      if (!cust && !sup) { sum.skipped++; warn("activities", `${where}: Weder Kunde noch Lieferant zugeordnet – Aktivität übersprungen`); continue; }
      let nr = v.nr ?? null;
      const derived = nr == null && row.derivedNr != null;
      if (nr != null && (nr < lo || nr > hi)) { warn("activities", `${where}: Aktivitätsnr. ${nr} liegt ausserhalb des Nummernkreises – Nummer ignoriert`); nr = null; }
      if (derived) nr = row.derivedNr;
      v.typ = canon("activities", "Typ", "aktivitaetstypen", v.typ);
      v.owner = canon("activities", "Owner", "owners", v.owner);
      const patch = { ...(cust ? { customerId: cust.id } : {}), ...(sup ? { supplierId: sup.id } : {}), ...rowFields(v, ["datum", "typ", "owner", "notiz", "naechsterSchritt", "faellig", "status"]) };

      let match = null;
      if (nr != null && !derived) {
        const m = byNr.get(nr);
        if (m && compat(m, cust, sup)) match = m;
        else if (m) warn("activities", `${where}: Aktivitätsnr. ${nr} gehört im CRM zu einer anderen Aktivität – wird als neu behandelt`);
      }
      if (!match) match = idx.get(key({ datum: v.datum, typ: v.typ, notiz: v.notiz }, cust, sup)) ?? null;

      if (match) {
        if (touched.has(match.id)) warn("activities", `${where}: Aktivität ${match.nr} kommt mehrfach in der Datei vor – Angaben zusammengeführt`);
        touched.add(match.id);
        if (applyPatch(match, patch).length) { stampUpd(match); sum.updated++; } else sum.unchanged++;
      } else {
        const claim = claimNr("activities", nr);
        if (claim.renumbered && !derived) warn("activities", `${where}: Aktivitätsnr. ${nr} ist bereits vergeben – neue Nr. ${claim.nr}`);
        const status = v.status ?? (v.naechsterSchritt || v.faellig ? "Offen" : "Erledigt");
        const rec = { id: randomUUID(), nr: claim.nr, ...patch, status };
        stampNew(rec);
        db.activities.push(rec);
        byNr.set(rec.nr, rec);
        idx.set(key(rec, null, null), rec);
        touchedColl.add("activities");
        touched.add(rec.id);
        sum.added++;
      }
    }
  }

  // ---------------------------------------------------------------- Aufgaben

  {
    const sum = summary.tasks;
    const touched = new Set();
    const byNr = new Map(db.tasks.map((t) => [t.nr, t]));
    const key = (t, c, s) => [normText(t.aufgabe), t.faellig ?? "", idOf(c) || t.customerId || "", idOf(s) || t.supplierId || ""].join("|");
    const idx = new Map(db.tasks.map((t) => [key(t, null, null), t]));
    const [lo, hi] = TABLES.tasks.nrRange;
    for (const row of parsed.tables.tasks?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      if (!v.aufgabe) { sum.skipped++; warn("tasks", `${where}: Aufgabe fehlt – Zeile übersprungen`); continue; }
      const hasC = v.kundennr != null || v.kunde;
      const hasS = v.lieferantennr != null || v.lieferant;
      const cust = hasC ? resolveParty(party.customers, v.kundennr ?? null, v.kunde) : null;
      const sup = hasS ? resolveParty(party.suppliers, v.lieferantennr ?? null, v.lieferant) : null;
      if (hasC && !cust) warn("tasks", `${where}: Kunde ${refLabel(v.kundennr, v.kunde)} nicht gefunden – Aufgabe «${v.aufgabe}» ohne Kunden-Verknüpfung`);
      if (hasS && !sup) warn("tasks", `${where}: Lieferant ${refLabel(v.lieferantennr, v.lieferant)} nicht gefunden – Aufgabe «${v.aufgabe}» ohne Lieferanten-Verknüpfung`);
      if (!v.faellig) warn("tasks", `${where}: Fälligkeitsdatum fehlt – Aufgabe «${v.aufgabe}» trotzdem übernommen`);
      let nr = v.nr ?? null;
      const derived = nr == null && row.derivedNr != null;
      if (nr != null && (nr < lo || nr > hi)) { warn("tasks", `${where}: Aufgabennr. ${nr} liegt ausserhalb des Nummernkreises – Nummer ignoriert`); nr = null; }
      if (derived) nr = row.derivedNr;
      v.owner = canon("tasks", "Owner", "owners", v.owner);
      const patch = { ...(cust ? { customerId: cust.id } : {}), ...(sup ? { supplierId: sup.id } : {}), ...rowFields(v, ["aufgabe", "faellig", "owner", "prioritaet", "status", "erledigtAm", "kommentar"]) };

      let match = null;
      if (nr != null && !derived) {
        const m = byNr.get(nr);
        if (m && compat(m, cust, sup)) match = m;
        else if (m) warn("tasks", `${where}: Aufgabennr. ${nr} gehört im CRM zu einer anderen Aufgabe – wird als neu behandelt`);
      }
      if (!match) match = idx.get(key(v, cust, sup)) ?? null;

      if (match) {
        if (touched.has(match.id)) warn("tasks", `${where}: Aufgabe ${match.nr} kommt mehrfach in der Datei vor – Angaben zusammengeführt`);
        touched.add(match.id);
        if (applyPatch(match, patch).length) { stampUpd(match); sum.updated++; } else sum.unchanged++;
      } else {
        const claim = claimNr("tasks", nr);
        if (claim.renumbered && !derived) warn("tasks", `${where}: Aufgabennr. ${nr} ist bereits vergeben – neue Nr. ${claim.nr}`);
        const rec = { id: randomUUID(), nr: claim.nr, prioritaet: "B", status: "Offen", ...patch };
        stampNew(rec);
        db.tasks.push(rec);
        byNr.set(rec.nr, rec);
        idx.set(key(rec, null, null), rec);
        touchedColl.add("tasks");
        touched.add(rec.id);
        sum.added++;
      }
    }
  }

  // ---------------------------------------------------------------- Wochenfokus / Freigaben

  {
    const sum = summary.focus;
    for (const row of parsed.tables.focus?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      const cust = resolveParty(party.customers, v.kundennr ?? null, v.kunde);
      if (!cust) { sum.skipped++; warn("focus", `${where}: Kunde ${refLabel(v.kundennr, v.kunde)} nicht gefunden – Eintrag übersprungen`); continue; }
      v.owner = canon("focus", "Owner", "owners", v.owner);
      const patch = rowFields(v, ["blocker", "diese", "owner", "kommentar"]);
      const match = db.focus.find((x) => x.customerId === cust.id);
      if (match) {
        if (applyPatch(match, patch).length) { stampUpd(match); sum.updated++; } else sum.unchanged++;
      } else {
        if (db.focus.length >= MAX_FOCUS) { sum.skipped++; warn("focus", `${where}: Der Wochenfokus ist auf ${MAX_FOCUS} Plätze begrenzt – «${cust.firma}» übersprungen`); continue; }
        const rec = { id: randomUUID(), customerId: cust.id, diese: "Ja", ...patch };
        stampNew(rec);
        db.focus.push(rec);
        sum.added++;
      }
    }
  }
  {
    const sum = summary.approvals;
    for (const row of parsed.tables.approvals?.rows ?? []) {
      const v = { ...row.v };
      const where = `Zeile ${row.row}`;
      if (!v.thema) { sum.skipped++; warn("approvals", `${where}: Thema fehlt – Zeile übersprungen`); continue; }
      const cust = v.kundennr != null ? resolveParty(party.customers, v.kundennr, null) : null;
      if (v.kundennr != null && !cust) warn("approvals", `${where}: Kunde ${v.kundennr} nicht gefunden – «${v.thema}» ohne Kunden-Verknüpfung`);
      const patch = { ...(cust ? { customerId: cust.id } : {}), ...rowFields(v, ["entscheidung", "termin", "status"]) };
      const match = db.approvals.find((x) => normText(x.thema) === normText(v.thema) && (x.customerId || "") === (cust?.id || ""));
      if (match) {
        if (applyPatch(match, patch).length) { stampUpd(match); sum.updated++; } else sum.unchanged++;
      } else {
        const rec = { id: randomUUID(), thema: v.thema, status: "Offen", customerId: "", ...patch };
        stampNew(rec);
        db.approvals.push(rec);
        sum.added++;
      }
    }
  }

  // ---------------------------------------------------------------- Abschluss

  for (const [table, fields] of Object.entries(unknown)) {
    for (const [field, values] of Object.entries(fields)) {
      warn(table, `Unbekannte Werte in «${field}» (trotzdem übernommen): ${[...values].slice(0, 8).join(", ")}${values.size > 8 ? " …" : ""}`);
    }
  }
  for (const coll of touchedColl) db.meta.lastNr[coll] = Math.max(Number(db.meta.lastNr[coll]) || 0, maxNr[coll]);

  const totals = { added: 0, updated: 0, unchanged: 0, skipped: 0, warnings: 0 };
  for (const key of TABLE_ORDER) {
    const s = summary[key];
    if (key !== "contacts") { totals.added += s.added; totals.updated += s.updated; totals.unchanged += s.unchanged; }
    totals.skipped += s.skipped;
    totals.warnings += s.warningCount;
    if (s.warningCount > s.warnings.length) s.warnings.push(`… und ${s.warningCount - s.warnings.length} weitere Hinweise`);
  }
  summary.totals = totals;
  return { db, summary, changed: totals.added + totals.updated > 0 };
}
