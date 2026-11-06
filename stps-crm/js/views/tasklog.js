// Aufgaben & Aktivitäten: eine Liste über die Sammlungen «tasks» und «activities» (Reiter Offen / Erledigt / Verlauf)
import { all } from "../store.js";
import { html, fmtDate } from "../util.js";
import { icon } from "../ui.js";
import { listView } from "../table.js";
import { L, badge, prio, nameOf, contactsOf } from "../model.js";
import { byId } from "../store.js";
import { AUFGABENSTATUS } from "../config.js";
import { dateCell, ownerCell, textCell, dash, customerLink, supplierLink } from "./common.js";
import * as F from "../forms.js";
import { t, tv } from "../i18n.js";
import * as TL from "../tasklog.js";

const items = () => TL.unify({ tasks: all("tasks"), activities: all("activities") });
/** Kontaktperson einer Aktivität (Kunde oder Lieferant) */
const contactName = (r) => (r.rec.contactId ? [byId("customers", r.customerId), byId("suppliers", r.supplierId)].flatMap(contactsOf).find((c) => c.id === r.rec.contactId)?.name || "" : "");
const typLabel = (typ) => (typ === TL.TODO ? t("tl.todo") : tv("actType", typ));
const typBadge = (r) => html`<span class="badge ${r.kind === "todo" ? "t-navy" : "t-grey"}">${typLabel(r.typ)}</span>`;

const listCfg = () => ({
  id: "tasklog",
  title: t("nav.aufgaben-aktivitaeten"),
  intro: t("tl.intro"),
  noun: "tasklog",
  rows: items,
  search: (r) => [r.nr, typLabel(r.typ), r.title, r.detail, nameOf("customers", r.customerId), nameOf("suppliers", r.supplierId), contactName(r), r.rec.ort, r.owner, r.status].join(" "),
  defaultSort: TL.TAB_SORT[TL.DEFAULT_TAB],
  newButton: { label: t("ent.tasks.singular"), onClick: () => F.editRecord("tasks") },
  headExtra: html`<button type="button" class="btn" data-new-activity>${icon("plus")} ${t("ent.activities.singular")}</button>`,
  onRow: (key) => {
    const k = TL.parseKey(key);
    if (k) F.editRecord(k.coll, k.id);
  },
  empty: t("tl.empty"),
  rowClass: (r) => (r.done ? "is-done" : ""),
  tabs: {
    key: "tab",
    items: () => {
      const c = TL.tabCounts(items());
      return TL.TABS.map((value) => ({ value, label: t(`tl.tab.${value}`), count: c[value] }));
    },
    sort: TL.TAB_SORT,
    empty: { open: t("tl.emptyOpen"), done: t("tl.emptyDone") },
  },
  filters: [
    { key: "tab", tab: true, default: TL.DEFAULT_TAB, test: (r, v) => TL.inTab(r, v) },
    { key: "typ", label: t("f.activities.typ"), options: () => TL.typeOptions(L.aktivitaetstypen().map((o) => o.value), items()).map((value) => ({ value, label: typLabel(value) })), test: (r, v) => TL.matchesType(r, v) },
    { key: "owner", label: t("col.owner"), options: L.owners, test: (r, v) => r.owner === v },
    { key: "status", label: t("col.status"), options: () => L.aufgabenstatus(), test: (r, v) => r.status === v },
  ],
  columns: [
    { key: "done", label: "✓", cls: "w-sm", cell: (r) => html`<input type="checkbox" class="chk" data-act="toggle-item" data-id="${r.id}" ${r.done ? "checked" : ""} aria-label="${t("tl.doneAria", { name: r.title || typLabel(r.typ) })}">` },
    { key: "due", label: t("f.tasks.faellig"), sort: (r) => r.due, cell: (r) => dateCell(r.due, { done: r.done, rel: true }) },
    { key: "typ", label: t("f.activities.typ"), sort: (r) => typLabel(r.typ), cell: typBadge },
    { key: "title", label: t("tl.col.title"), sort: (r) => r.title, cell: (r) => (r.title ? html`<span class="t-title">${r.title}</span>` : dash), cls: "c-title" },
    { key: "kunde", label: t("ent.customers.singular"), sort: (r) => nameOf("customers", r.customerId), cell: (r) => customerLink(r.customerId) },
    { key: "kontakt", label: t("f.activities.contactId"), cls: "hide-lg", sort: (r) => contactName(r), cell: (r) => contactName(r) || dash },
    { key: "lieferant", label: t("ent.suppliers.singular"), sort: (r) => nameOf("suppliers", r.supplierId), cell: (r) => supplierLink(r.supplierId) },
    { key: "owner", label: t("col.owner"), sort: (r) => r.owner, cell: (r) => ownerCell(r.owner) },
    { key: "date", label: t("tl.col.date"), cls: "hide-lg", sort: (r) => r.date, cell: (r) => fmtDate(r.date) || dash },
    { key: "prio", label: t("col.prio"), cls: "hide-lg", sort: (r) => r.prio, cell: (r) => prio(r.prio) || dash },
    { key: "status", label: t("col.status"), sort: (r) => AUFGABENSTATUS.indexOf(r.status), cell: (r) => badge(r.status) || dash },
    { key: "detail", label: t("tl.col.detail"), cls: "hide-lg", sort: (r) => r.detail, cell: (r) => textCell(r.detail) },
    { key: "nr", label: t("tl.col.nr"), cls: "hide-lg", sort: (r) => r.nr, cell: (r) => html`<span class="nr">${r.nr}</span>` },
  ],
});

export function render(root, route) {
  listView(listCfg()).render(root, route);
  root.addEventListener("change", (e) => {
    if (e.target.dataset?.act === "toggle-item") {
      const k = TL.parseKey(e.target.dataset.id);
      if (k) F.toggleDone(k.coll, k.id);
    }
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-new-activity]")) F.editRecord("activities");
  });
}
