// Sendungen: Übersicht (Kennzahlen, Liste, Filter) und Seitenpanel mit Status-Zeitleiste. Logik in ../logistics.js.
// Eine Sendung ist eine Lieferantenzuordnung mit Versandangaben; Ereignisse werden von Hand erfasst (keine Carrier-Schnittstelle).
import { all, byId, update } from "../store.js";
import { html, fmtDate, todayISO, uid, money } from "../util.js";
import { t, tn, tv } from "../i18n.js";
import { icon, makeDialog, confirmDialog } from "../ui.js";
import { openSlideOver } from "../slideover.js";
import { listView } from "../table.js";
import { customerCountry, countryFilter, curLines, sumByCur, nameOf, customerLabel, L } from "../model.js";
import { dash, customerLink, supplierLink } from "./common.js";
import * as F from "../forms.js";
import { MILESTONES, hasShipment, shipStatus, shipDisplayStatus, isDelayed, delayDays, shipmentKpis, sortedEvents, stateFromEvents, trackingHref, trackingRef } from "../logistics.js";

export const ROUTE = "sendungen";
export const pageTitle = () => t("nav.sendungen");

const TONE = { Offen: "grey", Versendet: "blue", Unterwegs: "sky", Zugestellt: "green", "Verzögert": "red" };
const MODE_ICON = { Seefracht: "ship", Luftfracht: "send", Strasse: "truck", Bahn: "train" };
const rows = () => all("rfqs").filter(hasShipment);

