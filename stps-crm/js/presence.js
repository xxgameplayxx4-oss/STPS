// Anwesenheit («woran arbeitet wer»): meldet alle 30 s (solange der Tab sichtbar ist) und bei jedem Seitenwechsel,
// wo man gerade ist und ob ein Formular offen ist; liefert die Kolleginnen und Kollegen, die gerade online sind.
// Nur im Servermodus mit Team-Kontext aktiv.
import * as api from "./api.js";
import * as store from "./store.js";
import { html, initials } from "./util.js";
import { t, tryT, has } from "./i18n.js";

const BEAT_MS = 30000;
const STALE_MS = 125000; // der Server zählt 2 Minuten als «online»

let describe = () => ({ route: location.hash, spec: null, recordId: "" });
let editCtx = null; // gesetzt von forms.js, solange ein Datensatz-Formular offen ist
let peers = [];
let skew = 0; // Serverzeit − Browserzeit
let started = false;
let debounceTimer = null;
let last = "";
const listeners = new Set();

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { refreshBanners(); for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } };

/** Einheitliche Avatar-Farbe pro Person (CSS-Klassen ac0 … ac5, keine Inline-Styles wegen CSP) */
export function avatarClass(key) {
  let h = 0;
  for (const c of String(key || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `ac${h % 6}`;
}

/**
 * Titel einer Anwesenheit sprachunabhängig übertragen: spec = { key: "pres.…", params: { kind, nr, name, page } }.
 * Jede Person sieht ihn in ihrer eigenen Sprache (kind = Tabelle, page = Seite → Bezeichnung aus dem Wörterbuch).
 * Ältere Einträge ohne spec zeigen den mitgesendeten Text (title) in der Sprache der Absenderin.
 */
export function specTitle(spec) {
  if (!spec || typeof spec.key !== "string" || !spec.key.startsWith("pres.")) return "";
  const p = { ...(spec.params || {}) };
  if (p.kind) p.kind = has(`ent.${p.kind}.singular`) ? t(`ent.${p.kind}.singular`) : String(p.kind);
  if (p.page !== undefined) p.page = has(`nav.${p.page}`) ? t(`nav.${p.page}`) : String(p.page);
  p.nr = p.nr ? `${p.nr} · ` : "";
  return tryT(spec.key, p) || "";
}
const titleOf = (p) => specTitle(p.spec) || p.title || "";

const isEditing = () => editCtx !== null || document.querySelector("dialog.drawer[open]") !== null || document.querySelector("[data-notes-edit]:not([hidden])") !== null;

/** Titel der Seite → «… bearbeitet» (ein Dialog ist offen, aber nicht über forms.js) */
const toEditing = (spec) => (spec?.key === "pres.page" ? { ...spec, key: "pres.editPage" } : spec?.key === "pres.viewRecord" ? { ...spec, key: "pres.editRecord" } : null);

async function beat(force = true) {
  if (store.S.mode !== "server" || store.S.noTeam || document.hidden || !store.getMe()) return;
  const d = describe();
  const editing = isEditing();
  const spec = editing ? editCtx?.spec || toEditing(d.spec) : d.spec;
  const payload = {
    route: editing && editCtx?.route ? editCtx.route : d.route,
    title: specTitle(spec),
    ...(spec ? { spec } : {}),
    recordId: editing && editCtx ? editCtx.recordId || "" : d.recordId || "",
    relatedIds: editing && editCtx ? editCtx.relatedIds || [] : [],
    editing,
  };
  const key = JSON.stringify(payload);
  if (!force && key === last) return;
  last = key;
  try {
    const r = await api.heartbeat(payload);
    apply(r);
  } catch (e) {
    store.handleAuthError(e); // alles andere (Offline …) ignorieren – der nächste Takt versucht es erneut
  }
}

function apply(r) {
  skew = r.now ? Date.parse(r.now) - Date.now() : 0;
  const myId = store.getMe()?.id;
  // Der Superadmin ist für Mitglieder unsichtbar (der Server liefert ihn ihnen gar nicht; hier zur Sicherheit auch noch)
  peers = (r.presence || []).filter((p) => p.uid !== myId && (store.isSuper() || !p.superadmin));
  emit();
}

/** Zustand sofort (leicht entprellt) melden, wenn er sich geändert hat */
export function ping(ms = 250) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => beat(false), ms);
}

