// Artikel (Artikelstamm): Liste mit Filter nach Warengruppe/Kunde/Lieferant + Detailansicht. Der Einkaufspreis ist intern und erscheint nie auf Kundendokumenten.
import { all, byId } from "../store.js";
import { html, fmtDateTime, fmtPct, price } from "../util.js";
import { icon, crumbs } from "../ui.js";
import { listView } from "../table.js";
import { L, badge, warengruppeOf, warengruppeLabel } from "../model.js";
import { fmtArtNr, margin } from "../billing.js";
import { t } from "../i18n.js";
import { dash, dl, customerLink, supplierLink } from "./common.js";
import * as F from "../forms.js";
import * as presence from "../presence.js";
import { historyCard, bindHistory } from "./team.js";
import { subOf, subOptions } from "../categories.js";

const nameOf = (coll, id) => byId(coll, id)?.firma || "";
const subName = (a) => (a.unterkategorieId ? subOf(a.unterkategorieId)?.name || "" : "");
const groupCell = (a) => { const g = warengruppeOf(a.warengruppeId); return g ? html`<span class="badge t-navy" title="${g.name}">${g.code}</span> <span class="muted">${g.name}${subName(a) ? " › " + subName(a) : ""}</span>` : dash; };

const listCfg = () => ({
  id: "articles",
  title: t("art.title"),
  intro: t("art.intro"),
  noun: "articles",
  rows: () => all("articles"),
  search: (r) => [r.nr, fmtArtNr(r.nr), r.bezeichnung, r.beschreibung, r.lieferantenArtNr, r.notiz, warengruppeLabel(warengruppeOf(r.warengruppeId)), subName(r), nameOf("customers", r.customerId), nameOf("suppliers", r.supplierId)].join(" "),
  defaultSort: { key: "nr", dir: "asc" },
  newButton: { label: t("ent.articles.singular"), onClick: () => F.editRecord("articles") },
  rowHref: (r) => `#/artikel/${r.id}`,
  empty: t("art.empty"),
  filters: [
    { key: "wg", label: t("f.articles.warengruppeId"), options: L.warengruppen, test: (r, v) => r.warengruppeId === v },
    { key: "uk", label: t("f.articles.unterkategorieId"), options: () => L.warengruppen().flatMap((o) => subOptions(o.value).map((s) => ({ value: s.value, label: `${o.label.split(" (")[0]} › ${s.label}` }))), test: (r, v) => r.unterkategorieId === v },
    { key: "kunde", label: t("ent.customers.singular"), options: () => [...all("customers")].sort((a, b) => a.nr - b.nr).map((c) => ({ value: c.id, label: `${c.nr} · ${c.firma}` })), test: (r, v) => r.customerId === v },
    { key: "lieferant", label: t("ent.suppliers.singular"), options: () => [...all("suppliers")].sort((a, b) => a.nr - b.nr).map((s) => ({ value: s.id, label: `${s.nr} · ${s.firma}` })), test: (r, v) => r.supplierId === v },
  ],
  columns: [
    { key: "nr", label: t("ent.articles.nr"), sort: (r) => r.nr, cell: (r) => html`<span class="nr">${fmtArtNr(r.nr)}</span>`, cls: "w-nr" },
    { key: "bezeichnung", label: t("f.articles.bezeichnung"), sort: (r) => r.bezeichnung, cell: (r) => html`<a href="#/artikel/${r.id}" class="rowlink">${r.bezeichnung}</a>`, cls: "c-title" },
    { key: "wg", label: t("f.articles.warengruppeId"), sort: (r) => warengruppeLabel(warengruppeOf(r.warengruppeId)) + subName(r), cell: groupCell },
    { key: "kunde", label: t("ent.customers.singular"), sort: (r) => nameOf("customers", r.customerId), cell: (r) => (r.customerId ? customerLink(r.customerId) : dash) },
    { key: "lieferant", label: t("ent.suppliers.singular"), sort: (r) => nameOf("suppliers", r.supplierId), cell: (r) => (r.supplierId ? supplierLink(r.supplierId) : dash) },
    { key: "einheit", label: t("f.articles.einheit"), cls: "hide-lg", sort: (r) => r.einheit, cell: (r) => r.einheit || dash },
    { key: "ek", label: t("art.ekShort"), align: "right", cls: "hide-lg", sort: (r) => r.ek, cell: (r) => price(r.ek, r.waehrung) || dash },
    { key: "brutto", label: t("f.articles.brutto"), align: "right", sort: (r) => r.brutto, cell: (r) => price(r.brutto, r.waehrung) || dash },
    { key: "rabatt", label: t("art.rabattShort"), align: "right", cls: "hide-lg", sort: (r) => r.rabatt, cell: (r) => fmtPct(r.rabatt) || dash },
    { key: "netto", label: t("f.articles.netto"), align: "right", sort: (r) => r.netto, cell: (r) => html`<strong>${price(r.netto, r.waehrung) || "–"}</strong>` },
    { key: "marge", label: t("art.margin"), align: "right", cls: "hide-lg", sort: (r) => margin(r).prozent, cell: (r) => (r.ek === null || r.ek === undefined || r.ek === "" ? dash : fmtPct(margin(r).prozent)) },
  ],
});