const statusBadge = (r, today) => {
  const st = shipDisplayStatus(r, today);
  return st ? html`<span class="badge t-${TONE[st] || "grey"}">${tv("shipStatus", st)}</span>` : dash;
};
const modeLabel = (r) => (r.transport ? tv("transport", r.transport) : "");
const refOf = (r) => r.containerNr || r.blAwbNr || r.trackingNr || "";
const routeText = (r) => [r.originPort, r.destPort].filter(Boolean).join(" → ");
const trackA = (r) => {
  const href = trackingHref(r);
  return href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${icon("link")} ${t("log.track")}</a>` : "";
};

// ------------------------------------------------------------ Liste

const listCfg = () => {
  const today = todayISO();
  const cc = (r) => customerCountry(byId("customers", r.customerId));
  const act = (r) => ["Versendet", "Unterwegs", "Verzögert"].includes(shipStatus(r));
  return {
    id: "sendungen",
    title: t("nav.sendungen"),
    intro: t("shp.intro"),
    noun: "shipments",
    rows,
    search: (r) => {
      const c = byId("customers", r.customerId), s = byId("suppliers", r.supplierId);
      return [r.containerNr, r.blAwbNr, r.trackingNr, r.vessel, r.originPort, r.destPort, r.currentLocation, r.spediteur, r.produkt, c?.nr, c?.firma, s?.nr, s?.firma, tv("transport", r.transport)].join(" ");
    },
    defaultSort: { key: "eta", dir: "asc" },
    newButton: { label: t("shp.new"), onClick: () => F.editRecord("rfqs", null, { versandStatus: "Offen" }) },
    onRow: (id) => openDetail(id),
    rowClass: (r) => (isDelayed(r, today) ? "is-late" : ""),
    empty: t("shp.empty"),
    filters: [
      {
        key: "status", label: t("f.rfqs.versandStatus"),
        options: () => [
          { value: "__transit", label: t("shp.st.transit") },
          { value: "__arriving", label: t("shp.st.arriving") },
          { value: "__month", label: t("shp.st.month") },
          ...["Offen", "Versendet", "Unterwegs", "Verzögert", "Zugestellt"].map((v) => ({ value: v, label: tv("shipStatus", v) })),
        ],
        test: (r, v) => {
          if (v === "__transit") return act(r);
          if (v === "__arriving") return act(r) && shipmentKpis([r], today).arriving7 === 1;
          if (v === "__month") return shipmentKpis([r], today).deliveredMonth === 1;
          return shipDisplayStatus(r, today) === v;
        },
      },
      { key: "mode", label: t("f.rfqs.transport"), options: L.transport, test: (r, v) => r.transport === v },
      { key: "carrier", label: t("f.rfqs.spediteur"), options: () => [...new Set(rows().map((r) => r.spediteur).filter(Boolean))].sort().map((v) => ({ value: v, label: tv("carrier", v) })), test: (r, v) => r.spediteur === v },
      { key: "kunde", label: t("ent.customers.singular"), options: () => [...new Set(rows().map((r) => r.customerId))].map((id) => byId("customers", id)).filter(Boolean).sort((a, b) => a.nr - b.nr).map((c) => ({ value: c.id, label: customerLabel(c) })), test: (r, v) => r.customerId === v },
      countryFilter(rows, cc),
    ],
    columns: [
      { key: "ref", label: t("shp.col.ref"), sort: (r) => refOf(r), cls: "c-title", cell: (r) => html`<div class="ccell"><span class="cname shp-ref">${refOf(r) || dash}</span>${r.produkt ? html`<small>${r.produkt}</small>` : ""}</div>` },
      { key: "route", label: t("shp.col.route"), sort: (r) => routeText(r), cell: (r) => html`<div class="ccell"><span class="shp-route">${r.transport ? html`<span class="shp-mode" title="${modeLabel(r)}">${icon(MODE_ICON[r.transport] || "box")}<span class="sr">${modeLabel(r)}</span></span>` : ""}${routeText(r) || dash}</span>${r.vessel ? html`<small>${r.vessel}</small>` : ""}</div>` },
      { key: "status", label: t("col.status"), sort: (r) => ["Offen", "Versendet", "Unterwegs", "Verzögert", "Zugestellt"].indexOf(shipDisplayStatus(r, today)), cell: (r) => html`<div class="ccell">${statusBadge(r, today)}${r.currentLocation ? html`<small>${r.currentLocation}</small>` : ""}</div>` },
      {
        key: "eta", label: t("shp.col.eta"), sort: (r) => r.lieferungErwartet || "",
        cell: (r) => (r.lieferungErwartet ? html`<div class="ccell"><span class="${isDelayed(r, today) ? "date overdue" : ""}">${fmtDate(r.lieferungErwartet)}</span>${isDelayed(r, today) ? html`<small class="shp-late">${tn("shp.delayDays", delayDays(r, today))}</small>` : r.versandAm ? html`<small>${t("shp.etd")} ${fmtDate(r.versandAm)}</small>` : ""}</div>` : dash),
      },
      { key: "kunde", label: t("ent.customers.singular"), sort: (r) => nameOf("customers", r.customerId), cell: (r) => customerLink(r.customerId) },
      { key: "lieferant", label: t("ent.suppliers.singular"), sort: (r) => nameOf("suppliers", r.supplierId), cell: (r) => supplierLink(r.supplierId) },
      { key: "carrier", label: t("f.rfqs.spediteur"), sort: (r) => r.spediteur, cell: (r) => (r.spediteur || trackingHref(r) ? html`<div class="ccell"><span>${r.spediteur ? tv("carrier", r.spediteur) : ""}</span><small>${trackA(r)}</small></div>` : dash) },
      {
        key: "wert", label: t("shp.col.value"), align: "right", sort: (r) => r.angebot,
        cell: (r) => (r.angebot ? money(r.angebot, r.waehrung) : dash),
        total: (rs) => curLines(sumByCur(rs, (r) => r.angebot), { empty: "" }),
      },
    ],
  };
};

// ------------------------------------------------------------ Kennzahlen

function tiles() {
  const today = todayISO();
  const k = shipmentKpis(rows(), today);
  const tile = (label, n, status, def, cls = "") => html`<a class="shp-tile ${cls}" href="#/${ROUTE}?status=${status}" title="${def}"><span class="shp-tile-n">${n}</span><span class="shp-tile-l">${label}</span></a>`;
  return html`<div class="shp-tiles">
    ${tile(t("shp.kpi.transit"), k.inTransit, "__transit", t("shp.kpi.transit.def"))}
    ${tile(t("shp.kpi.arriving"), k.arriving7, "__arriving", t("shp.kpi.arriving.def"))}
    ${tile(t("shp.kpi.delayed"), k.delayed, "Verzögert", t("shp.kpi.delayed.def"), k.delayed ? "alert" : "")}
    ${tile(t("shp.kpi.delivered"), k.deliveredMonth, "__month", t("shp.kpi.delivered.def"))}
  </div>`;
}

export function render(root, route = {}) {
  root.classList.add("shp");
  listView(listCfg()).render(root, route);
  // Kennzahlen zwischen Seitenkopf und Werkzeugleiste
  const head = root.querySelector(".page-head");
  const tpl = document.createElement("template");
  tpl.innerHTML = tiles().toString();
  head?.after(tpl.content);
  if (route.id && route.navigated !== false) openDetail(route.id, true);
}

// ------------------------------------------------------------ Seitenpanel

let open = null; // { id, d, editing }

function openDetail(id, fromRoute = false) {
  if (!byId("rfqs", id)) return;
  if (open?.d?.isConnected) return;
  const d = makeDialog("drawer wide");
  const st = { id, d, editing: null, adding: false };
  open = st;
  d.setAttribute("aria-labelledby", "shp-title");
  paint(st);
  const close = () => d.close();
  d.addEventListener("close", () => {
    if (open === st) open = null;
    if (fromRoute && location.hash.startsWith(`#/${ROUTE}/`)) location.hash = `#/${ROUTE}`;
  });
  d.addEventListener("click", (e) => onClick(st, e, close));
  d.addEventListener("submit", (e) => { e.preventDefault(); saveEvent(st); });
  openSlideOver(d, { requestClose: close });
}

