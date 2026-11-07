// Team-Kalender: Monatsansicht und Liste (anstehend / vergangen), Termine anlegen, ändern und löschen (Seitenpanel).
// Alle Termine kommen von /api/calendar (nur das eigene Team; der Superadmin sieht das betretene Team). Wiederholungen löst der Server auf:
// der Browser zeichnet nur die gelieferten Vorkommen. Zeiten sind UTC-ISO und werden in der Zeitzone des Browsers angezeigt.
// Die Farbe der Termine ist der Akzent des Teams (--accent, siehe branding.js). CRM-Fristen (Aufgaben, Rechnungen, Follow-ups) erscheinen
// schreibgeschützt in Grau und führen zum Datensatz. Der Zustand bleibt beim Neuzeichnen der Seite erhalten (Modul-Zustand «st»).
// Erinnerungen versendet die geplante Function calendar-reminders.mjs; ein Klick auf die Benachrichtigung öffnet #/kalender/<id>.
import * as store from "../store.js";
import * as api from "../api.js";
import * as push from "../push.js";
import { LS, OVERDUE } from "../config.js";
import * as TL from "../tasklog.js";
import { statusOf } from "./docs.js";
import { html, raw, todayISO, fmtDate } from "../util.js";
import { t, tn, tv, locale } from "../i18n.js";
import { icon, toast, confirmDialog, openForm } from "../ui.js";

export const pageTitle = () => t("nav.kalender");

const FRESH_MS = 30000;
const LIST_STEP_DAYS = 90;
const LIST_MAX_DAYS = 720;
const MAX_CHIPS = 3;
const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const FREQS = ["daily", "weekly", "monthly", "yearly"];
const DAY = 86400000;

// ------------------------------------------------------------ Zustand

const readPrefs = () => {
  try { const p = JSON.parse(localStorage.getItem(LS.cal) || "{}"); return p && typeof p === "object" ? p : {}; } catch { return {}; }
};
const prefs = readPrefs();
const st = {
  view: prefs.view === "list" ? "list" : "month",
  list: prefs.list === "past" ? "past" : "upcoming",
  crm: prefs.crm !== false,
  ol: prefs.ol !== false, // Outlook-Termine anzeigen
  cursor: null, // erster Tag des angezeigten Monats
  selected: todayISO(),
  days: LIST_STEP_DAYS, // Liste: so viele Tage voraus bzw. zurück
  data: null, // { key, at, occs, events: Map, members, truncated }
  error: "",
  seq: 0,
};
function savePrefs() {
  try { localStorage.setItem(LS.cal, JSON.stringify({ view: st.view, list: st.list, crm: st.crm, ol: st.ol })); } catch { /* privater Modus */ }
}

// ------------------------------------------------------------ Datum und Zeit (lokale Zeitzone des Browsers)

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayKey(d); };
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich"; } catch { return "Europe/Zurich"; } };
const fmtTime = (d) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const longDay = (s) => parseDay(s).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (s) => parseDay(s).toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" });
const monthTitle = (d) => d.toLocaleDateString(locale(), { month: "long", year: "numeric" });

/** Wanduhr (lokales Datum + Uhrzeit) → UTC-ISO */
function toIso(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

/** Ein Vorkommen als Objekt mit lokalen Tagen: startDay/endDay (einschliesslich), Zeiten, Ende in ms (exklusiv) */
function shape(o, ev) {
  if (o.allDay) {
    return { kind: "ev", id: o.eventId, ev, key: o.start, allDay: true, startDay: o.start, endDay: o.end, endMs: parseDay(addDays(o.end, 1)).getTime(), startMs: parseDay(o.start).getTime(), start: o.start, end: o.end };
  }
  const s = new Date(o.start);
  const e = new Date(o.end);
  const last = e.getTime() > s.getTime() ? new Date(e.getTime() - 1) : e;
  return { kind: "ev", id: o.eventId, ev, key: o.start, allDay: false, startDay: dayKey(s), endDay: dayKey(last), startMs: s.getTime(), endMs: Math.max(e.getTime(), s.getTime()), s, e, start: o.start, end: o.end };
}

// ------------------------------------------------------------ CRM-Fristen (schreibgeschützt)

function crmItems(fromDay, toDay) {
  if (!st.crm) return [];
  const out = [];
  const inRange = (d) => d && d >= fromDay && d <= toDay;
  // Offene Aufgaben und Aktivitäten (nächster Schritt) mit Frist; Link: Reiter «Offen» der zusammengeführten Seite
  for (const it of TL.dueIn(TL.unify({ tasks: store.all("tasks"), activities: store.all("activities") }), fromDay, toDay)) {
    out.push({ kind: "crm", type: it.kind === "todo" ? "task" : "activity", day: it.due, label: it.title || (it.kind === "todo" ? "" : tv("actType", it.typ)), href: TL.href({ tab: "open" }) });
  }
  for (const inv of store.all("invoices")) {
    const s = statusOf(inv);
    if ((s === "Gesendet" || s === OVERDUE) && inRange(inv.faellig)) out.push({ kind: "crm", type: "invoice", day: inv.faellig, label: t("inv.label", { nr: inv.nr }), href: `#/rechnungen/${inv.id}` });
  }
  for (const c of store.all("customers")) {
    if (c.phase !== "Abschluss Ja" && c.phase !== "Abschluss Nein" && inRange(c.followUp)) out.push({ kind: "crm", type: "followup", day: c.followUp, label: c.firma || "", href: `#/kunden/${c.id}` });
  }
  return out;
}

// ------------------------------------------------------------ Laden

function monthRange() {
  const first = st.cursor;
  const offset = (first.getDay() + 6) % 7; // Woche beginnt am Montag
  const from = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 42);
  return { from, to };
}

