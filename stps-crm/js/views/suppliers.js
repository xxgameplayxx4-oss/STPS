// Lieferanten (Lieferantenstamm): Liste + Detailansicht mit Notizen und Aktivitätshistorie
import { all, byId } from "../store.js";
import { html, fmtDate, fmtDateTime } from "../util.js";
import { icon, crumbs } from "../ui.js";
import { listView } from "../table.js";
import { L, badge, stars, primaryContact, contactsOf } from "../model.js";
import { t, tv } from "../i18n.js";
import { dateCell, ownerCell, contactCell, textCell, dash, contactsCard, dl } from "./common.js";
import { articlesSection, rfqsSection, activitiesSection, tasksSection, notesCard, bindDetailActions } from "./sections.js";
import * as F from "../forms.js";
import * as presence from "../presence.js";
import { catOptions, kategorienOf, catShort } from "../categories.js";
import { historyCard, bindHistory } from "./team.js";
import { certsCard, warnBadges } from "./certs.js";
import { certSummary } from "../certs.js";
import { todayISO } from "../util.js";

const catChips = (r) => { const ids = kategorienOf(r); return ids.length ? html`<span class="cat-chips">${ids.map((id) => html`<span class="badge t-navy">${catShort(id)}</span>`)}</span>` : dash; };
const vettedBadge = (s) => (s.geprueft ? html`<span class="badge t-green">${t("supp.vetted")}</span>` : "");

const inactive = (s) => s.status === "Gesperrt" || s.status === "Inaktiv";

const listCfg = () => ({
  id: "suppliers",
  title: t("suppliers.title"),
  intro: t("suppliers.intro"),
  noun: "suppliers",
  rows: () => all("suppliers"),
  search: (r) => [r.nr, r.firma, r.ort, r.produkte, r.qualitaet, ...(r.dokumente || []).map((d) => d.name), r.notiz, r.owner, r.zahlungskonditionen, ...kategorienOf(r).map(catShort), ...contactsOf(r).flatMap((c) => [c.name, c.email, c.telefon, c.mobile, c.funktion])].join(" "),
  defaultSort: { key: "nr", dir: "desc" },
  newButton: { label: t("ent.suppliers.singular"), onClick: () => F.editRecord("suppliers") },
  rowHref: (r) => `#/lieferanten/${r.id}`,
  empty: t("suppliers.empty"),
  filters: [
    { key: "status", label: t("col.status"), options: L.lieferantenstatus, test: (r, v) => r.status === v },
    { key: "owner", label: t("col.owner"), options: L.owners, test: (r, v) => r.owner === v },
    { key: "geprueft", label: t("f.suppliers.geprueft"), options: () => [{ value: "1", label: t("supp.vetted") }, { value: "0", label: t("supp.notVetted") }], test: (r, v) => Boolean(r.geprueft) === (v === "1") },
    { key: "kategorie", label: t("f.suppliers.kategorien"), options: catOptions, test: (r, v) => kategorienOf(r).includes(v) },
    { key: "bewertung", label: t("col.rating"), options: () => [1, 2, 3, 4, 5].map((n) => ({ value: n, label: t("suppliers.ratingFrom", { n }) })), test: (r, v) => (Number(r.bewertung) || 0) >= Number(v) },
  ],
  columns: [
    { key: "nr", label: t("ent.suppliers.nr"), sort: (r) => r.nr, cell: (r) => html`<span class="nr">${r.nr}</span>`, cls: "w-nr" },
    { key: "firma", label: t("f.suppliers.firma"), sort: (r) => r.firma, cell: (r) => html`<a href="#/lieferanten/${r.id}" class="rowlink">${r.firma}</a>`, cls: "c-title" },
    { key: "contact", label: t("contact.primary"), sort: (r) => primaryContact(r)?.name, cell: contactCell },
    { key: "ort", label: t("f.suppliers.ort"), cls: "hide-xl", sort: (r) => r.ort, cell: (r) => r.ort || dash },
    { key: "produkte", label: t("f.suppliers.produkte"), cls: "hide-xl", sort: (r) => r.produkte, cell: (r) => textCell(r.produkte) },
    { key: "kategorien", label: t("f.suppliers.kategorien"), cls: "hide-lg", sort: (r) => kategorienOf(r).map(catShort).join(" "), cell: catChips },
    { key: "qualitaet", label: t("f.suppliers.qualitaet"), cls: "hide-lg", sort: (r) => r.qualitaet, cell: (r) => textCell(r.qualitaet) },
    { key: "zertifikate", label: t("cert.col"), cls: "hide-lg", sort: (r) => { const c = certSummary(r, todayISO()); return c.expired * 1000 + c.soon; }, cell: (r) => warnBadges(r) || dash },
    { key: "status", label: t("col.status"), sort: (r) => r.status, cell: (r) => html`${vettedBadge(r)} ${badge(r.status) || ""}` },
    { key: "bewertung", label: t("col.rating"), cls: "hide-xl", sort: (r) => Number(r.bewertung) || null, cell: (r) => stars(r.bewertung) || dash },
    { key: "owner", label: t("col.owner"), sort: (r) => r.owner, cell: (r) => ownerCell(r.owner) },
    { key: "letzter", label: t("f.suppliers.letzterKontakt"), cls: "hide-lg", sort: (r) => r.letzterKontakt, cell: (r) => dateCell(r.letzterKontakt, { done: true }) },
    { key: "followUp", label: t("col.followUp"), sort: (r) => r.followUp, cell: (r) => dateCell(r.followUp, { done: inactive(r) }) },
    { key: "zahlung", label: t("f.suppliers.zahlungskonditionen"), cls: "hide-lg", sort: (r) => r.zahlungskonditionen, cell: (r) => r.zahlungskonditionen || dash },
    { key: "notiz", label: t("notes.title"), cls: "hide-lg", sort: (r) => r.notiz, cell: (r) => textCell(r.notiz) },
  ],
});

