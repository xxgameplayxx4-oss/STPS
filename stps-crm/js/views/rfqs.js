// Lieferantenzuordnung (RFQs: Kunde <-> Lieferant)
import { all, byId } from "../store.js";
import { html, money, fmtDate, mailLink, telLink } from "../util.js";
import { listView } from "../table.js";
import { badge, nameOf, rfqContact, customerLabel, supplierLabel, isClosedPhase } from "../model.js";
import { LIEFERANTENPHASEN } from "../config.js";
import { textCell, dash, customerLink, supplierLink } from "./common.js";
import * as F from "../forms.js";
import { t } from "../i18n.js";
import { L } from "../model.js";
import { shipCell } from "./logistics.js";
import { shipStatus } from "../logistics.js";

const listCfg = () => ({
  id: "rfqs",
  title: t("rfqs.title"),
  intro: t("rfqs.intro"),
  noun: "rfqs",
  rows: () => all("rfqs"),
  search: (r) => {
    const c = byId("customers", r.customerId), s = byId("suppliers", r.supplierId), k = rfqContact(r);
    return [c?.nr, c?.firma, s?.nr, s?.firma, k?.name, k?.email, r.produkt, r.leadTime, r.moq, r.naechsterSchritt, r.kommentar, r.spediteur, r.trackingNr, r.versandStatus].join(" ");
  },
  defaultSort: { key: "kunde", dir: "asc" },
  newButton: { label: t("ent.rfqs.singular"), onClick: () => F.editRecord("rfqs") },
  onRow: (id) => F.editRecord("rfqs", id),
  empty: t("rfqs.empty"),
  filters: [
    { key: "phase", label: t("f.rfqs.phase"), options: () => [{ value: "__open", label: t("rfqs.openAssignments") }, ...L.lieferantenphasen()], test: (r, v) => (v === "__open" ? !isClosedPhase(r.phase) : r.phase === v) },
    { key: "versandStatus", label: t("f.rfqs.versandStatus"), options: L.versandstatus, test: (r, v) => shipStatus(r) === v },
    { key: "kunde", label: t("ent.customers.singular"), options: () => [...all("customers")].sort((a, b) => a.nr - b.nr).map((c) => ({ value: c.id, label: customerLabel(c) })), test: (r, v) => r.customerId === v },
    { key: "lieferant", label: t("ent.suppliers.singular"), options: () => [...all("suppliers")].sort((a, b) => a.nr - b.nr).map((s) => ({ value: s.id, label: supplierLabel(s) })), test: (r, v) => r.supplierId === v },
  ],
  columns: [
    { key: "kunde", label: t("ent.customers.singular"), sort: (r) => nameOf("customers", r.customerId), cell: (r) => customerLink(r.customerId), cls: "c-title" },
    { key: "lieferant", label: t("ent.suppliers.singular"), sort: (r) => nameOf("suppliers", r.supplierId), cell: (r) => supplierLink(r.supplierId) },
    { key: "kontakt", label: t("rfqs.supplierContact"), sort: (r) => rfqContact(r)?.name, cell: (r) => { const c = rfqContact(r); return c ? html`<div class="ccell"><span class="cname">${c.name}</span>${c.email ? html`<small>${mailLink(c.email)}</small>` : ""}${c.telefon || c.mobile ? html`<small>${telLink(c.telefon || c.mobile)}</small>` : ""}</div>` : dash; } },
    { key: "produkt", label: t("f.rfqs.produkt"), sort: (r) => r.produkt, cell: (r) => textCell(r.produkt) },
    { key: "phase", label: t("f.rfqs.phase"), sort: (r) => LIEFERANTENPHASEN.indexOf(r.phase), cell: (r) => badge(r.phase) },
    { key: "lieferung", label: t("log.delivery"), sort: (r) => r.lieferungErwartet || (shipStatus(r) ? "9999" : ""), cell: (r) => shipCell(r) },
    { key: "gesendet", label: t("f.rfqs.gesendetAm"), cls: "hide-lg", sort: (r) => r.gesendetAm, cell: (r) => fmtDate(r.gesendetAm) || dash },
    { key: "erhalten", label: t("f.rfqs.erhaltenAm"), cls: "hide-lg", sort: (r) => r.erhaltenAm, cell: (r) => fmtDate(r.erhaltenAm) || dash },
    { key: "angebot", label: t("f.rfqs.angebot"), align: "right", sort: (r) => r.angebot, cell: (r) => money(r.angebot, r.waehrung) || dash },
    { key: "moq", label: t("f.rfqs.moq"), sort: (r) => r.moq, cell: (r) => r.moq || dash },
    { key: "leadTime", label: t("f.rfqs.leadTime"), sort: (r) => r.leadTime, cell: (r) => r.leadTime || dash },
    { key: "versand", label: t("f.rfqs.versandAm"), cls: "hide-lg", sort: (r) => r.versandAm, cell: (r) => fmtDate(r.versandAm) || dash },
    { key: "next", label: t("f.rfqs.naechsterSchritt"), sort: (r) => r.naechsterSchritt, cell: (r) => textCell(r.naechsterSchritt) },
    { key: "kommentar", label: t("f.rfqs.kommentar"), cls: "hide-lg", sort: (r) => r.kommentar, cell: (r) => textCell(r.kommentar) },
  ],
});

export function render(root, route) {
  listView(listCfg()).render(root, route);
}
