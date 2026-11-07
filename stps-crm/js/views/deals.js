// Angebote (Deals)
import { all } from "../store.js";
import { html, fmtPct, fmtDate } from "../util.js";
import { listView } from "../table.js";
import { L, badge, weightedDeal, nameOf, isClosedPhase, normChance, amt3, curLines, sumByCur } from "../model.js";
import { KUNDENPHASEN } from "../config.js";
import { dateCell, ownerCell, textCell, dash, customerLink } from "./common.js";
import * as F from "../forms.js";
import { byId } from "../store.js";
import { icon } from "../ui.js";
import { t } from "../i18n.js";
import { getDealView, viewToggle, bindToggle, renderBoard } from "./kanban.js";


const listCfg = () => ({
  id: "deals",
  title: t("deals.title"),
  intro: t("deals.intro"),
  noun: "deals",
  rows: () => all("deals"),
  search: (r) => [r.nr, nameOf("customers", r.customerId), byId("customers", r.customerId)?.nr, r.produkt, r.naechsterSchritt, r.kommentar, r.owner].join(" "),
  defaultSort: { key: "nr", dir: "desc" },
  newButton: { label: t("ent.deals.singular"), onClick: () => F.editRecord("deals") },
  onRow: (id) => F.editRecord("deals", id),
  empty: t("deals.empty"),
  filters: [
    { key: "phase", label: t("col.phase"), options: () => [{ value: "__open", label: t("deals.openOffers") }, ...L.kundenphasen()], test: (r, v) => (v === "__open" ? !isClosedPhase(r.phase) : r.phase === v) },
    { key: "owner", label: t("col.owner"), options: L.owners, test: (r, v) => r.owner === v },
  ],
  columns: [
    { key: "nr", label: t("ent.deals.nr"), sort: (r) => r.nr, cell: (r) => html`<span class="nr">${r.nr}</span>`, cls: "w-nr" },
    { key: "kunde", label: t("ent.customers.singular"), sort: (r) => nameOf("customers", r.customerId), cell: (r) => customerLink(r.customerId), cls: "c-title" },
    { key: "produkt", label: t("f.deals.produkt"), cls: "hide-xl", sort: (r) => r.produkt, cell: (r) => textCell(r.produkt) },
    { key: "erstellt", label: t("col.created"), cls: "hide-lg", sort: (r) => r.erstellt, cell: (r) => fmtDate(r.erstellt) || dash },
    { key: "gesendet", label: t("col.sent"), cls: "hide-lg", sort: (r) => r.gesendet, cell: (r) => fmtDate(r.gesendet) || dash },
    { key: "wert", label: t("col.value"), align: "right", sort: (r) => r.wert, cell: (r) => amt3(r, r.wert) || dash, total: (rows) => curLines(sumByCur(rows, (r) => r.wert), { empty: "" }) },
    { key: "phase", label: t("col.phase"), sort: (r) => KUNDENPHASEN.indexOf(r.phase), cell: (r) => badge(r.phase) },
    { key: "chance", label: t("col.chance"), align: "right", sort: (r) => r.chance, cell: (r) => fmtPct(normChance(r.chance, r.phase)) || dash },
    { key: "gewichtet", label: t("col.weighted"), align: "right", sort: (r) => weightedDeal(r), cell: (r) => amt3(r, weightedDeal(r)) || dash, total: (rows) => curLines(sumByCur(rows, weightedDeal), { empty: "" }) },
    { key: "abschluss", label: t("col.expectedClose"), cls: "hide-xl", sort: (r) => r.erwarteterAbschluss, cell: (r) => dateCell(r.erwarteterAbschluss, { done: isClosedPhase(r.phase) }) },
    { key: "next", label: t("f.deals.naechsterSchritt"), cls: "hide-xl", sort: (r) => r.naechsterSchritt, cell: (r) => textCell(r.naechsterSchritt) },
    { key: "owner", label: t("col.owner"), sort: (r) => r.owner, cell: (r) => ownerCell(r.owner) },
    { key: "kommentar", label: t("f.deals.kommentar"), cls: "hide-lg", sort: (r) => r.kommentar, cell: (r) => textCell(r.kommentar) },
    { key: "druck", label: "", cell: (r) => (r.positions?.length ? html`<a class="icon-btn" href="#/druck/offerte/${r.id}" aria-label="${t("print.offerAria", { nr: r.nr })}" title="${t("print.offerBtn")}">${icon("download")}</a><a class="icon-btn" href="#/druck/auftragsbestaetigung/${r.id}" aria-label="${t("print.abAria", { nr: r.nr })}" title="${t("print.abBtn")}">${icon("check")}</a><a class="icon-btn" href="#/druck/proforma/${r.id}" aria-label="${t("print.pfAria", { nr: r.nr })}" title="${t("print.pfBtn")}">${icon("receipt")}</a><a class="icon-btn" href="#/druck/lieferschein/${r.id}" aria-label="${t("print.lsAria", { nr: r.nr })}" title="${t("print.lsBtn")}">${icon("box")}</a>` : "") },
  ],
});

export function render(root, route) {
  const mount = (rt) => {
    const inner = document.createElement("div");
    inner.className = "view-inner"; // frischer Behälter: Ereignisse der vorigen Ansicht fallen mit ihm weg
    root.replaceChildren(inner);
    const mode = getDealView();
    const cfg = { ...listCfg(), headExtra: viewToggle(mode) };
    if (mode === "board") renderBoard(inner, rt, cfg);
    else listView(cfg).render(inner, rt);
    bindToggle(inner, () => mount({ ...rt, navigated: false }));
  };
  mount(route);
}
