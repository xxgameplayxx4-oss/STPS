// Start der Anwendung: Daten laden, Anmeldung, Navigation (Hash-Router), Statusanzeige.
import * as store from "./store.js";
import { NAV, navLabel } from "./config.js";
import { html, th, initials, fmtDateTime } from "./util.js";
import { t, tn, has, initI18n, onLangChange } from "./i18n.js";
import { icon, toast, confirmDialog, anyDialogOpen, onDialogsClosed } from "./ui.js";
import { showLogin, showChangePassword, chooseUser, showFatal } from "./auth.js";
import * as api from "./api.js";
import * as presence from "./presence.js";
import * as brand from "./branding.js";
import { ENT } from "./model.js";
import { todayISO } from "./util.js";
import * as dashboard from "./views/dashboard.js";
import * as customers from "./views/customers.js";
import * as deals from "./views/deals.js";
import * as articles from "./views/articles.js";
import * as suppliers from "./views/suppliers.js";
import * as rfqs from "./views/rfqs.js";
import * as shipments from "./views/shipments.js";
import * as tasklogView from "./views/tasklog.js";
import * as TL from "./tasklog.js";
import * as settings from "./views/settings.js";
import * as team from "./views/team.js";
import * as chatView from "./views/chat.js";
import * as calendarView from "./views/calendar.js";
import * as chat from "./chat.js";
import * as push from "./push.js";
import * as users from "./views/users.js";
import * as platform from "./views/platform.js";
import * as invoices from "./views/invoices.js";
import * as board from "./views/board.js";
import * as print from "./views/print.js";
import { initCmdk } from "./cmdk.js";

const VIEWS = {
  uebersicht: dashboard,
  kunden: customers,
  angebote: deals,
  artikel: articles,
  rechnungen: invoices,
  board, // Board: #/board?m=angebote|rechnungen
  druck: print, // Druckansicht ohne Menü: #/druck/offerte/<id> bzw. #/druck/rechnung/<id>
  lieferanten: suppliers,
  zuordnung: rfqs,
  sendungen: shipments, // Sendungen: #/sendungen?status=…&mode=…, Detail #/sendungen/<id>
  [TL.ROUTE]: tasklogView, // Aufgaben & Aktivitäten: #/aufgaben-aktivitaeten?tab=open|done|history&typ=…
  kalender: calendarView, // Team-Kalender: #/kalender, Link aus Erinnerungen: #/kalender/<id>?o=<Beginn>
  chat: chatView,
  team,
  einstellungen: settings,
  benutzer: users, // erreichbar über Einstellungen (Admins)
  plattform: platform, // nur Superadmin
};
const NAV_ALIAS = { benutzer: "einstellungen" }; // Seiten ohne eigenen Menüpunkt: dieser Punkt bleibt markiert
/** Bezeichnung einer Seite (Menüpunkt oder Unterseite wie «Benutzer»); leer, wenn unbekannt */
const pageLabel = (route) => (has(`nav.${route}`) ? navLabel(route) : "");

const $ = (s) => document.querySelector(s);
let started = false;
initI18n(); // <html lang>, statische Texte, Sprachschalter (auch auf Lade- und Anmeldeseite)
push.registerSW(); // Service Worker: installierbare App, Push, App-Hülle offline
brand.init(); // Darstellung des zuletzt angemeldeten Teams auf diesem Gerät (Ladeanzeige, Anmeldeseite), sonst «KGC CRM»

// ------------------------------------------------------------ Router

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const [route, id, sub] = (path || "").split("/");
  return {
    route: route || "uebersicht",
    id: id ? decodeURIComponent(id) : null,
    sub: sub ? decodeURIComponent(sub) : null,
    query: Object.fromEntries(new URLSearchParams(qs || "")),
  };
}

let stale = false;
let lastRoute = null;