function detail(root, id) {
  const s = byId("suppliers", id);
  if (!s) {
    root.innerHTML = html`<div class="page-head"><h1>${t("suppliers.notFound")}</h1></div><p><a href="#/lieferanten" class="btn">${icon("back")} ${t("suppliers.backTo")}</a></p>`.toString();
    return;
  }
  root.innerHTML = html`
    ${crumbs([{ label: t("nav.lieferanten"), href: "#/lieferanten" }, { label: s.firma }])}
    ${presence.hereBanner(s.id)}
    <div class="page-head detail-head">
      <div>
        <h1>${s.firma} <span class="nr-pill">${s.nr}</span></h1>
        <div class="chips">${badge(s.status)}${vettedBadge(s)}${warnBadges(s)}${s.bewertung ? stars(s.bewertung) : ""}${s.ort ? html`<span class="muted">· ${s.ort}</span>` : ""}${s.owner ? html`<span class="muted">·</span> ${ownerCell(s.owner)}` : ""}</div>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-primary" data-act="add-activity">${icon("plus")} ${t("ent.activities.singular")}</button>
        <button type="button" class="btn" data-act="add-task">${icon("plus")} ${t("ent.tasks.singular")}</button>
        <button type="button" class="btn" data-act="edit">${icon("edit")} ${t("common.edit")}</button>
        <button type="button" class="btn btn-danger-ghost" data-act="delete">${icon("trash")} ${t("common.delete")}</button>
      </div>
    </div>
    <div class="detail-grid">
      <div class="col-main">
        ${contactsCard(s, "suppliers")}
        ${certsCard(s)}
        ${notesCard(s)}
        ${articlesSection("supplier", s.id)}
        ${rfqsSection("supplier", s.id)}
        ${activitiesSection("supplier", s.id)}
      </div>
      <div class="col-side">
        <section class="card">
          <div class="card-head"><h2>${t("det.masterData")}</h2></div>
          ${dl([
            [t("ent.suppliers.nr"), s.nr],
            [t("col.status"), badge(s.status)],
            [t("f.suppliers.geprueft"), s.geprueft ? html`<span class="badge t-green">${t("supp.vetted")}</span>` : t("supp.notVetted")],
            [t("f.suppliers.kategorien"), kategorienOf(s).length ? catChips(s) : ""],
            [t("f.suppliers.ort"), s.ort],
            [t("f.suppliers.produkte"), s.produkte ? html`<div class="pre">${s.produkte}</div>` : ""],
            [t("f.suppliers.qualitaet"), s.qualitaet ? html`<div class="pre">${s.qualitaet}</div>` : ""],
            [t("col.rating"), stars(s.bewertung)],
            [t("f.suppliers.zahlungskonditionen"), s.zahlungskonditionen],
            [t("f.suppliers.seit"), fmtDate(s.seit)],
            [t("f.suppliers.letzterKontakt"), fmtDate(s.letzterKontakt)],
            [t("f.suppliers.followUp"), s.followUp ? dateCell(s.followUp, { done: inactive(s), rel: true }) : ""],
          ])}
          <p class="meta">${t("det.created", { at: fmtDateTime(s.createdAt) })}${s.createdBy ? " " + t("det.by", { name: s.createdBy }) : ""}${s.updatedAt && s.updatedAt !== s.createdAt ? html`<br>${t("det.changed", { at: fmtDateTime(s.updatedAt) })}${s.updatedBy ? " " + t("det.by", { name: s.updatedBy }) : ""}` : ""}</p>
        </section>
        ${tasksSection("supplier", s.id)}
        ${historyCard()}
      </div>
    </div>`.toString();
  bindDetailActions(root, { coll: "suppliers", id });
  bindHistory(root, id);
}

export function render(root, route) {
  if (route.id) detail(root, route.id);
  else listView(listCfg()).render(root, route);
}
