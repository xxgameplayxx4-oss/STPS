// Mehrsprachigkeit (Deutsch = Standard, Englisch): t(key, params), Pluralformen, Sprachwahl pro Browser, Sprachschalter «DE | EN».
//
// - Wörterbücher: js/i18n/de.js und js/i18n/en.js (flache Schlüssel; Wert = Text oder {one, other} für Pluralformen).
// - Interpolation: «{name}» wird durch params.name ersetzt. Pluralformen wählt params.n (Intl.PluralRules).
// - Gespeicherte Datenwerte (Phasen, Status, Prioritäten …) bleiben deutsch in der Datenbank (Excel-Import/-Export!);
//   nur ihre Anzeige läuft über tv(gruppe, wert) → «val.<gruppe>.<wert>».
// - Die gewählte Sprache steht in localStorage («stps-crm:lang», Standard Deutsch) und in <html lang>.
import de from "./i18n/de.js";
import en from "./i18n/en.js";
import { translateEn } from "./i18n/server-text.js";

export const LANGS = ["de", "en"];
export const LOCALES = { de: "de-CH", en: "en-CH" };
export const LANG_KEY = "stps-crm:lang";
const DICTS = { de, en };

const readStored = () => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.includes(v) ? v : "de";
  } catch { return "de"; }
};

let lang = readStored();
const listeners = new Set();

export const getLang = () => lang;
export const locale = () => LOCALES[lang];

/** Auf Änderungen der Sprache reagieren (Neuzeichnen). Gibt eine Funktion zum Abmelden zurück. */
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ------------------------------------------------------------ Übersetzen

const plurals = {};
const pluralOf = (n) => (plurals[lang] ??= new Intl.PluralRules(locale())).select(Number(n));

/** Textbaustein wählen: Zeichenkette oder Pluralobjekt {zero?, one, other} */
function pick(entry, params) {
  if (entry === undefined || entry === null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object") return null;
  const n = params?.n;
  if (n === undefined) return entry.other ?? entry.one ?? null;
  if (Number(n) === 0 && entry.zero !== undefined) return entry.zero;
  return entry[pluralOf(n)] ?? entry.other ?? null;
}

const fill = (tpl, params) => tpl.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m));

/** Gibt es diesen Schlüssel in der aktuellen Sprache? */
export const has = (key) => DICTS[lang][key] !== undefined;

/** Roher Baustein der Sprache (Deutsch als Rückfall); null, wenn unbekannt */
function lookup(key, params) {
  return pick(DICTS[lang][key], params) ?? pick(DICTS.de[key], params);
}

/**
 * t("dash.kpi.customers") · t("toast.saved", { entity: "Kunde" }) · t("tbl.count.customers", { n: 3 })
 * Unbekannte Schlüssel werden als Schlüssel selbst angezeigt (fällt sofort auf).
 */
export function t(key, params) {
  const tpl = lookup(key, params);
  return tpl === null ? key : fill(tpl, params);
}

/** Wie t(), aber null statt des Schlüssels, wenn er fehlt oder ein Platzhalter keinen Wert hat (für Serverfehler-Zuordnung). */
export function tryT(key, params) {
  const tpl = lookup(key, params);
  if (tpl === null) return null;
  const out = fill(tpl, params);
  return /\{\w+\}/.test(out) ? null : out;
}

/** Pluralform bequem: tn("n.offers", 3) = t("n.offers", { n: 3 }) */
export const tn = (key, n, params) => t(key, { ...params, n });

/** Anzeigename eines gespeicherten (deutschen) Datenwerts. group: phase | custStatus | suppStatus | taskStatus | source | actType | yesNo | ownerRole | prio | invStatus */
export function tv(group, value) {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  const hit = DICTS[lang][`val.${group}.${s}`];
  return typeof hit === "string" ? hit : s;
}

/** Wert ohne bekannte Gruppe (Badges): in allen Gruppen suchen (gleiche deutsche Werte haben dieselbe Übersetzung). */
const ANY_GROUPS = ["phase", "custStatus", "suppStatus", "taskStatus", "yesNo", "invStatus", "shipStatus"];
export function tvAny(value) {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  for (const g of ANY_GROUPS) {
    const hit = DICTS[lang][`val.${g}.${s}`];
    if (typeof hit === "string") return hit;
  }
  return s;
}

// ------------------------------------------------------------ Serverfehler

/** Deutschen Text des Servers (Import-Hinweise, Dateifehler) in der gewählten Sprache anzeigen; unbekannte Texte bleiben wie geliefert. */
export function serverText(text) {
  const s = typeof text === "string" ? text : "";
  return lang === "en" ? translateEn(s) ?? s : s;
}

/**
 * Übersetzt die Antwort der API ({error: code, message, reason?, ...}) anhand des stabilen Codes.
 * Unbekannter Code → Nachricht des Servers. Sprachabhängige Zusätze kommen als Felder der Antwort (z. B. retryAfter, min, max, team).
 */
export function errorText(body) {
  if (!body || typeof body !== "object") return "";
  const code = body.error;
  if (code) {
    const params = { ...body };
    if (typeof body.retryAfter === "number") params.n = Math.max(1, Math.ceil(body.retryAfter / 60));
    const keys = [body.reason ? `err.${code}.${body.reason}` : null, `err.${code}`].filter(Boolean);
    for (const k of keys) {
      const s = tryT(k, params);
      if (s) return s;
    }
  }
  return serverText(body.message);
}

// ------------------------------------------------------------ Statische Texte (index.html)

/**
 * data-i18n="schlüssel"            → Textinhalt
 * data-i18n-attr="aria-label:k;title:k2" → Attribute
 */
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

// ------------------------------------------------------------ Sprachschalter «DE | EN»

const SWITCH_HTML = () => `<div class="seg" role="group" aria-label="${t("lang.label")}">${LANGS.map((l) => `<button type="button" class="seg-btn" data-set-lang="${l}" lang="${l}" aria-pressed="${l === lang}" aria-label="${t("lang.name." + l)}" title="${t("lang.name." + l)}">${l.toUpperCase()}</button>`).join("")}</div>`;

/** Füllt alle Elemente mit [data-lang-switch] (Kopfzeile, Anmeldeseiten) bzw. aktualisiert deren Zustand. */
export function mountSwitches() {
  document.querySelectorAll("[data-lang-switch]").forEach((host) => {
    const group = host.querySelector(".seg");
    if (!group) { host.innerHTML = SWITCH_HTML(); return; }
    group.setAttribute("aria-label", t("lang.label"));
    group.querySelectorAll("[data-set-lang]").forEach((b) => {
      const l = b.dataset.setLang;
      b.setAttribute("aria-pressed", String(l === lang));
      b.setAttribute("aria-label", t("lang.name." + l));
      b.title = t("lang.name." + l);
    });
  });
}

/** Sprache wechseln: speichern, <html lang>, statische Texte, Schalter, danach alle Abonnenten (Neuzeichnen) */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* privater Modus o. Ä.: gilt nur bis zum Neuladen */ }
  syncDocument();
  for (const fn of [...listeners]) { try { fn(next); } catch (e) { console.error(e); } }
}

function syncDocument() {
  document.documentElement.lang = locale();
  applyStatic();
  mountSwitches();
}

let started = false;
/** Einmal beim Start: <html lang>, statische Texte, Schalter, Klick-Handler */
export function initI18n() {
  if (started) return;
  started = true;
  syncDocument();
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-set-lang]");
    if (b) setLang(b.dataset.setLang);
  });
}
