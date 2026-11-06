// Einstellungen: Karte «Outlook-Kalender». Jeder Benutzer verbindet seinen EIGENEN Outlook-Kalender (Microsoft-Anmeldung im Browser,
// danach holt der Server die Termine ins Team-Kalender und schreibt – wenn gewünscht – CRM-Termine zurück). Hier: verbinden, Richtung wählen,
// Status sehen, «Jetzt synchronisieren», trennen. Mitglieder sehen nur den Knopf «Mit Microsoft anmelden». Der Superadmin (kein eigener Kalender)
// trägt hier einmalig die App-ID (Client-ID) der Microsoft-App ein – es sind keine Umgebungsvariablen nötig. Solange keine App-ID hinterlegt ist,
// sehen Mitglieder den Hinweis, dass die Anmeldung noch nicht freigeschaltet ist.
import * as api from "../api.js";
import { html, th, fmtDateTime } from "../util.js";
import { t, tryT } from "../i18n.js";
import { icon, toast, confirmDialog } from "../ui.js";

/** Zustand der Karte (überlebt das Neuzeichnen der Seite) */
const ol = { status: null, busy: "", error: "", loadedAt: 0, draft: {} };
const msgOf = (e) => e?.message || "";

function visible() {
  return Boolean(ol.status);
}

function badge() {
  const st = ol.status;
  if (!st) return html`<span class="badge t-grey">${t("ol.badge.loading")}</span>`;
  if (!st.configured) return html`<span class="badge t-grey">${t(st.member ? "ol.badge.locked" : "ol.badge.off")}</span>`;
  if (!st.member) return html`<span class="badge t-green">${t("ol.badge.ready")}</span>`;
  const c = st.connection;
  if (!c) return html`<span class="badge t-grey">${t("ol.badge.disconnected")}</span>`;
  if (c.status === "revoked") return html`<span class="badge t-red">${t("ol.badge.revoked")}</span>`;
  if (c.error) return html`<span class="badge t-red">${t("ol.badge.err")}</span>`;
  return html`<span class="badge t-green">${t("ol.badge.ok")}</span>`;
}

function errorBox(c) {
  const e = c.error;
  if (!e) return "";
  const text = tryT("ol.err." + e.kind) || t("ol.err.other");
  return html`<div class="callout err">${text}${e.code ? html` <code>${e.code}</code>` : ""}${e.at ? html`<br><small>${fmtDateTime(e.at)}</small>` : ""}</div>`;
}

/** Superadmin: App-ID eintragen (einmalig) und Stand der Einrichtung */
function adminBody(st) {
  const b = ol.busy;
  const fromEnv = st.source === "env";
  const idVal = ol.draft.clientId ?? st.setting?.clientId ?? "";
  const tenantVal = ol.draft.tenant ?? st.setting?.tenant ?? "common";
  const status = st.configured
    ? html`<div class="callout ok">${t("ol.admin.ready")}</div>`
    : html`<div class="callout warn">${th("ol.admin.notSetup")}${st.missing?.includes("CRM_SECRET") ? html`<br>${t("ol.admin.noSecret")}` : ""}</div>`;
  const steps = st.configured ? "" : html`<ol class="vars">
      <li>${th("ol.admin.step1")}</li>
      <li>${th("ol.admin.step2")} <code>${st.redirectUri || "https://…/api/outlook/callback"}</code></li>
      <li>${th("ol.admin.step3")}</li></ol>
      <p class="help">${th("ol.admin.help")}</p>`;
  const form = fromEnv
    ? html`<p class="help">${t("ol.admin.fromEnv", { id: st.clientId })}</p>`
    : html`<div class="stack">
        <div class="field"><label for="ol-cid">${t("ol.admin.clientId")}</label>
          <input id="ol-cid" type="text" data-ol-input="clientId" value="${idVal}" placeholder="12345678-abcd-1234-abcd-1234567890ab" autocomplete="off" spellcheck="false" ${b ? "disabled" : ""}></div>
        <div class="field"><label for="ol-tenant">${t("ol.admin.tenant")}</label>
          <input id="ol-tenant" type="text" data-ol-input="tenant" value="${tenantVal}" placeholder="common" autocomplete="off" spellcheck="false" ${b ? "disabled" : ""}>
          <small class="help">${t("ol.admin.tenantHelp")}</small></div>
        <div class="btn-row wrap">
          <button type="button" class="btn btn-primary" data-ol="saveSetup" ${b ? "disabled" : ""}>${b === "saveSetup" ? t("common.save") : t("ol.admin.save")}</button>
          ${st.setting ? html`<button type="button" class="btn" data-ol="clearSetup" ${b ? "disabled" : ""}>${t("ol.admin.clear")}</button>` : ""}
        </div></div>`;
  return html`${status}${steps}${form}
    ${st.configured ? html`<dl class="dl flush"><div><dt>${t("ol.admin.redirect")}</dt><dd><code>${st.redirectUri || "—"}</code></dd></div>
      <div><dt>${t("ol.admin.mode")}</dt><dd>${st.publicClient ? t("ol.admin.modePublic") : t("ol.admin.modeSecret")}</dd></div></dl>
      <p class="help">${t("ol.admin.note")}</p>` : ""}`;
}

