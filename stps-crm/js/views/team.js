// Team: wer ist online, woran arbeitet wer (mit «Hingehen»), letzte Änderungen je Person und als Gesamt-Feed.
// Dazu der «Verlauf» eines Datensatzes (Detailseiten von Kunden/Lieferanten) aus demselben Änderungsprotokoll.
import * as store from "../store.js";
import * as api from "../api.js";
import { ENT } from "../model.js";
import { ROUTE as TASKLOG_ROUTE } from "../tasklog.js";
import { avatarClass, specTitle } from "../presence.js";
import { html, fmtDateTime, fmtDate, initials, compareText } from "../util.js";
import { fmtArtNr } from "../billing.js";
import { t, tn, tv, has, tryT } from "../i18n.js";

// ------------------------------------------------------------ Beschriftungen

/** Anzeigename einer Konto-Rolle (superadmin | admin | member) */
export const roleLabel = (r) => (has(`role.${r}`) ? t(`role.${r}`) : r);
const AREAS = ["customers", "suppliers", "deals", "rfqs", "activities", "tasks", "focus", "approvals", "articles", "invoices", "settings", "lists"]; // Filter «Bereich»
const area = (table) => tryT(`team.area.${table}`) || table;
const areaPlural = (table) => tryT(`team.areaPlural.${table}`) || table;
const verb = (action) => tryT(`team.verb.${action}`) || "";
const LIST_ROUTE = { customers: "kunden", suppliers: "lieferanten", deals: "angebote", rfqs: "zuordnung", activities: TASKLOG_ROUTE, tasks: TASKLOG_ROUTE, focus: "uebersicht", approvals: "uebersicht", articles: "artikel", invoices: "rechnungen", settings: "einstellungen", lists: "einstellungen" };