function detail(root, id) {
  const a = byId("articles", id);
  if (!a) {
    root.innerHTML = html`<div class="page-head"><h1>${t("art.notFound")}</h1></div><p><a href="#/artikel" class="btn">${icon("back")} ${t("art.backTo")}</a></p>`.toString();
    return;
  }
  const g = warengruppeOf(a.warengruppeId);
  const hasEk = a.ek !== null && a.ek !== undefined && a.ek !== "";
  const m = margin(a);
  root.innerHTML = html`
    ${crumbs([{ label: t("nav.artikel"), href: "#/artikel" }, { label: a.bezeichnung }])}
    ${presence.hereBanner(a.id)}
    <div class="page-head detail-head">
      <div>
        <h1>${a.bezeichnung} <span class="nr-pill">${fmtArtNr(a.nr)}</span></h1>
        <div class="chips">${g ? html`<span class="badge t-navy">${warengruppeLabel(g)}${subName(a) ? " › " + subName(a) : ""}</span>` : ""}${a.einheit ? html`<span class="muted">· ${a.einheit}</span>` : ""}</div>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" data-act="edit">${icon("edit")} ${t("common.edit")}</button>
        <button type="button" class="btn btn-danger-ghost" data-act="delete">${icon("trash")} ${t("common.delete")}</button>
      </div>
    </div>
    <div class="detail-grid">
      <div class="col-main">
        <section class="card">
          <div class="card-head"><h2>${t("art.prices")}</h2></div>
          ${dl([
            [t("f.articles.brutto"), price(a.brutto, a.waehrung)],
            [t("f.articles.rabatt"), fmtPct(a.rabatt)],
            [t("f.articles.netto"), a.netto === null || a.netto === undefined ? "" : html`<strong>${price(a.netto, a.waehrung)}</strong>`],
          ])}
          <div class="info-box internal">
            <div class="muted">${t("art.internalOnly")}</div>
            ${dl([
              [t("f.articles.ek"), hasEk ? price(a.ek, a.waehrung) : ""],
              [t("art.margin"), hasEk ? html`<span class="${m.betrag < 0 ? "neg" : ""}">${price(m.betrag, a.waehrung)} (${fmtPct(m.prozent)})</span>` : ""],
            ])}
          </div>
        </section>
        ${a.beschreibung ? html`<section class="card"><div class="card-head"><h2>${t("f.articles.beschreibung")}</h2></div><div class="pad pre">${a.beschreibung}</div></section>` : ""}
        ${a.notiz ? html`<section class="card"><div class="card-head"><h2>${t("f.articles.notiz")}</h2></div><div class="pad pre">${a.notiz}</div></section>` : ""}
      </div>
      <div class="col-side">
        <section class="card">
          <div class="card-head"><h2>${t("det.masterData")}</h2></div>
          ${dl([
            [t("ent.articles.nr"), fmtArtNr(a.nr)],
            [t("f.articles.warengruppeId"), warengruppeLabel(g)],
            [t("f.articles.unterkategorieId"), subName(a)],
            [t("ent.customers.singular"), a.customerId && byId("customers", a.customerId) ? customerLink(a.customerId) : ""],
            [t("ent.suppliers.singular"), a.supplierId && byId("suppliers", a.supplierId) ? supplierLink(a.supplierId) : ""],
            [t("f.articles.lieferantenArtNr"), a.lieferantenArtNr],
            [t("f.articles.einheit"), a.einheit],
            [t("f.articles.waehrung"), a.waehrung],
          ])}
          <p class="meta">${t("det.created", { at: fmtDateTime(a.createdAt) })}${a.createdBy ? " " + t("det.by", { name: a.createdBy }) : ""}${a.updatedAt && a.updatedAt !== a.createdAt ? html`<br>${t("det.changed", { at: fmtDateTime(a.updatedAt) })}${a.updatedBy ? " " + t("det.by", { name: a.updatedBy }) : ""}` : ""}</p>
        </section>
        ${historyCard()}
      </div>
    </div>`.toString();
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    if (el.dataset.act === "edit") F.editRecord("articles", id);
    else if (el.dataset.act === "delete") F.deleteRecord("articles", id, { navigate: true });
  });
  bindHistory(root, id);
}

export function render(root, route) {
  if (route.id) detail(root, route.id);
  else listView(listCfg()).render(root, route);
}