function currentRange() {
  if (st.view === "month") return monthRange();
  // auf Tage gerundet, damit der Zeitraum (und damit der Zwischenspeicher) beim Neuzeichnen gleich bleibt; «jetzt» filtert die Darstellung
  const today = todayISO();
  if (st.list === "past") return { from: parseDay(addDays(today, -st.days)), to: parseDay(addDays(today, 1)) };
  return { from: parseDay(addDays(today, -1)), to: parseDay(addDays(today, st.days + 1)) };
}

async function fetchRange(range, force) {
  const key = `${range.from.toISOString()}|${range.to.toISOString()}`;
  if (!force && st.data && st.data.key === key && Date.now() - st.data.at < FRESH_MS) return false;
  const seq = ++st.seq;
  try {
    const r = await api.calList(range.from.toISOString(), range.to.toISOString());
    if (seq !== st.seq) return false;
    st.data = { key, at: Date.now(), events: new Map(r.events.map((e) => [e.id, e])), occs: r.occurrences, members: r.members, truncated: r.truncated, outlook: r.outlook || { enabled: false } };
    st.error = "";
  } catch (e) {
    if (seq !== st.seq) return false;
    if (store.handleAuthError(e)) return false;
    st.error = e.message || "";
  }
  return true;
}

const hasData = () => Boolean(st.data);

/** Alle Einträge (Termine + CRM-Fristen) des aktuell geladenen Zeitraums */
function items() {
  if (!st.data) return [];
  const evs = st.data.occs.map((o) => { const ev = st.data.events.get(o.eventId); return ev && (st.ol || ev.source !== "outlook") ? shape(o, ev) : null; }).filter(Boolean);
  const r = currentRange();
  return [...evs, ...crmItems(dayKey(r.from), dayKey(new Date(r.to.getTime() - 1)))];
}

const sortKeyOnDay = (it, day) => (it.kind === "crm" ? -0.5 : it.allDay || it.startDay !== day ? -1 : it.startMs);

/** Map Tag → Einträge (mehrtägige Termine erscheinen an jedem Tag) */
function byDay(list) {
  const m = new Map();
  const put = (day, it) => { if (!m.has(day)) m.set(day, []); m.get(day).push(it); };
  for (const it of list) {
    if (it.kind === "crm") { put(it.day, it); continue; }
    let d = it.startDay;
    for (let n = 0; n < 40 && d <= it.endDay; n++, d = addDays(d, 1)) put(d, it);
  }
  for (const [day, arr] of m) arr.sort((a, b) => sortKeyOnDay(a, day) - sortKeyOnDay(b, day) || String(a.ev ? evTitle(a.ev) : a.label).localeCompare(String(b.ev ? evTitle(b.ev) : b.label)));
  return m;
}

// ------------------------------------------------------------ Darstellung

/** Titel eines Termins; private Outlook-Termine anderer Mitglieder erscheinen nur als «Beschäftigt» */
const evTitle = (ev) => (ev.busy ? t("cal.outlook.busy") : ev.title || (ev.source === "outlook" ? t("cal.outlook.noTitle") : ""));
const isOl = (it) => it.ev?.source === "outlook";
const olBadge = (long) => html`<span class="cal-olb ${long ? "is-long" : ""}" title="${t("cal.outlook.badge")}">${long ? t("cal.outlook.badge") : "O"}</span>`;
const itemTitle = (it) => (it.kind === "crm" ? it.label : evTitle(it.ev));

function timeLabel(it, day) {
  if (it.kind === "crm") return t(`cal.crm.${it.type}`);
  if (it.allDay || (day && it.startDay !== day)) return t("cal.allDay");
  const a = fmtTime(it.s);
  if (it.endMs <= it.startMs) return a;
  if (it.endDay !== it.startDay) return `${a} – ${shortDay(it.endDay)} ${fmtTime(it.e)}`;
  return `${a} – ${fmtTime(it.e)}`;
}

