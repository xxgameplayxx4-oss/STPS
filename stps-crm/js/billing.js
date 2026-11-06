import { isDomestic, countryCode } from "./countries.js";

// Artikel, Offerten-Positionen und Rechnungen: reine Rechenlogik (keine DOM-/Store-Abhängigkeit, auch in Node und auf dem Server nutzbar).
//
// Geld: auf 2 Dezimalstellen gerundet (kaufmännisch, symmetrisch). Der Kunde sieht Brutto, Rabatt und Netto – der Einkaufspreis (EK)
// ist ausschliesslich intern (margin) und darf nie auf einem Beleg erscheinen.

// ------------------------------------------------------------ Konstanten

/** Gespeicherte Rechnungsstatus (deutsch). «Überfällig» wird NIE gespeichert, sondern aus Status + Fälligkeit abgeleitet (invoiceStatus). */
export const INVOICE_STATUS = ["Entwurf", "Gesendet", "Bezahlt", "Storniert"];
export const OVERDUE = "Überfällig";

export const DEFAULT_MWST_SATZ = 8.1;
export const DEFAULT_ZAHLUNGSFRIST_TAGE = 30;
export const DEFAULT_INVOICE_START = 60000;

/** Warengruppe A: 100.001 – 100.100. Feste id, damit mehrere Geräte beim Anlegen der Standardwerte keine Duplikate erzeugen. */
export const DEFAULT_WARENGRUPPEN = [{ id: "wg_a", code: "A", name: "Warengruppe A", von: 100001, bis: 100100 }];

/** Rechnungswährungen (Standard CHF) */
export const INVOICE_CURRENCIES = ["CHF", "EUR", "USD"];
export const DEFAULT_CURRENCY = "CHF";

export const defaultBilling = () => ({
  warengruppen: DEFAULT_WARENGRUPPEN.map((g) => ({ ...g })),
  firma: "",
  adresse: "",
  plz: "",
  ort: "",
  landCode: "CH",
  land: "Schweiz",
  telefon: "",
  email: "",
  mwstNr: "",
  uid: "",
  handelsregister: "",
  banks: [], // [{ id, bank, iban, bic, waehrung }]
  mwstSatz: DEFAULT_MWST_SATZ,
  zahlungsfristTage: DEFAULT_ZAHLUNGSFRIST_TAGE,
  invoiceStart: DEFAULT_INVOICE_START,
});

// ------------------------------------------------------------ Land, MWST, Währung, Bankkonto

/** Land (Ländercode «CH» oder Name «Schweiz»/«Switzerland») → Ländercode in Grossbuchstaben (Länderliste js/countries.js); unbekannter Name → "" ; leer → "" */
export function landCode(land) {
  const s = String(land ?? "").trim();
  if (!s) return "";
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return countryCode(s) || "";
}

/** Inland (CH/LI, mit MWST) → true, Ausland (Export, 0 %) → false, Land unbekannt/leer → null */
export function vatByCountry(land) {
  const code = landCode(land);
  if (!code) return String(land ?? "").trim() ? false : null; // unbekannter Name = Ausland, leer = unbekannt
  return isDomestic(code);
}

/** Währung eines Belegs (Standard CHF, nur CHF/EUR/USD) */
export const docCurrency = (doc) => (INVOICE_CURRENCIES.includes(doc?.waehrung) ? doc.waehrung : DEFAULT_CURRENCY);

/** Bankkonten der Währung (in der Reihenfolge der Einstellungen) */
export const banksFor = (billing, currency) => (billing?.banks || []).filter((b) => b.waehrung === currency && (b.iban || b.bank));

/** Konto einer Rechnung: das gewählte (bankId), wenn es zur Währung passt, sonst das erste Konto der Währung; null wenn keines */
export function bankFor(billing, currency, bankId) {
  const list = banksFor(billing, currency);
  return list.find((b) => b.id === bankId) || list[0] || null;
}

/** Absenderzeile «CH-8807 Freienbach» (Ländercode-PLZ Ort) */
export function senderCityLine(b) {
  const plzOrt = [b?.plz, b?.ort].filter(Boolean).join(" ");
  return plzOrt && b?.landCode ? `${b.landCode}-${plzOrt}` : plzOrt;
}