function renderView(navigated) {
  const route = { ...parseHash(), navigated };
  // Superadmin ohne betretenes Team: es gibt nur die Plattform (keine Teamdaten)
  if (store.S.noTeam && route.route !== "plattform") { location.hash = "#/plattform"; return; }
  // Alte Adressen (#/aufgaben, #/aktivitaeten) → zusammengeführte Seite mit passendem Reiter (Filter aus der Adresse bleiben erhalten)
  if (route.route in TL.LEGACY_ROUTES) {
    const qs = new URLSearchParams(route.query);
    if (!qs.get("tab")) qs.set("tab", TL.LEGACY_ROUTES[route.route]);
    location.replace(`${location.pathname}${location.search}#/${TL.ROUTE}?${qs}`);
    return;
  }
  const mod = VIEWS[route.route];
  const view = $("#view");
  chat.setOpen(route.route === "chat"); // Chat-Seite offen: schneller Abfrage-Takt (js/chat.js)
  document.body.classList.toggle("print-view", route.route === "druck");
  const y = window.scrollY;
  const focusId = !navigated && document.activeElement?.id?.startsWith("q-") ? document.activeElement.id : null;
  const caret = focusId ? document.activeElement.selectionStart : null;
  const wrap = document.createElement("div");
  wrap.className = "view";
  view.replaceChildren(wrap);
  if (!mod) {
    wrap.innerHTML = html`<div class="page-head"><h1>${t("app.notFound")}</h1></div><p><a class="btn" href="#/uebersicht">${t("app.toOverview")}</a></p>`.toString();
  } else {
    try {
      mod.render(wrap, route);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = html`<div class="card pad"><h2>${t("app.renderFailed")}</h2><p class="muted">${e.message}</p></div>`.toString();
    }
  }
  // Navigation markieren
  document.querySelectorAll("#nav a[data-route]").forEach((a) => {
    const on = a.dataset.route === (NAV_ALIAS[route.route] || route.route);
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const label = mod?.pageTitle ? mod.pageTitle(route) : pageLabel(route.route);
  brand.setTitle(label, mod === print); // Belege: Titel nur «Rechnung 60000», ohne Oberflächen-Marke (KGC)
  if (navigated) {
    document.body.classList.remove("nav-open");
    window.scrollTo(0, 0);
    if (lastRoute !== route.route || route.id) $("#main").focus({ preventScroll: true });
  } else {
    window.scrollTo(0, y);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* ignore */ } }
    }
  }
  lastRoute = route.route;
  stale = false;
  updateNavBadges();
}

// ------------------------------------------------------------ Sprachwechsel

/** Offene Inline-Editoren (Notizen, Listen in den Einstellungen) merken, damit der Sprachwechsel keine Eingaben verwirft */
function snapshotEditors() {
  const snap = { notes: null, lists: [] };
  const notes = document.querySelector("[data-notes-edit]:not([hidden]) [data-notes-ta]");
  if (notes) snap.notes = { value: notes.value, start: notes.selectionStart, end: notes.selectionEnd };
  document.querySelectorAll("form[data-list]").forEach((f) => {
    snap.lists.push({ name: f.dataset.list, rows: [...f.querySelectorAll(".le-row")].map((r) => [...r.querySelectorAll("input")].map((i) => i.value)) });
  });
  return snap;
}

function restoreEditors(snap) {
  if (snap.notes) {
    const view = document.querySelector("[data-notes-view]");
    const edit = document.querySelector("[data-notes-edit]");
    const ta = document.querySelector("[data-notes-ta]");
    if (view && edit && ta) {
      view.hidden = true;
      edit.hidden = false;
      ta.value = snap.notes.value;
      try { ta.setSelectionRange(snap.notes.start, snap.notes.end); } catch { /* ignore */ }
    }
  }
  for (const l of snap.lists) {
    const form = document.querySelector(`form[data-list="${l.name}"]`);
    if (!form) continue;
    const rowsOf = () => [...form.querySelectorAll(".le-row")];
    const now = rowsOf().map((r) => [...r.querySelectorAll("input")].map((i) => i.value));
    if (JSON.stringify(now) === JSON.stringify(l.rows)) continue; // unverändert
    while (rowsOf().length < l.rows.length) form.querySelector('[data-le="add"]').click();
    while (rowsOf().length > l.rows.length) rowsOf().at(-1).querySelector('[data-le="del"]').click();
    rowsOf().forEach((r, i) => r.querySelectorAll("input").forEach((inp, j) => { inp.value = l.rows[i][j] ?? ""; }));
  }
}