function whoLabel(it) {
  const ids = it.ev.participants || [];
  if (!ids.length) return t("cal.participants.team");
  const names = ids.map((id) => st.data?.members.find((m) => m.id === id)?.displayName).filter(Boolean);
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function badges(it) {
  const ev = it.ev;
  return html`${ev.source === "outlook" ? olBadge(true) : ""}${ev.repeat ? html`<span class="cal-ico" title="${t("cal.repeating")}">${icon("repeat")}</span>` : ""}${ev.reminders?.length ? html`<span class="cal-ico" title="${t("cal.hasReminders")}">${icon("bell")}</span>` : ""}`;
}

function chipHtml(it, day) {
  if (it.kind === "crm") {
    return html`<a class="cal-ev cal-crm" href="${it.href}" title="${t(`cal.crm.${it.type}`)}: ${it.label}"><span class="cal-ev-t">${it.label}</span></a>`;
  }
  const past = it.endMs < Date.now();
  const time = it.allDay || it.startDay !== day ? "" : fmtTime(it.s);
  return html`<button type="button" class="cal-ev ${it.allDay || it.startDay !== day ? "is-allday" : ""} ${past ? "is-past" : ""} ${isOl(it) ? "is-outlook" : ""}" data-ev="${it.id}" data-occ="${it.start}" title="${isOl(it) ? t("cal.outlook.badge") + ": " : ""}${evTitle(it.ev)}">${time ? html`<span class="cal-ev-time">${time}</span>` : ""}${isOl(it) ? olBadge(false) : ""}<span class="cal-ev-t">${evTitle(it.ev)}</span></button>`;
}

function monthHtml() {
  const { from } = monthRange();
  const today = todayISO();
  const days = byDay(items());
  const wd = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" }));
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const day = dayKey(d);
    const list = days.get(day) || [];
    const other = d.getMonth() !== st.cursor.getMonth();
    const shown = list.slice(0, MAX_CHIPS);
    const rest = list.length - shown.length;
    const dots = list.slice(0, 3).map((it) => html`<i class="cal-dot ${it.kind === "crm" ? "is-crm" : isOl(it) ? "is-outlook" : ""}"></i>`);
    cells += html`<div class="cal-cell ${other ? "is-other" : ""} ${day === today ? "is-today" : ""} ${day === st.selected ? "is-selected" : ""}" role="gridcell" tabindex="${day === st.selected ? 0 : -1}" data-cal-day="${day}" aria-selected="${day === st.selected}" aria-label="${longDay(day)}${list.length ? ", " + tn("cal.n.events", list.length) : ""}">
      <span class="cal-num">${d.getDate()}</span>
      <div class="cal-chips">${shown.map((it) => chipHtml(it, day))}${rest > 0 ? html`<button type="button" class="cal-more" data-cal-pick="${day}" aria-haspopup="dialog" aria-expanded="false" aria-label="${t("cal.more", { n: rest })}, ${longDay(day)}">${t("cal.more", { n: rest })}</button>` : ""}</div>
      <div class="cal-dots" aria-hidden="true">${dots}${list.length > 3 ? html`<small>+</small>` : ""}</div>
      ${rest > 0 ? html`<button type="button" class="cal-more-sm" data-cal-pick="${day}" aria-haspopup="dialog" aria-expanded="false" aria-label="${t("cal.more", { n: rest })}, ${longDay(day)}">+${rest}</button>` : ""}
    </div>`.toString();
  }
  return html`<div class="cal-grid" role="grid" aria-label="${monthTitle(st.cursor)}">
    <div class="cal-wd" role="row">${wd.map((w) => html`<span role="columnheader">${w}</span>`)}</div>
    <div class="cal-days">${raw(cells)}</div>
  </div>`;
}

function rowHtml(it, day) {
  if (it.kind === "crm") {
    return html`<li><a class="cal-row is-crm" href="${it.href}"><span class="cal-rt">${t(`cal.crm.${it.type}`)}</span><span class="cal-rmain"><strong>${it.label}</strong></span><span class="cal-ico">${icon("chevron-right")}</span></a></li>`;
  }
  const past = it.endMs < Date.now();
  return html`<li><button type="button" class="cal-row ${past ? "is-past" : ""} ${isOl(it) ? "is-outlook" : ""}" data-ev="${it.id}" data-occ="${it.start}">
    <span class="cal-rt">${timeLabel(it, day)}</span>
    <span class="cal-rmain"><strong>${evTitle(it.ev)}</strong><span class="muted">${[it.ev.location, whoLabel(it)].filter(Boolean).join(" · ")}</span></span>
    <span class="cal-rico">${badges(it)}</span>
  </button></li>`;
}

function agendaHtml() {
  const list = byDay(items()).get(st.selected) || [];
  return html`<div class="card-head"><h2>${longDay(st.selected)}</h2><button type="button" class="btn btn-sm btn-primary" data-cal-new="${st.selected}">${icon("plus")} ${t("cal.agenda.add")}</button></div>
    ${list.length ? html`<ul class="cal-rows">${list.map((it) => rowHtml(it, st.selected))}</ul>` : html`<p class="cal-empty muted">${t("cal.empty.day")}</p>`}`;
}