/** 10 Jahre Aufbewahrungspflicht (CH): nur Entwürfe dürfen gelöscht werden, versendete/bezahlte/stornierte Rechnungen bleiben (stornieren statt löschen) */
export const isRetainedInvoice = (inv) => Boolean(inv) && (inv.status || "Entwurf") !== "Entwurf";

// ------------------------------------------------------------ Zahlen

const finite = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
/** Zahl oder Rückfallwert (leere/ungültige Eingaben zählen als fallback) */
export const toNum = (v, fallback = 0) => { const n = finite(v); return Number.isFinite(n) ? n : fallback; };

/** Auf 2 Dezimalstellen runden (symmetrisch um 0, robust gegen 1.005-Effekte) */
export function round2(x) {
  const n = toNum(x);
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

// ------------------------------------------------------------ Artikelnummern

/** 100001 → "100.001"; 1001000 → "1.001.000" (Punkt als Tausendertrenner, keine Dezimalen). Ungültig/leer → "". */
export function fmtArtNr(n) {
  const v = finite(n);
  if (!Number.isFinite(v)) return "";
  const s = String(Math.trunc(Math.abs(v)));
  return (v < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "100.001" | "100'001" | "100’001" | "100 001" | "100001" | 100001 → 100001; sonst null */
export function parseArtNr(s) {
  if (typeof s === "number") return Number.isInteger(s) && s >= 0 ? s : null;
  const str = String(s ?? "").trim().replace(/[.'’ \s]/g, "");
  return /^\d{1,15}$/.test(str) ? Number(str) : null;
}

const gv = (g, k) => { const n = finite(g?.[k]); return Number.isInteger(n) ? n : null; };

/** Die Warengruppe, in deren Nummernbereich nr liegt (oder null). */
export function groupOfNr(gruppen, nr) {
  const n = finite(nr);
  if (!Number.isFinite(n)) return null;
  return (gruppen || []).find((g) => gv(g, "von") !== null && gv(g, "bis") !== null && n >= gv(g, "von") && n <= gv(g, "bis")) || null;
}

/**
 * Nächste freie Artikelnummer der Warengruppe: grösste vergebene Nummer im Bereich + 1 (Lücken werden nicht aufgefüllt, Nummern nie wiederverwendet),
 * bei leerem Bereich `von`. Gibt null zurück, wenn der Bereich voll ist (oder ungültig).
 * @param gruppe  { von, bis }
 */
export function nextArtNr(articles, gruppe) {
  const von = gv(gruppe, "von"), bis = gv(gruppe, "bis");
  if (von === null || bis === null || von > bis) return null;
  let max = von - 1;
  for (const a of articles || []) {
    const n = finite(a?.nr);
    if (Number.isInteger(n) && n >= von && n <= bis && n > max) max = n;
  }
  return max + 1 <= bis ? max + 1 : null;
}

/** Ist die Artikelnummer frei? (exceptId: der Artikel, der gerade bearbeitet wird) */
export const isArtNrFree = (articles, nr, exceptId = null) => !(articles || []).some((a) => a && a.id !== exceptId && finite(a.nr) === finite(nr));

/** Fehlerschlüssel der Warengruppen-Bereiche. [] = in Ordnung. */
export const WG_ERRORS = ["invalid", "von>bis", "overlap", "code"];
/**
 * @returns {string[]} eindeutige Schlüssel: "invalid" (von/bis keine ganzen Zahlen ≥ 0), "von>bis", "overlap" (Bereiche überschneiden sich),
 *   "code" (Kürzel leer oder doppelt)
 */
export function validateRanges(gruppen) {
  const errs = new Set();
  const list = Array.isArray(gruppen) ? gruppen : [];
  const ok = [];
  const codes = new Set();
  for (const g of list) {
    const code = String(g?.code ?? "").trim().toLowerCase();
    if (!code || codes.has(code)) errs.add("code");
    codes.add(code);
    const von = gv(g, "von"), bis = gv(g, "bis");
    if (von === null || bis === null || von < 0 || bis < 0) { errs.add("invalid"); continue; }
    if (von > bis) { errs.add("von>bis"); continue; }
    ok.push([von, bis]);
  }
  ok.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ok.length; i++) if (ok[i][0] <= ok[i - 1][1]) errs.add("overlap");
  return [...errs];
}

// ------------------------------------------------------------ Preise und Beträge

export const nettoFrom = (brutto, rabatt) => round2(toNum(brutto) * (1 - toNum(rabatt) / 100));
/** Rabatt in % aus Brutto und Netto (0 bei Brutto 0) */
export const rabattFrom = (brutto, netto) => (toNum(brutto) === 0 ? 0 : round2((1 - toNum(netto) / toNum(brutto)) * 100));

/** Positionssumme: { brutto, rabattBetrag, netto } (Brutto/Netto = Menge × Stückpreis) */
export function lineTotal(pos) {
  const menge = toNum(pos?.menge);
  const brutto = round2(menge * toNum(pos?.brutto));
  const netto = round2(menge * toNum(pos?.netto));
  return { brutto, rabattBetrag: round2(brutto - netto), netto };
}

/**
 * Belegsummen: brutto = Σ Positionen brutto, rabatt = brutto − netto, netto = Σ Positionen netto, mwst = netto × Satz (nur wenn aktiv), total = netto + mwst.
 * @returns {{brutto:number, rabatt:number, netto:number, mwst:number, total:number}}
 */
export function docTotals(positions, { mwstAktiv = false, mwstSatz = DEFAULT_MWST_SATZ } = {}) {
  let brutto = 0, netto = 0;
  for (const p of positions || []) {
    const l = lineTotal(p);
    brutto += l.brutto;
    netto += l.netto;
  }
  brutto = round2(brutto);
  netto = round2(netto);
  const mwst = mwstAktiv ? round2((netto * toNum(mwstSatz, DEFAULT_MWST_SATZ)) / 100) : 0;
  return { brutto, rabatt: round2(brutto - netto), netto, mwst, total: round2(netto + mwst) };
}

/** Marge eines Artikels – NUR INTERN: betrag = Netto − EK, prozent = Betrag in % des Nettopreises (0 bei Netto 0). */
export function margin(article) {
  const netto = toNum(article?.netto);
  const betrag = round2(netto - toNum(article?.ek));
  return { betrag, prozent: netto === 0 ? 0 : round2((betrag / netto) * 100) };
}

// ------------------------------------------------------------ Rechnungen

/** Gespeicherter Status; «Überfällig» (abgeleitet), wenn die Rechnung «Gesendet» ist und das Fälligkeitsdatum (JJJJ-MM-TT) vor heute liegt. */
export function invoiceStatus(inv, todayISO) {
  const s = inv?.status || "Entwurf";
  return s === "Gesendet" && inv?.faellig && todayISO && String(inv.faellig).slice(0, 10) < todayISO ? OVERDUE : s;
}

/**
 * Nächste Rechnungsnummer: grösste vergebene + 1, mindestens `start` (Standard 60000). lastNr = zuletzt vergebene Nummer (db.meta.lastNr.invoices),
 * damit eine gelöschte letzte Rechnung ihre Nummer nicht zurückgibt.
 */
export function nextInvoiceNr(invoices, start = DEFAULT_INVOICE_START, lastNr = 0) {
  let max = toNum(lastNr);
  for (const i of invoices || []) { const n = finite(i?.nr); if (Number.isFinite(n) && n > max) max = n; }
  const s = Math.trunc(toNum(start, DEFAULT_INVOICE_START)) || DEFAULT_INVOICE_START;
  return Math.max(Math.trunc(max) + 1, s);
}

/** Fälligkeitsdatum: Rechnungsdatum + Zahlungsfrist in Tagen (JJJJ-MM-TT, UTC-sicher) */
export function dueDate(datumISO, tage = DEFAULT_ZAHLUNGSFRIST_TAGE) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datumISO || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Math.trunc(toNum(tage, DEFAULT_ZAHLUNGSFRIST_TAGE))));
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------ Normalisierung (Migration / Import)

const str = (v) => (v === null || v === undefined ? "" : String(v));
const idOk = (v) => (typeof v === "string" && v ? v : null);

/** Position bereinigen; fehlende Zahlen werden 0, netto wird bei fehlendem Wert aus brutto/rabatt berechnet. */
export function normalizePosition(p, newId) {
  const o = p && typeof p === "object" ? p : {};
  const brutto = toNum(o.brutto);
  const rabatt = toNum(o.rabatt);
  const artNr = finite(o.artNr);
  return {
    ...o,
    id: o.id || newId(),
    articleId: idOk(o.articleId),
    artNr: Number.isInteger(artNr) ? artNr : null,
    bezeichnung: str(o.bezeichnung),
    menge: toNum(o.menge, 1),
    einheit: str(o.einheit),
    brutto,
    rabatt,
    netto: Number.isFinite(finite(o.netto)) ? toNum(o.netto) : nettoFrom(brutto, rabatt),
  };
}

/** Positionsliste bereinigen: undefined bleibt undefined (alter Datensatz = manueller Wert), sonst Array. */
export function normalizePositions(list, newId) {
  if (list === undefined || list === null) return undefined;
  return Array.isArray(list) ? list.filter((p) => p && typeof p === "object").map((p) => normalizePosition(p, newId)) : [];
}

/** settings.billing mit Standardwerten auffüllen; ungültige Typen fallen auf den Standard zurück. */
export function normalizeBilling(raw) {
  const def = defaultBilling();
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { ...def };
  for (const k of ["firma", "adresse", "plz", "ort", "landCode", "land", "telefon", "email", "mwstNr", "uid", "handelsregister"]) if (typeof src[k] === "string") out[k] = src[k];
  // Alt: ein Feld «plzOrt» ("8807 Freienbach" / "CH-8807 Freienbach") → plz + ort
  if (typeof src.plzOrt === "string" && src.plzOrt.trim() && !src.plz && !src.ort) {
    const m = /^(?:([A-Za-z]{2})[-\s])?(\d{4,5})\s+(.+)$/.exec(src.plzOrt.trim());
    if (m) { out.plz = m[2]; out.ort = m[3].trim(); if (m[1]) out.landCode = m[1].toUpperCase(); } else out.ort = src.plzOrt.trim();
  }
  out.landCode = out.landCode.trim().toUpperCase();
  // Bankkonten; alt: eine IBAN + Freitext «bank» → ein CHF-Konto
  if (Array.isArray(src.banks)) {
    out.banks = src.banks
      .filter((k) => k && typeof k === "object")
      .map((k, i) => ({ id: k.id || `bk_${i + 1}`, bank: str(k.bank), iban: str(k.iban), bic: str(k.bic), waehrung: INVOICE_CURRENCIES.includes(k.waehrung) ? k.waehrung : DEFAULT_CURRENCY }));
  } else if (str(src.iban).trim() || str(src.bank).trim()) {
    out.banks = [{ id: "bk_1", bank: str(src.bank), iban: str(src.iban), bic: "", waehrung: DEFAULT_CURRENCY }];
  }
  out.mwstSatz = Number.isFinite(finite(src.mwstSatz)) && finite(src.mwstSatz) >= 0 ? Number(src.mwstSatz) : def.mwstSatz;
  out.zahlungsfristTage = Number.isInteger(finite(src.zahlungsfristTage)) && finite(src.zahlungsfristTage) >= 0 ? Number(src.zahlungsfristTage) : def.zahlungsfristTage;
  out.invoiceStart = Number.isInteger(finite(src.invoiceStart)) && finite(src.invoiceStart) > 0 ? Number(src.invoiceStart) : def.invoiceStart;
  if (Array.isArray(src.warengruppen)) {
    out.warengruppen = src.warengruppen
      .filter((g) => g && typeof g === "object")
      .map((g, i) => ({ ...g, id: g.id || `wg_${i + 1}`, code: str(g.code), name: str(g.name), von: toNum(g.von), bis: toNum(g.bis) }));
  }
  return out;
}

/** Artikel bereinigen (Zahlenfelder, Standardwerte). */
export function normalizeArticle(a) {
  const nr = finite(a?.nr);
  const brutto = toNum(a?.brutto);
  const rabatt = toNum(a?.rabatt);
  return {
    ...a,
    nr: Number.isInteger(nr) ? nr : null,
    bezeichnung: str(a?.bezeichnung),
    beschreibung: str(a?.beschreibung),
    einheit: str(a?.einheit),
    warengruppeId: str(a?.warengruppeId),
    customerId: idOk(a?.customerId),
    supplierId: idOk(a?.supplierId),
    lieferantenArtNr: str(a?.lieferantenArtNr),
    waehrung: str(a?.waehrung) || "CHF",
    ek: toNum(a?.ek),
    brutto,
    rabatt,
    netto: Number.isFinite(finite(a?.netto)) ? toNum(a?.netto) : nettoFrom(brutto, rabatt),
    notiz: str(a?.notiz),
  };
}
