// Installierbare App (Service Worker) und Web-Push-Benachrichtigungen für den Team-Chat.
//
// - registerSW(): sw.js (App-Hülle offline, Push empfangen, Klick auf die Benachrichtigung öffnet den Chat).
// - Benachrichtigungen: Schalter («Benachrichtigungen aktivieren») im Chat und in den Einstellungen. Ohne VAPID-Schlüssel auf dem Server
//   (/api/push/config → enabled:false) oder ohne Browser-Unterstützung erscheint nichts. iPhone/iPad: Push gibt es nur für die zum
//   Home-Bildschirm hinzugefügte App – in Safari (nicht installiert) steht stattdessen ein Hinweis.
// - Das Abo gehört zu Konto UND Gerät: beim Abmelden wird es entfernt, beim nächsten Start desselben Kontos (Merker in localStorage) erneuert.
import * as api from "./api.js";
import * as store from "./store.js";
import { LS, CHAT_ENABLED, CALENDAR_ENABLED } from "./config.js";

// Push dient nur Chat und Kalender-Erinnerungen: sind beide abgeschaltet, gibt es keine Einstellungskarte und kein Abo-Erneuern
const PUSH_USED = CHAT_ENABLED || CALENDAR_ENABLED;
import { html } from "./util.js";
import { t } from "./i18n.js";
import { icon, toast } from "./ui.js";

// ------------------------------------------------------------ Service Worker

export function registerSW() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("Service Worker:", e?.message || e));
}

/** Ziele, die eine Benachrichtigung öffnen darf: der Chat oder ein Termin des Kalenders (nie beliebige Adressen) */
export const GOTO_RE = /^#\/(?:chat|uebersicht|kalender(?:\/ev_[0-9a-f]{12}(?:\?o=[0-9A-Za-z%:.\-]{10,40})?)?)$/;

/** Klick auf eine Benachrichtigung bei bereits geöffneter App: der Service Worker bittet darum, die Seite zu zeigen (Chat, Termin). */
export function listenSW({ onGoto, onPoll }) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "goto" && typeof e.data.hash === "string" && GOTO_RE.test(e.data.hash)) onGoto(e.data.hash);
    else if (e.data?.type === "poll") onPoll();
  });
}

// ------------------------------------------------------------ Umgebung

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => Boolean(navigator.standalone) || matchMedia("(display-mode: standalone)").matches;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const flagKey = () => LS.push + (store.getMe()?.id || "");
const getFlag = () => { try { return localStorage.getItem(flagKey()) === "1"; } catch { return false; } };
const setFlag = (on) => { try { on ? localStorage.setItem(flagKey(), "1") : localStorage.removeItem(flagKey()); } catch { /* privater Modus */ } };

let cfg = null; // { enabled, publicKey, mail } – einmal je Sitzung
async function config() {
  if (cfg) return cfg;
  if (store.S.mode !== "server" || store.S.noTeam || store.isSuper()) return (cfg = { enabled: false, publicKey: "", mail: false });
  try {
    cfg = await api.pushConfig();
  } catch (e) {
    if (store.handleAuthError(e)) return { enabled: false, publicKey: "", mail: false };
    return { enabled: false, publicKey: "", mail: false }; // nicht merken: nächster Versuch beim nächsten Zeichnen
  }
  return cfg;
}

function keyBytes(b64u) {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

/** @returns {Promise<"hidden"|"ios-install"|"denied"|"off"|"on">} */
export async function status() {
  const c = await config();
  if (!c.enabled) return "hidden";
  if (isIOS() && !isStandalone()) return "ios-install"; // Push gibt es auf iOS nur für die zum Home-Bildschirm hinzugefügte App
  if (!supported()) return "hidden";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  try {
    return (await currentSub()).sub ? "on" : "off";
  } catch { return "off"; }
}

// ------------------------------------------------------------ Ein- und ausschalten

async function subscribeNow() {
  const c = await config();
  const { reg, sub: old } = await currentSub();
  let sub = old;
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(c.publicKey) });
    } catch (e) {
      if (e?.name !== "InvalidStateError") throw e;
      // Abo mit anderem Server-Schlüssel (Schlüssel getauscht): altes entfernen, neu anlegen
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(c.publicKey) });
    }
  }
  await api.pushSubscribe(sub.toJSON());
}