function listHtml() {
  const now = Date.now();
  const past = st.list === "past";
  const all = items().filter((it) => (it.kind === "crm" ? (past ? it.day < todayISO() : it.day >= todayISO()) : past ? it.endMs < now : it.endMs >= now));
  // je Tag: der Beginn des Vorkommens (mehrtägige Termine zählen am ersten Tag)
  const groups = new Map();
  for (const it of all) {
    const day = it.kind === "crm" ? it.day : it.startDay;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(it);
  }
  const order = [...groups.keys()].sort();
  if (past) order.reverse();
  for (const [day, arr] of groups) arr.sort((a, b) => (sortKeyOnDay(a, day) - sortKeyOnDay(b, day)) * (past ? -1 : 1));
  if (!order.length) return html`<p class="cal-empty muted">${past ? t("cal.empty.past") : t("cal.empty.upcoming")}</p>`;
  const today = todayISO();
  const head = (day) => (day === today ? `${t("rel.today")} · ${shortDay(day)}` : day === addDays(today, 1) ? `${t("rel.tomorrow")} · ${shortDay(day)}` : longDay(day));
  return html`${order.map((day) => html`<section class="cal-group"><h3 class="cal-day-head">${head(day)}</h3><ul class="cal-rows">${groups.get(day).map((it) => rowHtml(it, day))}</ul></section>`)}
    ${st.days < LIST_MAX_DAYS ? html`<p class="cal-loadmore"><button type="button" class="btn btn-sm" data-cal-more>${past ? t("cal.loadOlder") : t("cal.loadMore")}</button></p>` : ""}
    ${st.data?.truncated ? html`<p class="help">${t("cal.truncated")}</p>` : ""}`;
}

// ------------------------------------------------------------ Seite

