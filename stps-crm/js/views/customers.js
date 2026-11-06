// Kunden: Liste + Detailansicht
import { all, byId } from "../store.js";
import { html, fmtPct, fmtDate, fmtDateTime } from "../util.js";
import { icon, crumbs } from "../ui.js";
import { listView } from "../table.js";
import { L, badge, prio, primaryContact, weightedCustomer, contactsOf, normChance, amt, curLines, sumByCur, deliveryAddresses, billingAddress, addressLines, countryLabel } from "../model.js";
import { KUNDENPHASEN } from "../config.js";
import { t, tv } from "../i18n.js";
import { dateCell, ownerCell, contactCell, textCell, dash, contactsCard, addressesCard, dl } from "./common.js";
import { dealsSection, articlesSection, rfqsSection, activitiesSection, tasksSection, bindDetailActions } from "./sections.js";
import * as F from "../forms.js";
import * as presence from "../presence.js";
import { catOptions, kategorienOf, catShort } from "../categories.js";
import { openMatch } from "./match.js";
import { historyCard, bindHistory } from "./team.js";

const catChips = (r) => { const ids = kategorienOf(r); return ids.length ? html`<span class="cat-chips">${ids.map((id) => html`<span class="badge t-navy">${catShort(id)}</span>`)}</span>` : dash; };


const listCfg = () => ({
  id: "customers",
  title: t("customers.title"),
  intro: t("customers.intro"),
  noun: "customers",
  rows: () => all("customers"),
  search: (r) => [r.nr, r.firma, r.produkt, r.kommentar, r.naechsterSchritt, r.owner, r.quelle, r.strasse, r.plz, r.ort, r.land, countryLabel(r.land), ...deliveryAddresses(r).flatMap((a) => [a.bezeichnung, a.strasse, a.plz, a.ort, a.land]), ...contactsOf(r).flatMap((c) => [c.name, c.email, c.telefon, c.mobile, c.funktion])].join(" ") + " " + kategorienOf(r).map(catShort).join(" "),
  defaultSort: { key: "nr", dir: "desc" },
  newButton: { label: t("ent.customers.singular"), onClick: () => F.editRecord("customers") },
  rowHref: (r) => `#/kunden/${r.id}`,
  empty: t("customers.empty"),
  filters: [
    { key: "phase", label: t("col.phase"), options: L.kundenphasen, test: (r, v) => r.phase === v },
    { key: "status", label: t("f.customers.status"), options: L.kundenstatus, test: (r, v) => r.status === v },
    { key: "owner", label: t("col.owner"), options: L.owners, test: (r, v) => r.owner === v },
    { key: "prio", label: t("f.customers.prioritaet"), options: L.prioritaeten, test: (r, v) => r.prioritaet === v },
    { key: "kategorie", label: t("f.customers.kategorien"), options: catOptions, test: (r, v) => kategorienOf(r).includes(v) },
  ],
  columns: [
    { key: "nr", label: t("ent.customers.nr"), sort: (r) => r.nr, cell: (r) => html`<span class="nr">${r.nr}</span>`, cls: "w-nr" },
    { key: "firma", label: t("f.customers.firma"), sort: (r) => r.firma, cell: (r) => html`<a href="#/kunden/${r.id}" class="rowlink">${r.firma}</a>`, cls: "c-title" },
    { key: "contact", label: t("contact.primary"), sort: (r) => primaryContact(r)?.name, cell: contactCell },
    { key: "prio", label: t("col.prio"), sort: (r) => r.prioritaet, cell: (r) => prio(r.prioritaet) || dash, cls: "w-sm" },
    { key: "phase", label: t("col.phase"), sort: (r) => KUNDENPHASEN.indexOf(r.phase), cell: (r) => badge(r.phase) },
    { key: "produkt", label: t("f.customers.produkt"), sort: (r) => r.produkt, cell: (r) => textCell(r.produkt) },
    { key: "kategorien", label: t("f.customers.kategorien"), cls: "hide-lg", sort: (r) => kategorienOf(r).map(catShort).join(" "), cell: catChips },
    { key: "potenzial", label: t("col.potential"), align: "right", sort: (r) => r.potenzial, cell: (r) => amt(r, r.potenzial) || dash, total: (rows) => curLines(sumByCur(rows, (r) => r.potenzial), { empty: "" }) },
    { key: "angebot", label: t("col.offer"), align: "right", cls: "hide-lg", sort: (r) => r.angebot, cell: (r) => amt(r, r.angebot) || dash, total: (rows) => curLines(sumByCur(rows, (r) => r.angebot), { empty: "" }) },
    { key: "chance", label: t("col.chance"), align: "right", cls: "hide-lg", sort: (r) => r.chance, cell: (r) => fmtPct(normChance(r.chance, r.phase)) || dash },
    { key: "gewichtet", label: t("col.weighted"), align: "right", sort: (r) => weightedCustomer(r), cell: (r) => amt(r, weightedCustomer(r)) || dash, total: (rows) => curLines(sumByCur(rows, weightedCustomer), { empty: "" }) },
    { key: "next", label: t("f.customers.naechsterSchritt"), sort: (r) => r.naechsterSchritt, cell: (r) => textCell(r.naechsterSchritt) },
    { key: "termin", label: t("f.customers.termin"), sort: (r) => r.termin, cell: (r) => dateCell(r.termin, { done: r.phase === "Abschluss Ja" || r.phase === "Abschluss Nein" }) },
    { key: "followUp", label: t("col.followUp"), sort: (r) => r.followUp, cell: (r) => dateCell(r.followUp, { done: r.phase === "Abschluss Ja" || r.phase === "Abschluss Nein" }) },
    { key: "owner", label: t("col.owner"), sort: (r) => r.owner, cell: (r) => ownerCell(r.owner) },
    { key: "status", label: t("col.status"), cls: "hide-lg", sort: (r) => r.status, cell: (r) => badge(r.status) || dash },
  ],
});