/** Muss aus einem Klick aufgerufen werden (Berechtigungsabfrage). @returns {Promise<"on"|"denied"|"off">} */
export async function enable() {
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  await subscribeNow();
  setFlag(true);
  return "on";
}

export async function disable() {
  setFlag(false);
  const { sub } = await currentSub();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Nach dem Start: war es für dieses Konto auf diesem Gerät eingeschaltet, das Abo beim Server erneuern (z. B. nach erneuter Anmeldung) */
export async function resync() {
  try {
    if (!PUSH_USED || !getFlag() || !supported() || Notification.permission !== "granted") return;
    if (!(await config()).enabled) return;
    await subscribeNow();
  } catch (e) { console.warn("Push-Abo erneuern:", e?.message || e); }
}

/** Vor dem Abmelden: Abo dieses Geräts beim Server entfernen (ein anderes Konto soll nicht dessen Nachrichten erhalten); der Merker bleibt */
export async function detach() {
  try {
    if (!supported() || !api.hasSession()) return;
    const { sub } = await currentSub();
    if (!sub) return;
    await Promise.race([api.pushUnsubscribe(sub.endpoint), new Promise((r) => setTimeout(r, 3000))]);
    await sub.unsubscribe().catch(() => {});
  } catch { /* beim Abmelden nie blockieren */ }
}

// ------------------------------------------------------------ Bedienelement (Chat, Einstellungen)

/** Platzhalter; mount() füllt ihn, sobald Konfiguration und Status bekannt sind. Ohne Funktion bleibt er unsichtbar. */
export const controlHtml = () => html`<div class="push-ctl" data-push-ctl hidden></div>`;

const TEXT = {
  "ios-install": { ic: "bell", msg: "push.iosInstall" },
  denied: { ic: "bell", msg: "push.denied" },
  off: { ic: "bell", msg: "push.offHint", btn: "push.enable" },
  on: { ic: "bell", msg: "push.onHint", btn: "push.disable" },
};

export async function mount(root) {
  const el = root.querySelector("[data-push-ctl]");
  if (!el) return;
  let state = await status();
  if (!el.isConnected) return;
  const paint = (s, busy = false) => {
    state = s;
    const x = TEXT[s];
    el.hidden = !x;
    if (!x) { el.innerHTML = ""; return; }
    el.className = `push-ctl is-${s}`;
    el.innerHTML = html`${icon(x.ic)}<div class="push-msg">${t(x.msg)}</div>${x.btn ? html`<button type="button" class="btn btn-sm ${s === "off" ? "btn-primary" : ""}" data-push-toggle ${busy ? "disabled" : ""}>${t(x.btn)}</button>` : ""}`.toString();
  };
  paint(state);
  el.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-push-toggle]")) return;
    paint(state, true);
    try {
      if (state === "on") { await disable(); paint("off"); toast(t("push.toastOff")); }
      else {
        const r = await enable();
        paint(r);
        if (r === "on") toast(t("push.toastOn"), { type: "ok" });
      }
    } catch (err) {
      if (!store.handleAuthError(err)) toast(t("push.failed", { err: err?.message || "" }), { type: "error", ms: 8000 });
      paint(await status());
    }
  });
}

/** Karte für die Einstellungen (nur Servermodus, nicht für den Superadmin); verschwindet, wenn Push nicht eingerichtet ist */
export function settingsCard() {
  if (!PUSH_USED) return "";
  if (store.S.mode !== "server" || store.S.noTeam || store.isSuper()) return "";
  return html`<section class="card" data-push-card hidden>
    <div class="card-head"><h2>${t("push.title")}</h2></div>
    <div class="pad stack"><p class="help">${t("push.help")}</p>${controlHtml()}</div>
  </section>`;
}

/** Karte in den Einstellungen sichtbar machen, wenn Push nutzbar ist */
export async function mountSettings(root) {
  const card = root.querySelector("[data-push-card]");
  if (!card) return;
  const s = await status();
  if (!card.isConnected) return;
  card.hidden = s === "hidden";
  if (s !== "hidden") mount(card);
}