export async function render(root, route) {
  if (store.S.mode !== "server" || store.S.noTeam) {
    root.innerHTML = html`<div class="page-head"><h1>${t("nav.kalender")}</h1></div><p class="muted">${t("cal.onlyServer")}</p>`.toString();
    return;
  }
  if (!st.cursor) st.cursor = monthStart(new Date());
  const team = store.getTeam();
  root.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.kalender")}${team ? html` <span class="muted">· ${team.name}</span>` : ""}</h1><p class="intro">${t("cal.intro")}</p></div>
      <div class="head-actions"><button type="button" class="btn btn-primary" data-cal-new="">${icon("plus")} ${t("cal.new")}</button></div></div>
    ${push.controlHtml()}
    <section class="card cal-card" aria-label="${t("nav.kalender")}">
      <div class="cal-bar" data-cal-bar></div>
      <div class="cal-body" data-cal-body></div>
    </section>
    <section class="card cal-agenda" data-cal-agenda></section>`.toString();
  push.mount(root);

  let pop = null;
  let popAnchor = null;
  let closePop = () => {};
  const bar = root.querySelector("[data-cal-bar]");
  const body = root.querySelector("[data-cal-body]");
  const agenda = root.querySelector("[data-cal-agenda]");

  const paint = () => {
    if (!root.isConnected) return;
    if (pop) closePop();
    const month = st.view === "month";
    bar.innerHTML = html`
      <div class="seg seg-view" role="group" aria-label="${t("cal.view.aria")}">
        <button type="button" class="seg-btn" data-cal-view="month" aria-pressed="${month}">${t("cal.view.month")}</button>
        <button type="button" class="seg-btn" data-cal-view="list" aria-pressed="${!month}">${t("cal.view.list")}</button>
      </div>
      ${month ? html`<div class="cal-nav">
          <button type="button" class="icon-btn" data-cal-nav="prev" aria-label="${t("cal.prev")}" title="${t("cal.prev")}">${icon("chevron-left")}</button>
          <button type="button" class="icon-btn" data-cal-nav="next" aria-label="${t("cal.next")}" title="${t("cal.next")}">${icon("chevron-right")}</button>
          <button type="button" class="btn btn-sm" data-cal-nav="today">${t("cal.today")}</button>
          <h2 class="cal-title" aria-live="polite">${monthTitle(st.cursor)}</h2></div>`
        : html`<div class="seg seg-view" role="group" aria-label="${t("cal.list.aria")}">
          <button type="button" class="seg-btn" data-cal-list="upcoming" aria-pressed="${st.list === "upcoming"}">${t("cal.list.upcoming")}</button>
          <button type="button" class="seg-btn" data-cal-list="past" aria-pressed="${st.list === "past"}">${t("cal.list.past")}</button></div>`}
      <span class="cal-filters"><label class="check cal-crm-toggle"><input type="checkbox" data-cal-crm ${st.crm ? "checked" : ""}> <span>${t("cal.crm.show")}</span></label>
      ${st.data?.outlook?.enabled ? html`<label class="check cal-ol-toggle"><input type="checkbox" data-cal-ol ${st.ol ? "checked" : ""}> <span>${t("cal.outlook.show")}</span></label>` : ""}</span>`.toString();
    if (!hasData()) {
      body.innerHTML = html`<p class="cal-empty muted">${st.error ? html`${t("cal.loadFailed", { err: st.error })} <button type="button" class="btn btn-sm" data-cal-retry>${t("auth.retry")}</button>` : t("common.loading")}</p>`.toString();
      agenda.hidden = true;
      return;
    }
    body.innerHTML = (month ? monthHtml() : listHtml()).toString();
    agenda.hidden = !month;
    if (month) agenda.innerHTML = agendaHtml().toString();
    if (st.error) body.insertAdjacentHTML("afterbegin", html`<p class="err cal-err" role="alert">${t("cal.loadFailed", { err: st.error })}</p>`.toString());
  };

  const refresh = async (force = false) => {
    const changed = await fetchRange(currentRange(), force);
    if (changed || force) paint();
  };
  const reload = () => refresh(true);

  paint();
  refresh();
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (!document.hidden && !document.querySelector("dialog[open]")) refresh(true);
  }, 60000);

  const narrow = () => matchMedia("(max-width: 720px)").matches;

  // ---- «+N weitere»: Popover mit allen Terminen des Tages (Esc, Klick daneben oder Bildlauf schliesst)
  closePop = (restoreFocus = false) => {
    if (!pop) return;
    const a = popAnchor;
    pop.remove();
    pop = null;
    popAnchor = null;
    document.removeEventListener("pointerdown", onPopOutside, true);
    document.removeEventListener("keydown", onPopKey, true);
    window.removeEventListener("resize", onPopResize);
    window.removeEventListener("hashchange", onPopResize);
    a?.setAttribute("aria-expanded", "false");
    if (restoreFocus && a?.isConnected) a.focus({ preventScroll: true });
  };
  const onPopOutside = (e) => { if (pop && !pop.contains(e.target) && !popAnchor?.contains(e.target)) closePop(); };
  const onPopResize = () => closePop();
  const onPopKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
    if (e.key === "Tab" && pop) {
      const f = [...pop.querySelectorAll("button, a[href]")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const openPop = (anchor) => {
    const day = anchor.dataset.calPick;
    if (pop && popAnchor === anchor) { closePop(true); return; }
    closePop();
    const list = byDay(items()).get(day) || [];
    pop = document.createElement("div");
    pop.className = "cal-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", `${longDay(day)}, ${tn("cal.n.events", list.length)}`);
    pop.innerHTML = html`<div class="cal-pop-head"><strong>${longDay(day)}</strong><button type="button" class="icon-btn" data-cal-popclose aria-label="${t("common.close")}" title="${t("common.close")}">${icon("x")}</button></div>
      <ul class="cal-rows">${list.map((it) => rowHtml(it, day))}</ul>`.toString();
    // an <body> hängen: ein Vorfahre der Seite verschiebt sonst den Bezugspunkt von position: fixed
    document.body.appendChild(pop);
    pop.addEventListener("click", (e) => {
      if (e.target.closest("[data-cal-popclose]")) { closePop(true); return; }
      const ev = e.target.closest("[data-ev]");
      if (ev) { closePop(); openEvent(ev.dataset.ev, reload); return; }
      if (e.target.closest("a.cal-row")) closePop();
    });
    popAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    // Position: unter dem Anker, am Rand des Fensters begrenzt (Handy: Breite = Fenster minus Rand)
    const vw = document.documentElement.clientWidth;
    const vh = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    const m = 8;
    const w = Math.min(340, vw - 2 * m);
    pop.style.width = `${w}px`;
    pop.style.maxHeight = `${vh - 2 * m}px`;
    const r = anchor.getBoundingClientRect();
    const h = Math.min(pop.offsetHeight, vh - 2 * m);
    let left = Math.max(m, Math.min(r.left, vw - w - m));
    let top = r.bottom + 4;
    if (top + h > vh - m) top = Math.max(m, r.top - h - 4);
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    document.addEventListener("pointerdown", onPopOutside, true);
    document.addEventListener("keydown", onPopKey, true);
    window.addEventListener("resize", onPopResize);
    window.addEventListener("hashchange", onPopResize);
    pop.querySelector(".cal-row")?.focus({ preventScroll: true });
  };
  const pick = (day) => {
    st.selected = day;
    const d = parseDay(day);
    if (d.getMonth() !== st.cursor.getMonth() || d.getFullYear() !== st.cursor.getFullYear()) { st.cursor = monthStart(d); paint(); refresh(); } else paint();
    root.querySelector(`[data-cal-day="${day}"]`)?.focus({ preventScroll: true });
  };

  // ---- Bedienung
  root.addEventListener("click", async (e) => {
    const q = (s) => e.target.closest(s);
    if (q("[data-cal-popclose]")) { closePop(true); return; }
    const chip = q("[data-ev]");
    if (chip) { closePop(); openEvent(chip.dataset.ev, reload); return; }
    if (q("a.cal-ev, a.cal-row")) { closePop(); return; } // CRM-Frist: normaler Link
    const nw = q("[data-cal-new]");
    if (nw) { newEvent(nw.dataset.calNew || st.selected, reload); return; }
    const view = q("[data-cal-view]");
    if (view) { st.view = view.dataset.calView; savePrefs(); paint(); refresh(); return; }
    const list = q("[data-cal-list]");
    if (list) { st.list = list.dataset.calList; st.days = LIST_STEP_DAYS; savePrefs(); paint(); refresh(); return; }
    const nav = q("[data-cal-nav]");
    if (nav) {
      const a = nav.dataset.calNav;
      if (a === "today") { st.cursor = monthStart(new Date()); st.selected = todayISO(); }
      else {
        st.cursor = new Date(st.cursor.getFullYear(), st.cursor.getMonth() + (a === "next" ? 1 : -1), 1);
        const sel = parseDay(st.selected);
        st.selected = dayKey(new Date(st.cursor.getFullYear(), st.cursor.getMonth(), Math.min(sel.getDate(), new Date(st.cursor.getFullYear(), st.cursor.getMonth() + 1, 0).getDate())));
      }
      paint();
      refresh();
      return;
    }
    if (q("[data-cal-more]")) { st.days = Math.min(LIST_MAX_DAYS, st.days + LIST_STEP_DAYS); paint(); refresh(); return; }
    if (q("[data-cal-retry]")) { reload(); return; }
    const more = q("[data-cal-pick]");
    if (more) { e.stopPropagation(); openPop(more); return; }
    const cell = q("[data-cal-day]");
    if (cell) {
      const day = cell.dataset.calDay;
      if (narrow()) pick(day); // Handy: erst den Tag wählen, «Termin hinzufügen» darunter
      else { pick(day); newEvent(day, reload); }
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-cal-crm]")) { st.crm = e.target.checked; savePrefs(); paint(); }
    if (e.target.matches("[data-cal-ol]")) { st.ol = e.target.checked; savePrefs(); paint(); }
  });
  root.addEventListener("keydown", (e) => {
    const cell = e.target.closest?.("[data-cal-day]");
    if (!cell || e.target !== cell) return;
    const day = cell.dataset.calDay;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); pick(addDays(day, step)); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (narrow()) pick(day); else newEvent(day, reload); }
  });

  // ---- Link aus einer Benachrichtigung: #/kalender/<id>?o=<Beginn>
  if (route?.id) {
    const id = route.id;
    const occ = route.query?.o || "";
    history.replaceState(null, "", "#/kalender"); // nicht bei jedem Neuzeichnen erneut öffnen
    if (occ && !Number.isNaN(Date.parse(occ))) {
      const d = new Date(occ);
      st.view = "month";
      st.cursor = monthStart(d);
      st.selected = dayKey(d);
      paint();
      refresh();
    }
    openEvent(id, reload);
  }
}

// ------------------------------------------------------------ Termin öffnen / anlegen

async function ensureMembers() {
  if (!st.data) await fetchRange(currentRange(), true);
  return st.data?.members || [];
}

async function openEvent(id, onDone) {
  let ev = st.data?.events.get(id) || null;
  try {
    // Immer den aktuellen Stand holen (rev für die Konflikterkennung)
    ev = (await api.calGet(id)).event;
  } catch (e) {
    if (store.handleAuthError(e)) return;
    if (e.status === 404) { toast(t("cal.notFound"), { type: "error" }); onDone?.(); return; }
    if (!ev) { toast(e.message, { type: "error" }); return; }
  }
  if (ev?.source === "outlook") { await viewOutlookEvent(ev); return; }
  await editEvent({ ev, onDone });
}

/** Termine aus Outlook sind im CRM nur lesbar: Details in einem Hinweisfenster */
async function viewOutlookEvent(ev) {
  const when = ev.allDay
    ? (ev.start === ev.end ? longDay(ev.start) : `${longDay(ev.start)} – ${longDay(ev.end)}`)
    : `${new Date(ev.start).toLocaleString(locale(), { dateStyle: "full", timeStyle: "short" })} – ${new Date(ev.end).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
  const names = (ev.participants || []).map((id) => st.data?.members.find((m) => m.id === id)?.displayName).filter(Boolean).join(", ");
  const link = typeof ev.webLink === "string" && /^https:\/\//i.test(ev.webLink) ? ev.webLink : "";
  await confirmDialog({
    title: evTitle(ev),
    message: html`<dl class="dl flush">
        <div><dt>${t("cal.f.when")}</dt><dd>${when}</dd></div>
        ${ev.location ? html`<div><dt>${t("cal.f.location")}</dt><dd>${ev.location}</dd></div>` : ""}
        ${ev.notes ? html`<div><dt>${t("cal.f.notes")}</dt><dd>${ev.notes}</dd></div>` : ""}
        ${names ? html`<div><dt>${t("cal.outlook.calendarOf")}</dt><dd>${names}</dd></div>` : ""}
      </dl>
      <p class="help">${ev.busy ? t("cal.outlook.busyHelp") : t("cal.outlook.readonly")}</p>
      ${link ? html`<p><a href="${link}" target="_blank" rel="noopener noreferrer">${t("cal.outlook.open")}</a></p>` : ""}`,
    confirmLabel: t("common.close"), cancelLabel: null,
  });
}

async function newEvent(day, onDone) {
  await editEvent({ day, onDone });
}

// ------------------------------------------------------------ Formular

const sel = (root, key) => root.querySelector(`[data-w="${key}"]`);

function whenWidget(init) {
  let root;
  const dayDiff = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY);
  let dur = init.allDay ? 3600000 : init.durMs; // Dauer in ms (Termin mit Uhrzeit)
  let durDays = init.allDay ? dayDiff(init.sd, init.ed) : Math.max(0, dayDiff(init.sd, init.ed)); // Dauer in Tagen (ganztägig)
  return {
    mount(el) {
      root = el;
      el.innerHTML = html`<label class="check cal-allday"><input type="checkbox" data-w="allDay" ${init.allDay ? "checked" : ""}> <span>${t("cal.w.allDay")}</span></label>
        <div class="cal-when">
          <label class="cf"><span>${t("cal.w.start")}</span><div class="cal-dt"><input type="date" data-w="sd" value="${init.sd}"><input type="time" data-w="st" value="${init.st}"></div></label>
          <label class="cf"><span>${t("cal.w.end")}</span><div class="cal-dt"><input type="date" data-w="ed" value="${init.ed}"><input type="time" data-w="et" value="${init.et}"></div></label>
        </div>
        <div class="help">${t("cal.w.tzHint", { tz: tzName() })}</div>`.toString();
      const allDay = () => sel(el, "allDay").checked;
      const toggle = () => { sel(el, "st").hidden = allDay(); sel(el, "et").hidden = allDay(); };
      toggle();
      const startMs = () => {
        const d = sel(el, "sd").value, tm = sel(el, "st").value || "00:00";
        return d ? Date.parse(toIso(d, tm)) : NaN;
      };
      const fillEnd = () => {
        if (allDay()) { if (sel(el, "sd").value) sel(el, "ed").value = addDays(sel(el, "sd").value, durDays); return; }
        const s = startMs();
        if (Number.isNaN(s)) return;
        const e = new Date(s + dur);
        sel(el, "ed").value = dayKey(e);
        sel(el, "et").value = timeOf(e);
      };
      el.addEventListener("change", (ev) => {
        const k = ev.target.dataset?.w;
        if (k === "allDay") {
          toggle();
          if (allDay() && sel(el, "sd").value && sel(el, "ed").value) durDays = Math.max(0, dayDiff(sel(el, "sd").value, sel(el, "ed").value));
          fillEnd();
        } else if (k === "sd" || k === "st") {
          fillEnd(); // das Ende wandert mit (Dauer bleibt)
        } else if (k === "ed" || k === "et") {
          if (allDay()) { if (sel(el, "sd").value && sel(el, "ed").value) durDays = Math.max(0, dayDiff(sel(el, "sd").value, sel(el, "ed").value)); return; }
          const s = startMs();
          const en = sel(el, "ed").value ? Date.parse(toIso(sel(el, "ed").value, sel(el, "et").value || "00:00")) : NaN;
          if (!Number.isNaN(s) && !Number.isNaN(en) && en >= s) dur = en - s;
        }
      });
    },
    read() {
      const allDay = sel(root, "allDay").checked;
      const sd = sel(root, "sd").value, ed = sel(root, "ed").value || sd;
      const stime = sel(root, "st").value, etime = sel(root, "et").value || stime;
      if (!sd) return { value: null, error: t("cal.err.dateRequired") };
      if (allDay) {
        if (ed < sd) return { value: null, error: t("cal.err.endBefore") };
        return { value: { allDay, start: sd, end: ed }, error: "" };
      }
      if (!stime) return { value: null, error: t("cal.err.timeRequired") };
      const start = toIso(sd, stime);
      const end = toIso(ed, etime);
      if (Date.parse(end) < Date.parse(start)) return { value: null, error: t("cal.err.endBefore") };
      return { value: { allDay, start, end }, error: "" };
    },
  };
}