/** Sprache gewechselt: Kopfzeile, Menü und aktuelle Seite neu zeichnen – ohne Neuladen, Eingaben und Position bleiben */
function onLanguageChanged() {
  if (!started) return;
  const keep = document.activeElement;
  const snap = snapshotEditors();
  buildNav();
  updateAccount();
  updateDevMode();
  updateStatus();
  updateWho();
  updateChips();
  fillTeamSwitch(null);
  renderView(false);
  restoreEditors(snap);
  if (keep && keep.isConnected && keep.matches("[data-set-lang]")) keep.focus({ preventScroll: true });
  presence.ping(250);
}

/** Nicht neu zeichnen, solange man in einem Formular/Inline-Editor tippt */
function busy() {
  if (anyDialogOpen()) return true;
  const a = document.activeElement;
  return Boolean(a && a.closest && a.closest("[data-notes-edit], .list-ed") && a.matches("input,textarea,select"));
}

let renderTimer = null;
function scheduleRender() {
  if (!started) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (busy()) { stale = true; return; }
    renderView(false);
  }, 30);
}

// ------------------------------------------------------------ Shell (Navigation, Status, Banner)

/** Menüpunkte je nach Modus/Rolle: «Team» nur im Servermodus, «Plattform» nur für den Superadmin (ohne Team: nur die Plattform) */
function visibleNav() {
  const server = store.S.mode !== "local";
  return NAV.filter((n) => (!n.server || server) && (!n.superOnly || (server && store.isSuper())) && (!store.S.noTeam || n.route === "plattform"));
}

/** Tooltip der Menüpunkte: Downstream (Kunden, Angebote) bzw. Upstream (Lieferanten, Zuordnung) */
const streamTip = (route) => ({ kunden: t("stream.downTip"), angebote: t("stream.downTip"), lieferanten: t("stream.upTip"), zuordnung: t("stream.upTip") })[route] || "";

function buildNav() {
  $("#nav-list").innerHTML = visibleNav().map((n) => html`<li><a href="#/${n.route}" data-route="${n.route}" ${streamTip(n.route) ? html`title="${streamTip(n.route)}"` : ""}>${icon(n.icon)}<span>${navLabel(n.route)}</span><span class="nav-badge" data-badge="${n.route}" hidden></span></a></li>`).join("");
}

function updateNavBadges() {
  const over = TL.overdueCount(TL.unify({ tasks: store.all("tasks"), activities: store.all("activities") }), todayISO());
  const b = document.querySelector(`[data-badge="${TL.ROUTE}"]`);
  if (b) { b.hidden = !over; b.textContent = over; b.title = tn("nav.overdueBadge", over); }
  const un = chat.unread();
  const c = document.querySelector('[data-badge="chat"]');
  if (c) { c.hidden = !un; c.textContent = un > 99 ? "99+" : un; c.title = tn("nav.chatBadge", un); }
}

function updateStatus() {
  const s = store.S;
  const el = $("#savestate");
  const map = { saved: ["ok", t("status.saved")], dirty: ["busy", t("status.saving")], saving: ["busy", t("status.saving")], error: ["err", t("status.error")] };
  const [cls, text] = map[s.status] || map.saved;
  el.className = `savestate ${cls}`;
  el.querySelector(".ss-text").textContent = text;
  el.title = s.statusMsg || (s.mode === "local" ? t("status.localSaved") : s.savedAt ? t("status.lastSaved", { at: fmtDateTime(s.savedAt) }) : "");
  el.setAttribute("aria-label", `${text}${s.statusMsg ? ": " + s.statusMsg : ""}`);

  const banner = $("#banner");
  if (s.mode === "local") {
    banner.innerHTML = html`<div class="banner warn" role="status">${icon("alert")}<div>${th("banner.local")}</div></div>`.toString();
  } else if (s.mode === "offline") {
    banner.innerHTML = html`<div class="banner warn" role="status">${icon("cloud")}<div>${th("banner.offline")}</div></div>`.toString();
  } else if (s.status === "error" && s.statusMsg) {
    banner.innerHTML = html`<div class="banner err" role="alert">${icon("alert")}<div>${th("banner.saveFailed", { msg: s.statusMsg })}</div><button type="button" class="btn btn-sm" data-retry>${t("auth.retry")}</button></div>`.toString();
  } else {
    banner.innerHTML = "";
  }
}

