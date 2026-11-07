// Lieferanten-Dokumente und Zertifikate (ISO 9001/14001/13485, Kalibrierzertifikat, Sonstiges): Typ, Name, Datei (hochgeladen, siehe files.js) ODER Link
// (SharePoint/OneDrive/Web), ausgestellt am, gültig bis, Intervall in Monaten (schlägt die nächste Fälligkeit vor). Ein erneuertes Dokument wird
// archiviert (archiviert: true) und zählt nicht mehr für Warnhinweise. Reine Funktionen (in Node testbar).
import { safeUrl } from "./logistics.js";

export { safeUrl };
export const WARN_DAYS = 60; // so viele Tage vor Ablauf gilt ein Dokument als «läuft bald ab»

const dayNum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };

/** «expired» | «soon» | «ok» | «» (kein Ablaufdatum). today = YYYY-MM-DD */
export function certState(c, today, warnDays = WARN_DAYS) {
  const v = dayNum(c?.gueltigBis), t0 = dayNum(today);
  if (v === null || t0 === null) return "";
  if (v < t0) return "expired";
  return v - t0 <= warnDays ? "soon" : "ok";
}

/** Alle Dokumente eines Lieferanten inkl. archivierter (alte Datensätze ohne Feld: leere Liste) */
export const docsOf = (s) => (Array.isArray(s?.dokumente) ? s.dokumente.filter((d) => d && typeof d === "object") : []);
/** Gültige (nicht archivierte) bzw. archivierte Dokumente */
export const activeDocs = (s) => docsOf(s).filter((d) => !d.archiviert);
export const archivedDocs = (s) => docsOf(s).filter((d) => d.archiviert);

/** Zähler für Warnhinweise {expired, soon} (archivierte Dokumente zählen nicht) */
export function certSummary(s, today) {
  const out = { expired: 0, soon: 0 };
  for (const d of activeDocs(s)) { const st = certState(d, today); if (st === "expired") out.expired++; else if (st === "soon") out.soon++; }
  return out;
}

/** Dokumenttypen (Auswahl im Formular; Beschriftung: cert.type.<wert>) */
export const CERT_TYPES = ["iso9001", "iso14001", "iso13485", "kalibrierung", "sonstiges"];
export const MAX_INTERVAL = 240;

/** Datum + n Monate (YYYY-MM-DD); der Tag bleibt, am Monatsende wird gekürzt (31.01. + 1 Monat = 28./29.02.). Ungültig → "" */
export function addMonths(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  const k = Number(n);
  if (!m || !Number.isInteger(k) || k < 0) return "";
  const total = (+m[1]) * 12 + (+m[2] - 1) + k;
  const y = Math.floor(total / 12), mo = total % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(mo + 1).padStart(2, "0")}-${String(Math.min(+m[3], last)).padStart(2, "0")}`;
}

/** Vorschlag für die nächste Fälligkeit: ausgestellt am + Intervall (Monate); "" wenn eines fehlt */
export const proposeDue = (ausgestelltAm, intervall) => (intervall ? addMonths(ausgestelltAm, intervall) : "");

/**
 * Dokument erneuern: das alte wird archiviert, ein neues (gleicher Typ/Name, neue Daten) tritt an seine Stelle.
 * @returns {{archived: object, fresh: object}} — der Aufrufer ersetzt das alte Dokument durch beide (neues zuerst)
 */
export function renewDoc(doc, next, { today, id }) {
  const archived = { ...doc, archiviert: true, archiviertAm: today };
  const fresh = {
    id, typ: doc.typ || "sonstiges", name: doc.name || "", link: next.link || "", file: next.file || null,
    ausgestelltAm: next.ausgestelltAm || "", gueltigBis: next.gueltigBis || "", intervall: next.intervall ?? doc.intervall ?? null, erneuertVon: doc.id,
  };
  if (!fresh.file) delete fresh.file;
  return { archived, fresh };
}

/** Warnliste für die Übersicht: nicht archivierte, abgelaufene oder innerhalb von warnDays ablaufende Dokumente, dringendste zuerst */
export function certAlerts(suppliers, today, warnDays = WARN_DAYS) {
  const t0 = dayNum(today);
  const out = [];
  for (const s of suppliers || []) {
    for (const d of activeDocs(s)) {
      const state = certState(d, today, warnDays);
      if (state !== "expired" && state !== "soon") continue;
      out.push({ supplierId: s.id, supplier: s.firma, doc: d, state, days: dayNum(d.gueltigBis) - t0 });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
