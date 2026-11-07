// Wechselkurse für die Mehrwährungs-Anzeige (Basis CHF). Rein rechnerisch, ohne Abhängigkeiten.
// Gespeichert in db.settings.fx = { EUR, USD, date } – «EUR: 0.93» heisst: 1 EUR = 0.93 CHF. Manuell gepflegt (Einstellungen), kein Abruf.
// Die Umrechnung dient nur der Übersicht (≈); gespeichert und fakturiert wird immer in der Originalwährung.

/** Währungen der 3-Zeilen-Anzeige, CHF zuerst */
export const FX_CURS = ["CHF", "EUR", "USD"];
/** Richtwerte, solange noch keine Kurse erfasst sind (date leer = nie bestätigt) */
export const DEFAULT_FX = Object.freeze({ EUR: 0.93, USD: 0.8, date: "" });

const rate = (v) => { const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Kurse bereinigen: ungültige Werte fallen auf den Richtwert zurück, Datum nur als ISO «JJJJ-MM-TT». */
export function normalizeFx(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    EUR: rate(src.EUR) ?? DEFAULT_FX.EUR,
    USD: rate(src.USD) ?? DEFAULT_FX.USD,
    date: typeof src.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(src.date) ? src.date : "",
  };
}

/** Umrechnen über CHF; null, wenn Betrag leer/ungültig oder eine der Währungen nicht umrechenbar ist (z. B. VND). */
export function convert(amount, from, to, fx = DEFAULT_FX) {
  if (amount === null || amount === undefined || amount === "" || Number.isNaN(Number(amount))) return null;
  const v = Number(amount);
  from = from || "CHF";
  if (from === to) return v;
  if (!FX_CURS.includes(from) || !FX_CURS.includes(to)) return null;
  const chf = from === "CHF" ? v : v * fx[from];
  return to === "CHF" ? chf : chf / fx[to];
}

/** Anzeigewert einer umgerechneten Zahl: ganze Einheiten ab 100, sonst zwei Nachkommastellen */
export const roundFx = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