function peopleWidget(members, selected) {
  let root;
  return {
    mount(el) {
      root = el;
      el.innerHTML = members.length
        ? html`<div class="cal-people">${members.map((m) => html`<label class="check"><input type="checkbox" data-w="p" value="${m.id}" ${selected.includes(m.id) ? "checked" : ""}> <span>${m.displayName}</span></label>`)}</div><div class="help">${t("cal.participants.hint")}</div>`.toString()
        : html`<p class="help">${t("cal.participants.none")}</p>`.toString();
    },
    read: () => ({ value: [...root.querySelectorAll('[data-w="p"]:checked')].map((i) => i.value), error: "" }),
  };
}

function repeatWidget(init) {
  let root;
  return {
    mount(el) {
      root = el;
      const r = init;
      const mode = r?.until ? "until" : r?.count ? "count" : "never";
      el.innerHTML = html`<div class="cal-rep">
          <select data-w="freq" aria-label="${t("cal.f.repeat")}"><option value="">${t("cal.repeat.none")}</option>${FREQS.map((f) => html`<option value="${f}" ${r?.freq === f ? "selected" : ""}>${t(`cal.repeat.${f}`)}</option>`)}</select>
          <div class="cal-rep-more" data-w="more">
            <label class="cf"><span>${t("cal.repeat.every")}</span><span class="cal-every"><input type="number" min="1" max="52" step="1" inputmode="numeric" data-w="interval" value="${r?.interval ?? 1}"><span data-w="unit"></span></span></label>
            <label class="cf"><span>${t("cal.repeat.end")}</span><span class="cal-every"><select data-w="endmode">${["never", "until", "count"].map((m) => html`<option value="${m}" ${mode === m ? "selected" : ""}>${t(`cal.repeat.end.${m}`)}</option>`)}</select>
              <input type="date" data-w="until" value="${r?.until ?? ""}"><input type="number" min="1" max="1000" step="1" inputmode="numeric" data-w="count" value="${r?.count ?? ""}" placeholder="${t("cal.repeat.countPh")}"></span></label>
          </div>
        </div>`.toString();
      const sync = () => {
        const f = sel(el, "freq").value;
        sel(el, "more").hidden = !f;
        const n = Math.max(1, Number(sel(el, "interval").value) || 1);
        sel(el, "unit").textContent = f ? tn(`cal.unit.${f}`, n) : "";
        const m = sel(el, "endmode").value;
        sel(el, "until").hidden = m !== "until";
        sel(el, "count").hidden = m !== "count";
      };
      sync();
      el.addEventListener("change", sync);
      el.addEventListener("input", sync);
    },
    read() {
      const freq = sel(root, "freq").value;
      if (!freq) return { value: null, error: "" };
      const interval = Number(sel(root, "interval").value);
      if (!Number.isInteger(interval) || interval < 1 || interval > 52) return { value: null, error: t("cal.err.interval") };
      const mode = sel(root, "endmode").value;
      let until = null, count = null;
      if (mode === "until") {
        until = sel(root, "until").value;
        if (!until) return { value: null, error: t("cal.err.untilRequired") };
      } else if (mode === "count") {
        count = Number(sel(root, "count").value);
        if (!Number.isInteger(count) || count < 1 || count > 1000) return { value: null, error: t("cal.err.countRange") };
      }
      return { value: { freq, interval, until, count }, error: "" };
    },
  };
}