const dl = (label, value) => (value ? html`<div><dt>${label}</dt><dd>${value}</dd></div>` : "");

function timeline(r, st) {
  const ev = sortedEvents(r);
  const reached = new Set(ev.map((e) => e.status));
  const lastIdx = Math.max(-1, ...ev.map((e) => MILESTONES.indexOf(e.status)));
  const pending = MILESTONES.filter((m, i) => !reached.has(m) && i > lastIdx);
  return html`<ol class="shp-tl">
    ${ev.map((e) => html`<li class="done ${e.status === "Zugestellt" ? "final" : ""}">
      <span class="shp-dot" aria-hidden="true"></span>
      <div class="shp-ev"><div class="shp-ev-h"><strong>${tv("milestone", e.status) || e.status}</strong><span class="shp-ev-date">${fmtDate(e.date)}</span></div>
        ${e.location ? html`<div class="shp-ev-loc">${icon("map")} ${e.location}</div>` : ""}
        ${e.note ? html`<div class="shp-ev-note">${e.note}</div>` : ""}
        <div class="shp-ev-act"><button type="button" class="icon-btn" data-ev-edit="${e.id}" aria-label="${t("common.edit")}" title="${t("common.edit")}">${icon("edit")}</button><button type="button" class="icon-btn" data-ev-del="${e.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash")}</button></div></div></li>`)}
    ${pending.map((m, i) => html`<li class="todo ${i === 0 ? "next" : ""}"><span class="shp-dot" aria-hidden="true"></span><div class="shp-ev"><div class="shp-ev-h"><strong>${tv("milestone", m)}</strong>${i === 0 ? html`<span class="shp-ev-date">${t("shp.tl.next")}</span>` : ""}</div></div></li>`)}
  </ol>`;
}

function eventForm(r, st) {
  const e = st.editing ? (r.events || []).find((x) => x.id === st.editing) : null;
  const cur = stateFromEvents(r).milestone;
  const nextMs = MILESTONES[Math.min(MILESTONES.length - 1, MILESTONES.indexOf(cur) + 1)] || MILESTONES[0];
  const v = e || { date: todayISO(), location: "", status: nextMs, note: "" };
  return html`<form class="shp-evform" novalidate>
    <h3>${e ? t("shp.ev.edit") : t("shp.ev.add")}</h3>
    <div class="grid2">
      <div class="field"><label for="ev-date">${t("shp.ev.date")}</label><input type="date" id="ev-date" name="date" value="${v.date}" required></div>
      <div class="field"><label for="ev-status">${t("shp.ev.status")}</label><select id="ev-status" name="status">${L.meilensteine().map((o) => html`<option value="${o.value}" ${o.value === v.status ? "selected" : ""}>${o.label}</option>`)}</select></div>
      <div class="field full"><label for="ev-loc">${t("shp.ev.location")}</label><input type="text" id="ev-loc" name="location" value="${v.location}" autocomplete="off"></div>
      <div class="field full"><label for="ev-note">${t("shp.ev.note")}</label><input type="text" id="ev-note" name="note" value="${v.note}" autocomplete="off"></div>
    </div>
    <div class="form-error" role="alert" data-ev-err></div>
    <div class="shp-evform-act"><button type="button" class="btn" data-ev-cancel>${t("common.cancel")}</button><button type="submit" class="btn btn-primary">${t("common.save")}</button></div>
  </form>`;
}

