// Hilfsfunktionen: HTML-Escaping, Formatierung (CHF, Datum), Datums-Arithmetik, IDs.
import { t, locale } from "./i18n.js";

// ------------------------------------------------------------ HTML-Template mit Auto-Escaping

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Markiert bereits sicheres HTML (z. B. Ergebnis von html``). */
export const raw = (s) => new Safe(String(s ?? ""));

function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

/** Tagged Template: Interpolationen werden escaped, ausser sie stammen aus html``/raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}

export const str = (v) => (v instanceof Safe ? v.s : String(v ?? ""));

/**
 * Übersetzung mit Markup: th("banner.local") – der Text des Wörterbuchs darf <strong>, <em>, <code> enthalten;
 * Parameter werden escaped (ausser html``/raw()-Werte). Ergebnis ist «sicheres» HTML für html``-Vorlagen.
 */
export function th(key, params = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(params)) safe[k] = part(v);
  return new Safe(t(key, safe));
}

// ------------------------------------------------------------ IDs

export function uid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    try { return c.randomUUID(); } catch { /* unsicherer Kontext */ }
  }
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ------------------------------------------------------------ Zahlen / Beträge

// Zahlen: Ziffern kommen aus Intl (Sprache de-CH / en-CH), die Schweizer Schreibweise ist in beiden Sprachen gleich:
// Tausender mit Apostroph (67'000), Dezimalpunkt (1'234.50) – so wie Excel und die Eingabefelder sie lesen und schreiben.
const nfCache = {};
const numberFormat = (d) => (nfCache[`${locale()}:${d}`] ??= new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }));

export function fmtNum(n, dec) {
  if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  const abs = Math.abs(v);
  const d = dec ?? (Number.isInteger(abs) ? 0 : 2);
  const parts = numberFormat(d).formatToParts(abs);
  const i = parts.filter((p) => p.type === "integer").map((p) => p.value).join("");
  const f = parts.filter((p) => p.type === "fraction").map((p) => p.value).join("");
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (v < 0 ? "-" : "") + g + (f ? "." + f : "");
}

export const chf = (n) => (n === null || n === undefined || n === "" ? "" : "CHF " + fmtNum(n));

export function money(n, cur = "CHF") {
  if (n === null || n === undefined || n === "") return "";
  return `${cur} ${fmtNum(n, cur === "VND" ? 0 : undefined)}`;
}

/** Einzelpreis mit immer zwei Nachkommastellen: «CHF 12.50» (VND ohne) */
export const price = (n, cur = "CHF") => (n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "" : `${cur} ${fmtNum(n, cur === "VND" ? 0 : 2)}`);

export const fmtPct = (n) => (n === null || n === undefined || n === "" ? "" : `${fmtNum(n, Number.isInteger(+n) ? 0 : 1)} %`);

/** Liest "67'000", "67 000.50", "CHF 1000", "12,5" ... -> number | null (leer) | NaN (ungültig) */
export function parseAmount(s) {
  if (typeof s === "number") return s;
  let t = String(s ?? "").trim().replace(/^(CHF|EUR|USD|VND)\s*/i, "").replace(/[\s'’`´]/g, "");
  if (t === "") return null;
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return parseFloat(t);
}

// ------------------------------------------------------------ Datum (intern ISO "YYYY-MM-DD", Anzeige dd.mm.yyyy)

const pad = (n) => String(n).padStart(2, "0");

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isoToDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso, n) => {
  const dt = isoToDate(iso);
  dt.setDate(dt.getDate() + n);
  return todayISO(dt);
};

/** Datum in beiden Sprachen als dd.mm.yyyy (Schweizer Geschäftsgebrauch) */
export function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "23.10.2026", "23.10.26", "23.10." (laufendes Jahr), "23102026", "2026-10-23" -> ISO | "" (leer) | null (ungültig) */
export function parseDate(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  let d, m, y;
  let x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[.\/-](\d{1,2})[.\/-]?(\d{2}|\d{4})?$/.exec(t))) [, d, m, y] = x;
  else if ((x = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) [, d, m, y] = x;
  else return null;
  y = y ? Number(y) : new Date().getFullYear();
  if (y < 100) y += 2000;
  d = Number(d); m = Number(m);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 1990 || y > 2100) return null;
  return todayISO(dt);
}

export function isoWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((dt - yearStart) / 86400000 + 1) / 7), year: dt.getUTCFullYear() };
}

const wdCache = {};
export const weekday = (iso) => (wdCache[locale()] ??= new Intl.DateTimeFormat(locale(), { weekday: "long" })).format(isoToDate(iso));

/** Sonntag der Woche, in der iso liegt */
export function endOfWeek(iso) {
  const day = isoToDate(iso).getDay() || 7;
  return addDays(iso, 7 - day);
}

export const isOverdue = (iso, today = todayISO()) => Boolean(iso) && iso < today;

/** Relative Beschriftung für Fälligkeiten: "heute", "morgen", "vor 3 Tagen", "in 2 Tagen" (en: today, tomorrow, 3 days ago, in 2 days) */
export function relDay(iso, today = todayISO()) {
  if (!iso) return "";
  const diff = Math.round((isoToDate(iso) - isoToDate(today)) / 86400000);
  if (diff === 0) return t("rel.today");
  if (diff === 1) return t("rel.tomorrow");
  if (diff === -1) return t("rel.yesterday");
  return diff < 0 ? t("rel.daysAgo", { n: -diff }) : t("rel.inDays", { n: diff });
}

// ------------------------------------------------------------ Verschiedenes

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.cancel = () => clearTimeout(t);
  return f;
}

const collators = {};
export const compareText = (a, b) => (collators[locale()] ??= new Intl.Collator(locale(), { numeric: true, sensitivity: "base" })).compare(String(a ?? ""), String(b ?? ""));

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** mailto:/tel:-Links (Werte werden escaped und tel: auf Ziffern/+ reduziert) */
export function mailLink(email) {
  if (!email) return "";
  return html`<a href="mailto:${email}" class="lnk">${email}</a>`;
}
export function telLink(tel) {
  if (!tel) return "";
  const num = String(tel).replace(/[^\d+]/g, "");
  return num ? html`<a href="tel:${num}" class="lnk">${tel}</a>` : html`${tel}`;
}

export function initials(name) {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}