function body() {
  const st = ol.status;
  if (!st) return html`<p class="muted">${ol.error ? t("ol.loadFailed", { err: ol.error }) : t("ol.loading")}</p>${ol.error ? html`<div class="btn-row"><button type="button" class="btn btn-sm" data-ol="reload">${t("sp.reload")}</button></div>` : ""}`;
  if (!st.member) return adminBody(st);
  if (!st.configured) return html`<div class="callout warn">${t("ol.member.notReady")}</div>`;
  const c = st.connection;
  const b = ol.busy;
  if (!c) {
    return html`<p class="help">${t("ol.intro")}</p>
      <div class="btn-row wrap"><button type="button" class="btn btn-primary" data-ol="connect" ${b ? "disabled" : ""}>${icon("link")} ${b === "connect" ? t("ol.connecting") : t("ol.connect")}</button></div>
      <p class="help">${t("ol.privacy")}</p>`;
  }
  const revoked = c.status === "revoked";
  return html`<p class="help">${t("ol.intro")}</p>
    ${revoked ? html`<div class="callout warn">${t("ol.revokedText")}</div>` : errorBox(c)}
    <dl class="dl flush">
      <div><dt>${t("ol.dl.account")}</dt><dd>${c.account?.name ? html`${c.account.name} · ` : ""}<code>${c.account?.address || "—"}</code></dd></div>
      <div><dt>${t("ol.dl.direction")}</dt><dd>
        <select data-ol="direction" aria-label="${t("ol.dl.direction")}" ${b ? "disabled" : ""}>
          <option value="in" ${c.direction === "in" ? "selected" : ""}>${t("ol.dir.in")}</option>
          <option value="both" ${c.direction === "both" ? "selected" : ""}>${t("ol.dir.both")}</option></select>
        <div class="help">${c.direction === "both" ? t("ol.dir.bothHelp") : t("ol.dir.inHelp")}</div></dd></div>
      <div><dt>${t("ol.dl.connected")}</dt><dd>${c.connectedAt ? fmtDateTime(c.connectedAt) : "—"}</dd></div>
      <div><dt>${t("ol.dl.lastSync")}</dt><dd>${c.lastSync ? fmtDateTime(c.lastSync) : html`<span class="muted">${t("ol.never")}</span>`}</dd></div>
      <div><dt>${t("ol.dl.count")}</dt><dd>${c.count}</dd></div>
    </dl>
    <div class="btn-row wrap">
      ${revoked
        ? html`<button type="button" class="btn btn-primary" data-ol="connect" ${b ? "disabled" : ""}>${icon("link")} ${t("ol.reconnect")}</button>`
        : html`<button type="button" class="btn btn-primary" data-ol="sync" ${b ? "disabled" : ""}>${icon("repeat")} ${b === "sync" ? t("ol.syncing") : t("ol.sync")}</button>`}
      <button type="button" class="btn" data-ol="disconnect" ${b ? "disabled" : ""}>${t("ol.disconnect")}</button>
    </div>`;
}

function paint() {
  const card = document.querySelector("[data-ol-card]");
  if (!card) return;
  card.hidden = !visible();
  card.querySelector("[data-ol-badge]").innerHTML = badge().toString();
  card.querySelector("[data-ol-body]").innerHTML = body().toString();
}

async function load({ force = false } = {}) {
  if (!force && ol.status && Date.now() - ol.loadedAt < 20000) { paint(); return; }
  ol.error = "";
  try {
    ol.status = await api.olStatus();
    ol.loadedAt = Date.now();
  } catch (e) {
    ol.error = msgOf(e) || t("common.error");
    ol.status = null;
  }
  paint();
}