/** Nur Lokaler Modus: Auswahl «Ich bin» */
function updateWho() {
  const sel = $("#whoami");
  const me = store.getUser();
  const names = store.ownerNames();
  sel.innerHTML = names.map((n) => html`<option ${n === me ? "selected" : ""}>${n}</option>`).join("");
}

// ------------------------------------------------------------ Konto, Anwesenheit, Superadmin-Ansicht (Kopfzeile)

const roleName = (r) => (has(`role.${r}`) ? t(`role.${r}`) : r);

function updateAccount() {
  const me = store.getMe();
  const server = store.S.mode !== "local" && Boolean(me);
  $("#who-select").hidden = server;
  $("#user-menu").hidden = !server;
  $("#presence-chips").hidden = !server;
  const tm = store.getTeam();
  if (!server) { $("#team-switch-wrap").hidden = true; $("#superbar").hidden = true; return; }
  $("#user-av").textContent = initials(me.displayName);
  $("#user-av").className = `av ${presence.avatarClass(me.id)}`;
  $("#user-name").textContent = me.displayName;
  $("#up-name").textContent = me.displayName;
  $("#up-sub").textContent = `${roleName(me.role)}${tm ? " · " + tm.name : ""}`;

  const bar = $("#superbar");
  if (store.isSuper() && tm) {
    bar.hidden = false;
    // Entwicklungsmodus: das Team bleibt betreten (der Rollenwechsler stellt «admin» immer in dieses Team) – kein «Team verlassen»
    bar.innerHTML = html`${icon("shield")}<div>${th("acct.superbar", { team: tm.name })}</div>${store.S.dev ? "" : html`<button type="button" class="btn btn-sm" data-account="leave">${t("acct.leaveTeam")}</button>`}`.toString();
  } else {
    bar.hidden = true;
    bar.innerHTML = "";
  }
}

/** Entwicklungsmodus: dauerhafter Hinweis + Rollenwechsler (admin / Pascal / Liz / Marco) in der Kopfzeile */
function updateDevMode() {
  const on = Boolean(store.S.dev);
  $("#devbanner").hidden = !on;
  $("#dev-switch-wrap").hidden = !on;
  document.body.classList.toggle("dev-mode", on);
  if (!on) return;
  $("#devbanner-text").textContent = t("dev.banner");
  $("#dev-switch").innerHTML = store.S.devUsers
    .map((u) => html`<option value="${u.key}" ${u.key === store.S.devKey ? "selected" : ""}>${u.displayName} · ${roleName(u.role)}</option>`)
    .join("");
  // Im Entwicklungsmodus gibt es weder Passwort noch Abmelden
  document.querySelectorAll('[data-account="password"], [data-account="logout"]').forEach((b) => { b.hidden = true; });
}

function updateChips() {
  const el = $("#presence-chips");
  const list = presence.chipsHtml();
  const MAX = 6;
  el.innerHTML = html`${list.slice(0, MAX)}${list.length > MAX ? html`<span class="pchip more" title="${t("pres.more", { n: list.length - MAX })}">+${list.length - MAX}</span>` : ""}`.toString();
  el.hidden = !list.length || store.S.mode === "local";
}

/** Superadmin: Team-Wechsler (Teamliste kommt von der Plattform-Seite bzw. wird einmal geladen) */
let teamList = null;
function fillTeamSwitch(teams) {
  if (teams) teamList = teams;
  teams = teamList;
  const wrap = $("#team-switch-wrap");
  const sel = $("#team-switch");
  const show = store.S.mode !== "local" && store.isSuper() && !store.S.dev;
  wrap.hidden = !show;
  if (!show) return;
  const cur = store.getTeam()?.id || "";
  sel.innerHTML = html`<option value="">${t("acct.platformOption")}</option>${(teams || []).map((tm) => html`<option value="${tm.id}" ${tm.id === cur ? "selected" : ""}>${tm.name}${tm.active ? "" : t("acct.inactiveSuffix")}</option>`)}`.toString();
  sel.value = cur;
}

async function loadTeamSwitch() {
  if (!store.isSuper()) return;
  try { fillTeamSwitch((await api.listTeams()).teams); } catch (e) { store.handleAuthError(e); }
}