function paint(st) {
  const r = byId("rfqs", st.id);
  if (!r) { st.d.close(); return; }
  const today = todayISO();
  const c = byId("customers", r.customerId), s = byId("suppliers", r.supplierId);
  const delayed = isDelayed(r, today);
  const prevScroll = st.d.querySelector(".dlg-body")?.scrollTop || 0;
  st.d.innerHTML = html`<div class="shp-panel">
    <header class="dlg-head"><div><h2 id="shp-title">${refOf(r) || r.produkt || t("shp.untitled")}</h2><div class="sub">${[modeLabel(r), r.produkt].filter(Boolean).join(" · ")}</div></div><button type="button" class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x")}</button></header>
    <div class="dlg-body">
      <div class="shp-sum">
        <div class="shp-sum-st">${statusBadge(r, today)}${delayed ? html` <span class="shp-late">${tn("shp.delayDays", delayDays(r, today))}</span>` : ""}</div>
        <dl class="shp-dl">
          ${dl(t("shp.d.route"), routeText(r))}
          ${dl(t("f.rfqs.vessel"), r.vessel)}
          ${dl(t("shp.etd"), fmtDate(r.versandAm))}
          ${dl(t("shp.eta"), r.lieferungErwartet ? html`<span class="${delayed ? "date overdue" : ""}">${fmtDate(r.lieferungErwartet)}</span>` : "")}
          ${dl(t("f.rfqs.currentLocation"), r.currentLocation)}
          ${dl(t("f.rfqs.containerNr"), r.containerNr)}
          ${dl(t("f.rfqs.blAwbNr"), r.blAwbNr)}
          ${dl(t("f.rfqs.spediteur"), r.spediteur ? tv("carrier", r.spediteur) : "")}
          ${dl(t("f.rfqs.trackingNr"), r.trackingNr)}
          ${dl(t("ent.customers.singular"), c ? html`<a href="#/kunden/${c.id}" data-close>${c.firma}</a>` : "")}
          ${dl(t("ent.suppliers.singular"), s ? html`<a href="#/lieferanten/${s.id}" data-close>${s.firma}</a>` : "")}
          ${dl(t("shp.d.rfq"), html`<a href="#/zuordnung?q=${encodeURIComponent(r.produkt || nameOf("customers", r.customerId))}" data-close>${t("shp.d.rfqLink")}</a>`)}
          ${dl(t("shp.col.value"), r.angebot ? money(r.angebot, r.waehrung) : "")}
        </dl>
        ${trackingHref(r) || trackingRef(r) ? html`<p class="shp-track">${trackA(r)}</p>` : ""}
      </div>
      <div class="shp-tl-head"><h3>${t("shp.tl.title")}</h3>${st.adding || st.editing ? "" : html`<button type="button" class="btn btn-sm" data-ev-new>${icon("plus")} ${t("shp.ev.add")}</button>`}</div>
      ${st.adding || st.editing ? eventForm(r, st) : ""}
      ${timeline(r, st)}
      <p class="muted shp-manual">${t("shp.manualNote")}</p>
    </div>
    <footer class="dlg-foot"><div class="foot-main"><button type="button" class="btn" data-edit-shipment>${icon("edit")} ${t("shp.editData")}</button><button type="button" class="btn btn-primary" data-close>${t("common.close")}</button></div></footer>
  </div>`.toString();
  const body = st.d.querySelector(".dlg-body");
  if (body) body.scrollTop = prevScroll;
  if (st.adding || st.editing) st.d.querySelector("#ev-loc")?.focus({ preventScroll: true });
}

function writeEvents(st, events) {
  const r = byId("rfqs", st.id);
  const next = { events };
  const cur = stateFromEvents({ events });
  if (cur.status) next.versandStatus = cur.status;
  if (cur.location) next.currentLocation = cur.location;
  const dep = events.find((e) => e.status === "Abgefahren" && e.date);
  if (dep && !r.versandAm) next.versandAm = dep.date;
  update("rfqs", st.id, next);
}

function saveEvent(st) {
  const form = st.d.querySelector(".shp-evform");
  if (!form) return;
  const f = Object.fromEntries(new FormData(form));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) { form.querySelector("[data-ev-err]").textContent = t("shp.ev.dateRequired"); return; }
  const r = byId("rfqs", st.id);
  const list = Array.isArray(r.events) ? r.events.map((e) => ({ ...e })) : [];
  const rec = { id: st.editing || uid(), date: f.date, location: String(f.location || "").trim(), status: f.status, note: String(f.note || "").trim() };
  const i = list.findIndex((e) => e.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  writeEvents(st, list);
  st.adding = false; st.editing = null;
  paint(st);
}

async function onClick(st, e, close) {
  const a = e.target.closest("a[data-close]");
  if (a) { close(); return; }
  if (e.target.closest("[data-close]")) { close(); return; }
  if (e.target.closest("[data-ev-new]")) { st.adding = true; st.editing = null; paint(st); return; }
  if (e.target.closest("[data-ev-cancel]")) { st.adding = false; st.editing = null; paint(st); return; }
  const ed = e.target.closest("[data-ev-edit]");
  if (ed) { st.editing = ed.dataset.evEdit; st.adding = false; paint(st); return; }
  const del = e.target.closest("[data-ev-del]");
  if (del) {
    if (!(await confirmDialog({ title: t("shp.ev.delTitle"), message: t("shp.ev.delMsg"), confirmLabel: t("common.delete"), danger: true }))) return;
    const r = byId("rfqs", st.id);
    writeEvents(st, (r.events || []).filter((x) => x.id !== del.dataset.evDel));
    paint(st);
    return;
  }
  if (e.target.closest("[data-edit-shipment]")) {
    const id = st.id;
    close();
    setTimeout(() => F.editRecord("rfqs", id), 80);
  }
}
