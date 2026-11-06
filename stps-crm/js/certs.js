// Lieferanten-Dokumente und Zertifikate (z. B. ISO 9001): Name, Link (SharePoint/OneDrive/Web), gültig bis. Nur Verweise, keine Dateien im CRM.
// Reine Funktionen (in Node testbar).
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

/** Dokumente eines Lieferanten (alte Datensätze ohne Feld: leere Liste) */
export const docsOf = (s) => (Array.isArray(s?.dokumente) ? s.dokumente.filter((d) => d && typeof d === "object") : []);

/** Zähler für Warnhinweise {expired, soon} */
export function certSummary(s, today) {
  const out = { expired: 0, soon: 0 };
  for (const d of docsOf(s)) { const st = certState(d, today); if (st === "expired") out.expired++; else if (st === "soon") out.soon++; }
  return out;
}