function remindersWidget(selected) {
  let root;
  return {
    mount(el) {
      root = el;
      el.innerHTML = html`<div class="cal-rem">${REMINDERS.map((m) => html`<label class="check"><input type="checkbox" data-w="r" value="${m}" ${selected.includes(m) ? "checked" : ""}> <span>${t(`cal.rem.${m}`)}</span></label>`)}</div><div class="help">${t("cal.reminders.hint")}</div>`.toString();
    },
    read: () => ({ value: [...root.querySelectorAll('[data-w="r"]:checked')].map((i) => Number(i.value)), error: "" }),
  };
}

/** Termin anlegen (day) oder ändern (ev). onDone: nach Speichern/Löschen (Neuladen der Liste) */
async function editEvent({ ev = null, day = todayISO(), onDone }) {
  const members = await ensureMembers();
  let init;
  if (ev) {
    if (ev.allDay) {
      init = { allDay: true, sd: ev.start, ed: ev.end, st: "09:00", et: "10:00", durMs: 3600000 };
    } else {
      const s = new Date(ev.start), e = new Date(ev.end);
      init = { allDay: false, sd: dayKey(s), st: timeOf(s), ed: dayKey(e), et: timeOf(e), durMs: e - s };
    }
  } else {
    const now = new Date();
    const same = day === todayISO();
    const startH = same ? Math.min(23, now.getHours() + 1) : 9;
    init = { allDay: false, sd: day, st: `${pad(startH)}:00`, ed: day, et: `${pad(Math.min(23, startH + 1))}:${startH >= 23 ? "59" : "00"}`, durMs: 3600000 };
  }
  const widgets = {
    when: whenWidget(init),
    people: peopleWidget(members, ev?.participants || []),
    repeat: repeatWidget(ev?.repeat || null),
    reminders: remindersWidget(ev ? ev.reminders || [] : [10]),
  };
  const fields = [
    { key: "title", label: t("cal.f.title"), type: "text", required: true, full: true },
    { key: "when", label: t("cal.f.when"), type: "widget", widget: widgets.when, required: true },
    { key: "location", label: t("cal.f.location"), type: "text", full: true },
    { key: "notes", label: t("cal.f.notes"), type: "textarea", rows: 3, full: true },
    { key: "people", label: t("cal.f.participants"), type: "widget", widget: widgets.people },
    { key: "repeat", label: t("cal.f.repeat"), type: "widget", widget: widgets.repeat },
    { key: "reminders", label: t("cal.f.reminders"), type: "widget", widget: widgets.reminders },
  ];
  const del = ev ? [{
    label: t("common.delete"), danger: true,
    async onClick({ close }) {
      const ok = await confirmDialog({
        title: t("cal.delete.title"), message: ev.repeat ? t("cal.delete.msgSeries", { title: ev.title }) : t("cal.delete.msg", { title: ev.title }), confirmLabel: t("common.delete"), danger: true,
      });
      if (!ok) return;
      try {
        await api.calDelete(ev.id);
        toast(t("cal.deleted"), { type: "ok" });
        close(true);
      } catch (err) {
        if (err.status === 404) { close(true); return; }
        if (!store.handleAuthError(err)) toast(err.message, { type: "error" });
      }
    },
  }] : [];

  const saved = await openForm({
    title: ev ? t("cal.editTitle") : t("cal.newTitle"),
    subtitle: ev?.repeat ? t("cal.series") : "",
    wide: false,
    fields,
    values: { title: ev?.title || "", location: ev?.location || "", notes: ev?.notes || "" },
    submitLabel: t("common.save"),
    extra: del,
    async onSubmit(v) {
      const body = {
        title: v.title, allDay: v.when.allDay, start: v.when.start, end: v.when.end, tz: tzName(),
        location: v.location, notes: v.notes, participants: v.people, reminders: v.reminders, repeat: v.repeat,
      };
      const r = ev ? await api.calUpdate(ev.id, { ...body, rev: ev.rev }) : await api.calCreate(body);
      toast(ev ? t("cal.saved") : t("cal.created"), { type: "ok" });
      if (r?.outlook === "error") toast(t("cal.outlook.pushFailed"), { type: "error", ms: 9000 });
    },
  });
  if (saved) onDone?.();
}