/**
 * Ziel der aktuellen Seite für die Anwesenheit («woran arbeitet wer»). Der Titel wird sprachunabhängig als spec übertragen
 * ({key, params}); jede Person sieht ihn in ihrer eigenen Sprache (siehe presence.specTitle).
 */
function describePage() {
  const r = parseHash();
  let spec = has(`nav.${r.route}`) ? { key: "pres.page", params: { page: r.route } } : null;
  let recordId = "";
  const coll = r.route === "kunden" ? "customers" : r.route === "lieferanten" ? "suppliers" : r.route === "artikel" ? "articles" : null;
  const rec = coll && r.id ? store.byId(coll, r.id) : null;
  if (rec) {
    spec = { key: "pres.viewRecord", params: { kind: coll, nr: rec.nr ? ENT[coll].fmtNr?.(rec.nr) ?? String(rec.nr) : "", name: ENT[coll].title(rec) } };
    recordId = rec.id;
  }
  return { route: `#/${r.route}${r.id ? "/" + encodeURIComponent(r.id) : ""}`, spec, recordId };
}

function closeUserMenu() {
  $("#user-pop").hidden = true;
  $("#user-btn").setAttribute("aria-expanded", "false");
}

async function doLogout() {
  if (store.isDirty()) await store.flushNow();
  if (store.isDirty()) {
    const ok = await confirmDialog({ title: t("dlg.unsavedTitle"), message: t("dlg.unsavedMsg"), confirmLabel: t("dlg.logoutAnyway"), danger: true });
    if (!ok) return;
  }
  await push.detach(); // Push-Abo dieses Geräts vom Konto lösen (braucht noch das Token)
  store.logout();
  location.reload();
}

async function onAccountAction(act) {
  closeUserMenu();
  if (act === "logout") return doLogout();
  if (act === "leave") return store.enterTeam("");
  if (act === "password") return users.changeOwnPassword();
}

// ------------------------------------------------------------ Start

/** Nur Lokaler Modus: «Ich bin» wählen. Im Servermodus kommt der Benutzer vom Konto. */
async function ensureUser() {
  if (store.S.mode === "local" && !store.ownerNames().includes(store.getUser())) await chooseUser();
}

/** Anmeldung → ggf. Pflicht-Passwortwechsel → Daten laden; Fehler mit «Erneut versuchen» */
async function authLoop(res) {
  while (res.state !== "ready") {
    if (res.state === "login") res = await showLogin(res.message);
    else if (res.state === "change-password") res = await showChangePassword();
    else {
      const failed = res;
      // «Abmelden» (Token verwerfen, Seite neu laden → Anmeldeseite) neben «Erneut versuchen», wenn der Fehler mit einer bestehenden Sitzung auftrat
      const onLogout = failed.canLogout ? () => { store.logout(); location.reload(); } : undefined;
      res = await new Promise((resolve) => showFatal(failed.message, async () => { $("#boot").hidden = false; const r = await store.init(); $("#boot").hidden = true; resolve(r); }, onLogout));
    }
  }
  return res;
}

/** Darstellung des aktiven Teams (Logo, Name, Tab-Symbol) vom Server; im Lokalen Modus gilt der Standard «KGC CRM» */
async function loadBranding() {
  if (store.S.mode === "local") return;
  $("#boot").hidden = false;
  await brand.load({ team: store.getTeam(), isSuper: store.isSuper() });
  $("#boot").hidden = true;
}

async function boot() {
  $("#boot").hidden = false;
  let res = await store.init();
  $("#boot").hidden = true;
  await authLoop(res);
  await ensureUser();
  await loadBranding();
  start();
}

let relogging = false;
async function relogin() {
  if (relogging) return; // mehrere Anfragen melden gleichzeitig «abgelaufen»
  relogging = true;
  try {
    const before = store.getMe()?.id;
    await authLoop({ state: "login", message: () => t("auth.sessionExpired") });
    if (before && store.getMe()?.id !== before) { location.hash = "#/uebersicht"; location.reload(); return; } // anderes Konto: sauber neu starten
    store.flushNow();
    presence.ping(0);
    scheduleRender();
  } finally {
    relogging = false;
  }
}