/** «vor 5 Min.» – nowMs ist die Serverzeit (unabhängig von der Uhr dieses Geräts) */
export function relTime(iso, nowMs = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const s = Math.max(0, Math.round((nowMs - at) / 1000));
  if (s < 45) return t("ago.now");
  const m = Math.round(s / 60);
  if (m < 60) return t("ago.min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("ago.hour", { n: h });
  const d = Math.round(h / 24);
  if (d < 14) return tn("ago.day", d);
  if (d < 60) return tn("ago.week", Math.round(d / 7));
  return fmtDate(iso.slice(0, 10));
}

const fieldLabel = (table, key) => (ENT[table]?.fields.find((f) => f.key === key)?.label || tryT(`f.${table}.${key}`) || (table === "settings" && tryT(`team.bf.${key}`)) || key).replace(/ CHF$/, "");
const goodRoute = (r) => (/^#\/[\w\-/%.~]*(\?[\w\-=&%.~]*)?$/.test(r || "") ? r : "");

/** Ziel eines Protokolleintrags – nur wenn es den Datensatz (bzw. seinen Kunden/Lieferanten) noch gibt */
export function entryHref(e) {
  if (e.action === "delete" || e.count) return "";
  if (e.table === "customers") return store.byId("customers", e.recordId) ? `#/kunden/${e.recordId}` : "";
  if (e.table === "suppliers") return store.byId("suppliers", e.recordId) ? `#/lieferanten/${e.recordId}` : "";
  if (e.ref?.customerId && store.byId("customers", e.ref.customerId)) return `#/kunden/${e.ref.customerId}`;
  if (e.ref?.supplierId && store.byId("suppliers", e.ref.supplierId)) return `#/lieferanten/${e.ref.supplierId}`;
  return LIST_ROUTE[e.table] ? `#/${LIST_ROUTE[e.table]}` : "";
}

/**
 * Das Protokoll speichert die Bezeichnung einmalig (deutsch) beim Ändern. Was daraus ableitbar ist, wird in der gewählten Sprache
 * angezeigt: Sammel-Einträge, Auswahllisten, Aktivitäten («Typ Datum · Firma»), Angebote ohne Produktname sowie Import, Superadmin-Zugriff und Darstellung (Logo).
 */
function entryLabel(e) {
  const label = e.label || "";
  if (e.count) return tn("team.nEntries", e.count);
  if (e.action === "enter" && label === "Superadmin-Zugriff") return t("team.superAccess");
  if (e.action === "branding") return tryT(`team.branding.${e.recordId}`) || label; // recordId: logo | name | reset
  if (e.action === "import") {
    const m = /^(SharePoint|Excel)-Import: (\d+) neu, (\d+) geändert$/.exec(label);
    if (m) return t(m[1] === "SharePoint" ? "team.importSharepoint" : "team.importExcel", { added: m[2], updated: m[3] });
  }
  if (e.table === "lists") return tryT(`list.${e.recordId}.label`) || label;
  if (e.table === "settings") return t("team.billingEntry");
  if (e.table === "activities") {
    const m = /^(.+?)(?: (\d{4}-\d{2}-\d{2}))?(?: · (.+))?$/s.exec(label);
    if (m) return `${m[1] === "Aktivität" ? t("ent.activities.singular") : tv("actType", m[1])}${m[2] ? " " + fmtDate(m[2]) : ""}${m[3] ? " · " + m[3] : ""}`;
  }
  if (e.table === "deals" && /^Angebot(?: \(|$)/.test(label)) return label.replace(/^Angebot/, t("ent.deals.singular"));
  return label;
}

const entryTitle = (e) => {
  if (e.count) return entryLabel(e);
  const nr = e.number ? `${e.table === "articles" ? fmtArtNr(e.number) : e.number} · ` : "";
  return `${nr}${entryLabel(e)}`.trim();
};

function entryLine(e, now, { who = true } = {}) {
  const href = entryHref(e);
  const fields = (e.fields || []).map((k) => fieldLabel(e.table, k));
  const title = entryTitle(e);
  const subject = e.count
    ? html`<span class="area">${areaPlural(e.table)}</span> ${title}`
    : html`<span class="area">${area(e.table)}</span> ${href ? html`<a href="${href}" class="rowlink">${title}</a>` : html`<span class="${e.action === "delete" ? "gone" : ""}">${title}</span>`}`;
  const what = e.action === "import" || e.action === "enter" || e.action === "branding" ? "" : verb(e.action);
  const name = e.anon ? t("team.system") : e.displayName; // Änderungen des Superadmins zeigt der Server Mitgliedern ohne Namen (anon: true)
  return html`<li class="feed-item">
    <span class="av xs ${avatarClass(e.uid)}" aria-hidden="true">${initials(name)}</span>
    <div class="fi-main">
      <div>${who ? html`<strong>${name}</strong>${e.superadmin && store.isSuper() ? html` <span class="badge t-navy">${roleLabel("superadmin")}</span>` : ""} · ` : ""}${subject}${what ? html` <span class="verb v-${e.action}">${what}</span>` : ""}</div>
      ${fields.length ? html`<div class="muted fi-fields">${fields.slice(0, 5).join(", ")}${fields.length > 5 ? ` … (+${fields.length - 5})` : ""}</div>` : ""}
    </div>
    <time datetime="${e.at}" title="${fmtDateTime(e.at)}">${relTime(e.at, now)}</time>
  </li>`;
}

// ------------------------------------------------------------ Team-Seite

const st = { data: null, feed: [], uid: "", table: "", error: "", loading: false, timer: null };

const presenceTitle = (p) => specTitle(p.spec) || p.title || "";

function userCard(u, now, myId) {
  const me = u.id === myId;
  const p = u.presence;
  const route = goodRoute(p?.route);
  const since = u.lastSeenAt || u.lastLoginAt;
  return html`<article class="team-card ${p ? "is-online" : ""}" data-uid="${u.id}">
    <header class="tc-head">
      <span class="av lg ${avatarClass(u.id)}" aria-hidden="true">${initials(u.displayName)}</span>
      <div class="tc-who">
        <h3>${u.displayName}${me ? html` <span class="muted">${t("team.you")}</span>` : ""}</h3>
        <div class="muted">${roleLabel(u.role)}${u.ownerKey && u.ownerKey !== u.displayName ? ` · ${t("team.responsible", { name: u.ownerKey })}` : ""}</div>
      </div>
      <span class="online ${p ? "on" : ""}"><span class="odot" aria-hidden="true"></span>${p ? t("team.online") : t("team.offline")}</span>
    </header>
    <div class="tc-now">
      ${p
        ? html`<div class="tc-title">${presenceTitle(p) || t("team.inCrm")}</div>
          <div class="tc-actions">${p.editing ? html`<span class="badge t-amber">${t("pres.isEditing")}</span>` : html`<span class="badge t-green">${t("team.active")}</span>`}
            ${!me && route ? html`<a class="btn btn-sm btn-primary" href="${route}" data-goto>${t("team.goto")}</a>` : ""}</div>`
        : html`<div class="muted">${since ? t("team.lastActive", { when: relTime(since, now) }) : t("team.neverSignedIn")}</div>`}
    </div>
    <h4 class="tc-sub">${t("team.recent")}</h4>
    ${u.recent?.length ? html`<ul class="feed compact">${u.recent.map((e) => entryLine(e, now, { who: false }))}</ul>` : html`<p class="muted tc-empty">${t("team.noChanges")}</p>`}
  </article>`;
}

function visitorCard(v) {
  const route = goodRoute(v.route);
  return html`<article class="team-card is-online visitor" data-uid="${v.uid}">
    <header class="tc-head">
      <span class="av lg ${avatarClass(v.uid)}" aria-hidden="true">${initials(v.displayName)}</span>
      <div class="tc-who"><h3>${v.displayName}</h3><div class="muted">${t("team.superadminFull")}</div></div>
      <span class="online on"><span class="odot" aria-hidden="true"></span>${t("team.online")}</span>
    </header>
    <div class="tc-now"><div class="tc-title">${presenceTitle(v) || t("team.inCrm")}</div>
      <div class="tc-actions">${v.editing ? html`<span class="badge t-amber">${t("pres.isEditing")}</span>` : html`<span class="badge t-navy">${t("team.supportView")}</span>`}${route ? html`<a class="btn btn-sm btn-primary" href="${route}" data-goto>${t("team.goto")}</a>` : ""}</div></div>
  </article>`;
}

function paint(root) {
  const cards = root.querySelector("[data-team-cards]");
  const feed = root.querySelector("[data-feed]");
  if (!cards || !feed) return;
  const d = st.data;
  if (!d) {
    cards.innerHTML = html`<p class="muted">${st.error ? t("team.loadFailed", { err: st.error }) : t("common.loading")}</p>`.toString();
    feed.innerHTML = "";
    return;
  }
  const now = Date.parse(d.now) || Date.now();
  const myId = store.getMe()?.id;
  const users = [...d.users].sort((a, b) => Number(Boolean(b.presence)) - Number(Boolean(a.presence)) || (a.id === myId ? -1 : b.id === myId ? 1 : 0) || compareText(a.displayName, b.displayName));
  cards.innerHTML = html`${users.map((u) => userCard(u, now, myId))}${(store.isSuper() ? d.visitors || [] : []).map(visitorCard)}`.toString();

  // Filter «Person»: nur neu aufbauen, wenn sich die Personen ändern (sonst verliert man den Fokus)
  const sel = root.querySelector('[data-feed-filter="uid"]');
  const sig = d.users.map((u) => u.id).join(",");
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = html`<option value="">${t("team.all")}</option>${d.users.map((u) => html`<option value="${u.id}">${u.displayName}</option>`)}`.toString();
    sel.dataset.sig = sig;
  }
  sel.value = st.uid;
  feed.innerHTML = st.feed.length
    ? html`<ul class="feed">${st.feed.map((e) => entryLine(e, now))}</ul>`.toString()
    : html`<p class="muted pad">${st.uid || st.table ? t("team.fltNone") : t("team.fltEmpty")}</p>`.toString();
}

async function refresh(root) {
  if (st.loading) return;
  st.loading = true;
  try {
    const [team, feed] = await Promise.all([api.team(), api.audit({ uid: st.uid, table: st.table, limit: 50 })]);
    st.data = team;
    st.feed = feed.entries;
    st.error = "";
  } catch (e) {
    if (store.handleAuthError(e)) return;
    st.error = e.message || t("common.error");
  } finally {
    st.loading = false;
  }
  if (root.isConnected) paint(root);
}

export function render(root) {
  clearInterval(st.timer);
  if (store.S.mode !== "server" || store.S.noTeam) {
    root.innerHTML = html`<div class="page-head"><h1>${t("nav.team")}</h1></div><p class="muted">${t("team.onlyServer")}</p>`.toString();
    return;
  }
  root.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.team")}</h1><p class="intro">${t("team.intro")}</p></div></div>
    <div class="team-grid" data-team-cards></div>
    <section class="card" aria-labelledby="h-feed">
      <div class="card-head"><h2 id="h-feed">${t("team.recent")}</h2>
        <div class="toolbar feed-filters">
          <label class="flt"><span>${t("team.person")}</span><select data-feed-filter="uid"><option value="">${t("team.all")}</option></select></label>
          <label class="flt"><span>${t("team.area")}</span><select data-feed-filter="table"><option value="">${t("team.all")}</option>${AREAS.map((k) => html`<option value="${k}" ${k === st.table ? "selected" : ""}>${areaPlural(k)}</option>`)}</select></label>
        </div></div>
      <div data-feed></div>
    </section>`.toString();
  paint(root);
  root.addEventListener("change", (e) => {
    const f = e.target.dataset?.feedFilter;
    if (!f) return;
    st[f] = e.target.value;
    refresh(root);
  });
  refresh(root);
  st.timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(st.timer); return; }
    if (!document.hidden) refresh(root);
  }, 10000);
}

// ------------------------------------------------------------ Verlauf eines Datensatzes (Detailseiten)

const hist = new Map(); // recordId -> {entries, version}

export function historyCard() {
  return html`<section class="card" data-history aria-labelledby="h-history">
    <div class="card-head"><h2 id="h-history">${t("team.history")}</h2></div>
    <div data-history-body><p class="muted pad">${t("common.loading")}</p></div>
  </section>`;
}

/** Füllt die Karte «Verlauf» und aktualisiert sie, wenn die eigenen Änderungen gespeichert wurden. */
export function bindHistory(root, recordId) {
  const body = root.querySelector("[data-history-body]");
  if (!body || store.S.mode !== "server" || store.S.noTeam) { root.querySelector("[data-history]")?.remove(); return; }
  const paintList = (entries) => {
    const now = Date.now();
    body.innerHTML = entries.length
      ? html`<ul class="feed">${entries.map((e) => entryLine(e, now))}</ul>`.toString()
      : html`<p class="muted pad">${t("team.fltEmpty")}</p>`.toString();
  };
  const cached = hist.get(recordId);
  if (cached) paintList(cached.entries);
  const load = async () => {
    try {
      const r = await api.audit({ recordId, related: 1, limit: 30 });
      hist.set(recordId, { entries: r.entries, version: store.S.version });
      if (body.isConnected) paintList(r.entries);
    } catch (e) {
      if (store.handleAuthError(e)) return;
      if (body.isConnected && !hist.get(recordId)) body.innerHTML = html`<p class="muted pad">${t("team.historyFailed", { err: e.message })}</p>`.toString();
    }
  };
  if (!cached || cached.version !== store.S.version) load();
  const off = store.subscribe((ev) => {
    if (!body.isConnected) { off(); return; }
    if (ev.type === "status" && store.S.status === "saved" && hist.get(recordId)?.version !== store.S.version) load();
  });
}