async function run(kind, fn, okMsg) {
  ol.busy = kind;
  paint();
  try {
    const r = await fn();
    if (r?.configured !== undefined) { ol.status = r; ol.loadedAt = Date.now(); }
    if (okMsg) okMsg(r);
  } catch (e) {
    toast(t("ol.toast.failed", { msg: msgOf(e) }), { type: "error", ms: 9000 });
  } finally {
    ol.busy = "";
    await load({ force: true });
  }
}

const syncNow = () =>
  run("sync", () => api.olSync(), (r) => {
    const x = r.result || {};
    if (x.ok === false) toast(t("ol.toast.syncFailed"), { type: "error", ms: 9000 });
    else toast(x.partial ? t("ol.toast.partial") : t("ol.toast.synced", { added: x.added || 0, updated: x.updated || 0, removed: x.removed || 0 }), { type: "ok" });
  });

/** Rückkehr von Microsoft: #/einstellungen?outlook=connected | error&r=<Grund> */
function handleReturn() {
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  const res = q.get("outlook");
  if (!res) return false;
  try { history.replaceState(null, "", "#/einstellungen"); } catch { /* egal */ }
  if (res === "connected") {
    toast(t("ol.toast.connected"), { type: "ok" });
    return true;
  }
  const why = q.get("r") || "other";
  toast(tryT("ol.return." + why) || t("ol.return.other"), { type: "error", ms: 10000 });
  return false;
}

export function cardHtml({ server } = {}) {
  if (!server) return "";
  return html`<section class="card" data-ol-card hidden>
    <div class="card-head"><h2>${t("ol.title")}</h2><span data-ol-badge>${badge()}</span></div>
    <div class="pad sp-body" data-ol-body>${body()}</div>
  </section>`;
}

const bound = new WeakSet(); // Wurzel-Elemente mit Ereignisbehandlung (die Plattform-Seite zeichnet sich mehrfach neu)

export function bind(root, { server } = {}) {
  if (!server) return;
  const justConnected = handleReturn();
  load({ force: justConnected }).then(() => { if (justConnected && ol.status?.connection?.status === "connected") syncNow(); });
  if (bound.has(root)) return;
  bound.add(root);

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ol]");
    if (!b || b.disabled) return;
    const a = b.dataset.ol;
    if (a === "reload") return load({ force: true });
    if (a === "sync") return syncNow();
    if (a === "saveSetup") {
      const val = (n) => String(root.querySelector(`[data-ol-input=${n}]`)?.value ?? "").trim();
      return run("saveSetup", () => api.olPlatformSave(val("clientId"), val("tenant") || "common"), () => { ol.draft = {}; toast(t("ol.toast.saved"), { type: "ok" }); });
    }
    if (a === "clearSetup") {
      const yes = await confirmDialog({ title: t("ol.admin.clearTitle"), message: t("ol.admin.clearMsg"), confirmLabel: t("ol.admin.clear"), danger: true });
      if (yes) await run("clearSetup", () => api.olPlatformClear(), () => { ol.draft = {}; toast(t("ol.toast.saved"), { type: "ok" }); });
      return;
    }
    if (a === "connect") {
      ol.busy = "connect";
      paint();
      try {
        const { url } = await api.olConnect();
        if (!/^https:\/\/login\.microsoftonline\.com\//.test(url)) throw new Error(t("ol.badUrl"));
        location.assign(url);
      } catch (err) {
        ol.busy = "";
        toast(t("ol.toast.failed", { msg: msgOf(err) }), { type: "error", ms: 9000 });
        paint();
      }
      return;
    }
    if (a === "disconnect") {
      const yes = await confirmDialog({ title: t("ol.disconnectTitle"), message: t("ol.disconnectMsg"), confirmLabel: t("ol.disconnect"), danger: true });
      if (yes) await run("disconnect", () => api.olDisconnect(), () => toast(t("ol.toast.disconnected"), { type: "ok" }));
    }
  });
  root.addEventListener("input", (e) => {
    const n = e.target?.dataset?.olInput;
    if (n) ol.draft[n] = e.target.value;
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches?.("[data-ol=direction]")) run("direction", () => api.olSettings(e.target.value), () => toast(t("ol.toast.saved"), { type: "ok" }));
  });
}