function start() {
  started = true;
  $("#app").hidden = false;
  buildNav();
  updateWho();
  updateAccount();
  updateDevMode();
  updateStatus();
  initCmdk({ pages: visibleNav }); // Befehlspalette (Strg/Cmd+K, «/»)
  if (store.S.mode !== "local") {
    presence.subscribe(updateChips);
    presence.start({ describe: describePage });
    chat.subscribe(updateNavBadges); // Zeichen «ungelesen» im Menü
    chat.start();
    push.resync(); // Push-Abo dieses Geräts erneuern, falls für dieses Konto eingeschaltet
    push.listenSW({ onGoto: (hash) => { location.hash = hash; }, onPoll: () => chat.poll() });
    if (store.isSuper()) {
      loadTeamSwitch();
      document.addEventListener("crm:teams", (e) => fillTeamSwitch(e.detail));
    }
  }

  store.subscribe((ev) => {
    switch (ev.type) {
      case "data":
        scheduleRender();
        if (ev.remote) toast(t("toast.remoteUpdated"));
        break;
      case "status": updateStatus(); break;
      case "user": updateWho(); scheduleRender(); break;
      case "auth": relogin(); break;
      case "merged": {
        let msg = t("toast.merged");
        if (ev.conflicts.length) msg += ` ${tn("toast.mergedFields", ev.conflicts.length)}`;
        if (ev.renumbered.length) msg += ` ${t("toast.mergedRenumbered", { list: ev.renumbered.map((r) => `${r.from} → ${r.to}`).join(", ") })}`;
        toast(msg, { type: "warn", ms: 9000 });
        break;
      }
      case "recovered": toast(t("toast.recovered"), { type: "warn", ms: 7000 }); break;
      case "conflict-failed":
        confirmDialog({ title: t("dlg.reloadTitle"), message: t("dlg.reloadMsg"), confirmLabel: t("dlg.reload"), danger: true })
          .then((ok) => ok && store.reloadFromServer());
        break;
    }
  });

  onDialogsClosed(() => { if (stale) scheduleRender(); });
  onLangChange(onLanguageChanged);

  window.addEventListener("hashchange", () => renderView(true));
  renderView(true);

  // Bedienung
  $("#nav-toggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#nav-scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.body.classList.remove("nav-open"); });
  $("#whoami").addEventListener("change", (e) => { store.setUser(e.target.value); toast(t("toast.signedInAs", { name: e.target.value })); });
  $("#dev-switch").addEventListener("change", (e) => store.devSwitch(e.target.value));
  $("#savestate").addEventListener("click", () => store.flushNow());
  $("#banner").addEventListener("click", (e) => { if (e.target.closest("[data-retry]")) store.flushNow(); });

  // Konto-Menü (Passwort ändern, Abmelden), «Team verlassen» in der Superadmin-Leiste – auch aus den Einstellungen
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-account]");
    if (act) { onAccountAction(act.dataset.account).catch((err) => toast(err.message || t("toast.actionFailed"), { type: "error" })); return; }
    const btn = e.target.closest("#user-btn");
    if (btn) { const open = $("#user-pop").hidden; $("#user-pop").hidden = !open; btn.setAttribute("aria-expanded", String(open)); return; }
    if (!e.target.closest("#user-pop")) closeUserMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeUserMenu(); });
  $("#team-switch").addEventListener("change", (e) => store.enterTeam(e.target.value).catch((err) => { toast(err.message || t("toast.enterTeamFailed"), { type: "error" }); fillTeamSwitch(null); loadTeamSwitch(); }));

  // Änderungen anderer übernehmen
  setInterval(() => { if (!document.hidden) store.refresh(); }, 45000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) store.flushNow(); else store.refresh();
  });
  window.addEventListener("pagehide", () => store.flushNow());
  window.addEventListener("beforeunload", (e) => {
    if (store.isDirty() && store.S.mode !== "local") { e.preventDefault(); e.returnValue = ""; }
  });
}

window.addEventListener("error", (e) => console.error(e.error || e.message));
boot().catch((e) => {
  console.error(e);
  $("#boot").hidden = true;
  showFatal(() => t("app.startFailed", { msg: e.message }), () => location.reload());
});