function detail(root, id) {
  const c = byId("customers", id);
  if (!c) {
    root.innerHTML = html`<div class="page-head"><h1>${t("customers.notFound")}</h1></div><p><a href="#/kunden" class="btn">${icon("back")} ${t("customers.backTo")}</a></p>`.toString();
    return;
  }
  const done = c.phase === "Abschluss Ja" || c.phase === "Abschluss Nein";
  const w = weightedCustomer(c);
  root.innerHTML = html`
    ${crumbs([{ label: t("nav.kunden"), href: "#/kunden" }, { label: c.firma }])}
    ${presence.hereBanner(c.id)}
    <div class="page-head detail-head">
      <div>
        <h1>${c.firma} <span class="nr-pill">${c.nr}</span></h1>
        <div class="chips">${badge(c.phase)}${c.status ? badge(c.status) : ""}${c.prioritaet ? html`<span class="muted">${t("f.customers.prioritaet")}</span> ${prio(c.prioritaet)}` : ""}${c.owner ? html`<span class="muted">·</span> ${ownerCell(c.owner)}` : ""}</div>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" data-act="match">${icon("search")} ${t("match.btn")}</button>
        <button type="button" class="btn btn-primary" data-act="add-activity">${icon("plus")} ${t("ent.activities.singular")}</button>
        <button type="button" class="btn btn-primary" data-act="add-task">${icon("plus")} ${t("ent.tasks.singular")}</button>
        <button type="button" class="btn" data-act="edit">${icon("edit")} ${t("common.edit")}</button>
        <button type="button" class="btn btn-danger-ghost" data-act="delete">${icon("trash")} ${t("common.delete")}</button>
      </div>
    </div>
    <div class="detail-grid">
      <div class="col-main">
        ${contactsCard(c, "customers")}
        ${addressesCard(c)}
        ${dealsSection(c.id)}
        ${articlesSection("customer", c.id)}
        ${rfqsSection("customer", c.id)}
        ${activitiesSection("customer", c.id)}
      </div>
      <div class="col-side">
        <section class="card">
          <div class="card-head"><h2>${t("det.pipeline")}</h2></div>
          ${dl([
            [t("col.potential"), amt(c, c.potenzial)],
            [t("col.offer"), amt(c, c.angebot)],
            [t("col.chance"), fmtPct(normChance(c.chance, c.phase))],
            [t("det.weightedPipeline"), amt(c, w)],
            [t("f.customers.produkt"), c.produkt],
            [t("f.customers.kategorien"), kategorienOf(c).length ? catChips(c) : ""],
            [t("f.customers.naechsterSchritt"), c.naechsterSchritt],
            [t("f.customers.termin"), c.termin ? dateCell(c.termin, { done, rel: true }) : ""],
            [t("f.customers.followUp"), c.followUp ? dateCell(c.followUp, { done, rel: true }) : ""],
          ])}
        </section>
        <section class="card">
          <div class="card-head"><h2>${t("det.masterData")}</h2></div>
          ${dl([
            [t("ent.customers.nr"), c.nr],
            [t("addr.billing"), addressLines(billingAddress(c)).length ? html`<div>${addressLines(billingAddress(c)).map((l, i) => html`${i ? html`<br>` : ""}${l}`)}</div>` : ""],
            [t("f.customers.status"), tv("custStatus", c.status)],
            [t("f.customers.quelle"), tv("source", c.quelle)],
            [t("f.customers.erstkontakt"), fmtDate(c.erstkontakt)],
            [t("f.customers.letzterKontakt"), fmtDate(c.letzterKontakt)],
            [t("f.customers.kommentar"), c.kommentar ? html`<div class="pre">${c.kommentar}</div>` : ""],
          ])}
          <p class="meta">${t("det.created", { at: fmtDateTime(c.createdAt) })}${c.createdBy ? " " + t("det.by", { name: c.createdBy }) : ""}${c.updatedAt && c.updatedAt !== c.createdAt ? html`<br>${t("det.changed", { at: fmtDateTime(c.updatedAt) })}${c.updatedBy ? " " + t("det.by", { name: c.updatedBy }) : ""}` : ""}</p>
        </section>
        ${tasksSection("customer", c.id)}
        ${historyCard()}
      </div>
    </div>`.toString();
  bindDetailActions(root, { coll: "customers", id });
  root.addEventListener("click", (e) => { if (e.target.closest('[data-act="match"]')) openMatch(id); });
  bindHistory(root, id);
}

export function render(root, route) {
  if (route.id) detail(root, route.id);
  else listView(listCfg()).render(root, route);
}