/** @param opts {describe: () => {route, title, recordId}} */
export function start(opts) {
  describe = opts.describe;
  if (started) return;
  started = true;
  setInterval(() => { if (!document.hidden) beat(true); }, BEAT_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(true); });
  window.addEventListener("hashchange", () => ping());
  // Formulare/Dialoge werden an <body> gehängt und wieder entfernt → «bearbeitet gerade» sofort melden
  new MutationObserver(() => ping()).observe(document.body, { childList: true });
  beat(true);
}

/**
 * Formular für einen Datensatz geöffnet. ctx: {title, recordId, relatedIds?, route?}
 * @returns {() => void} beim Schliessen aufrufen
 */
export function beginEdit(ctx) {
  const mine = { relatedIds: [], ...ctx };
  editCtx = mine;
  ping(50);
  return () => {
    if (editCtx === mine) editCtx = null;
    ping(50);
  };
}

// ------------------------------------------------------------ Lesen

const fresh = (p) => Date.now() + skew - Date.parse(p.at) <= STALE_MS;
export const online = () => peers.filter(fresh);
export const othersOn = (recordId) => (recordId ? online().filter((p) => p.recordId === recordId || (p.relatedIds || []).includes(recordId)) : []);

const safeRoute = (r) => (/^#\/[\w\-/%.~]*(\?[\w\-=&%.~]*)?$/.test(r || "") ? r : "");

/** Kleine Avatare der Kolleginnen/Kollegen, die gerade online sind (Kopfzeile) */
export function chipsHtml() {
  return online().map((p) => {
    const tip = t("pres.chip", { name: p.displayName, super: p.superadmin ? t("pres.superSuffix") : "", title: titleOf(p) || t("pres.online"), editing: p.editing ? t("pres.editingSuffix") : "" });
    const href = safeRoute(p.route);
    const inner = html`<span class="av ${avatarClass(p.uid)} ${p.editing ? "editing" : ""}" aria-hidden="true">${initials(p.displayName)}</span><span class="sr">${tip}</span>`;
    return href
      ? html`<a class="pchip" href="${href}" title="${tip}">${inner}</a>`
      : html`<span class="pchip" title="${tip}">${inner}</span>`;
  });
}

function hereInner(recordId) {
  const list = othersOn(recordId);
  return list.map((p) => {
    const same = p.recordId === recordId;
    const what = p.editing ? t("pres.isEditing") : t("pres.isHere");
    const extra = p.editing && !same && titleOf(p) ? ` – ${titleOf(p)}` : "";
    return html`<span class="here-item ${p.editing ? "editing" : ""}"><span class="av ${avatarClass(p.uid)}" aria-hidden="true">${initials(p.displayName)}</span><strong>${p.displayName}</strong> ${what}${extra}</span>`;
  });
}

/** Hinweis «Liz ist auch hier / bearbeitet gerade» für die Detailseite eines Datensatzes (wird live aktualisiert) */
export function hereBanner(recordId) {
  const inner = hereInner(recordId);
  return html`<div class="here" data-here="${recordId}" role="status" aria-live="polite" ${inner.length ? "" : "hidden"}>${inner}</div>`;
}

function refreshBanners() {
  document.querySelectorAll("[data-here]").forEach((el) => {
    const inner = hereInner(el.dataset.here);
    el.innerHTML = inner.map(String).join("");
    el.hidden = inner.length === 0;
  });
}
