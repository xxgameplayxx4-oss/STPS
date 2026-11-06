// «Passende Lieferanten»: zu den Produktkategorien eines Kunden (bzw. Angebots) die Lieferanten, die diese Kategorien ganz oder teilweise abdecken.
// Geprüfte Lieferanten stehen zuerst. Aus einem Treffer lässt sich direkt eine Lieferantenzuordnung (RFQ) anlegen.
import { byId } from "../store.js";
import { html } from "../util.js";
import { confirmDialog, icon } from "../ui.js";
import { t } from "../i18n.js";
import { badge, stars } from "../model.js";
import { kategorienOf, matchSuppliers, catShort } from "../categories.js";
import { dash } from "./common.js";
import * as F from "../forms.js";

const chip = (id, cls = "t-navy") => html`<span class="badge ${cls}">${catShort(id)}</span>`;

function body(customerId, only) {
  const c = byId("customers", customerId);
  const wanted = kategorienOf(c);
  if (!wanted.length) {
    return html`<p>${t("match.noCats")}</p><p><button type="button" class="btn" data-match="edit-customer">${icon("edit")} ${t("match.editCustomer")}</button></p>`;
  }
  const res = matchSuppliers(wanted);
  const rows = only ? res.rows.filter((r) => r.vetted) : res.rows;
  return html`<div class="match-wanted"><strong>${t("match.wanted")}</strong> ${wanted.map((id) => chip(id))}</div>
    <label class="check match-only"><input type="checkbox" data-match="only" ${only ? "checked" : ""}> <span>${t("match.onlyVetted")}</span></label>
    ${rows.length
      ? html`<p class="muted match-count">${t("match.count", { n: rows.length, total: res.rows.length })}${res.hidden ? " " + t("match.hidden", { n: res.hidden }) : ""}</p>
        <div class="table-wrap"><table class="tbl mini match-tbl"><thead><tr><th>${t("ent.suppliers.singular")}</th><th>${t("col.status")}</th><th>${t("match.covered")}</th><th class="hide-lg">${t("match.missing")}</th><th class="hide-lg">${t("col.rating")}</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td data-label="${t("ent.suppliers.singular")}" class="c-first"><a href="#/lieferanten/${r.supplier.id}" class="rowlink" data-match="close">${r.supplier.firma}</a> <span class="muted">${r.supplier.nr}</span></td>
          <td data-label="${t("col.status")}">${r.vetted ? html`<span class="badge t-green">${t("supp.vetted")}</span> ` : ""}${badge(r.supplier.status) || dash}</td>
          <td data-label="${t("match.covered")}"><strong>${r.covered.length}/${r.total}</strong> ${r.covered.map((id) => chip(id, "t-green"))}</td>
          <td data-label="${t("match.missing")}" class="hide-lg">${r.missing.length ? r.missing.map((id) => chip(id, "t-grey")) : dash}</td>
          <td data-label="${t("col.rating")}" class="hide-lg">${stars(r.supplier.bewertung) || dash}</td>
          <td class="act"><button type="button" class="btn btn-sm" data-match="rfq" data-id="${r.supplier.id}">${icon("plus")} ${t("match.createRfq")}</button></td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">${t(only && res.rows.length ? "match.noneVetted" : "match.none")}</p>`}`;
}

/**
 * Öffnet die Trefferliste. customerId: Kunde, dessen Kategorien gesucht werden; dealId (optional): Angebot, das bei «Zuordnung anlegen» vorbelegt wird.
 */
export function openMatch(customerId, { dealId = "" } = {}) {
  const c = byId("customers", customerId);
  if (!c) return Promise.resolve(false);
  const deal = dealId ? byId("deals", dealId) : null;
  let only = false;
  const p = confirmDialog({
    title: t("match.title"),
    message: html`<p class="muted">${deal ? t("match.forDeal", { kunde: c.firma, nr: deal.nr }) : t("match.forCustomer", { kunde: c.firma })}</p><div class="match" data-match-body>${body(customerId, only)}</div>`,
    confirmLabel: t("common.close"),
    cancelLabel: "",
    wide: true,
  });
  const d = document.querySelector("dialog.modal[open]");
  if (!d) return p;
  d.classList.add("match-dlg");
  const paint = () => { d.querySelector("[data-match-body]").innerHTML = body(customerId, only).toString(); };
  d.addEventListener("change", (e) => { if (e.target.matches('[data-match="only"]')) { only = e.target.checked; paint(); d.querySelector('[data-match="only"]')?.focus(); } });
  d.addEventListener("click", (e) => {
    const el = e.target.closest("[data-match]");
    if (!el) return;
    if (el.dataset.match === "close") d.close();
    else if (el.dataset.match === "rfq") {
      d.close();
      F.editRecord("rfqs", null, { customerId, supplierId: el.dataset.id, ...(deal ? { dealId: deal.id } : {}), produkt: deal?.produkt || c.produkt || "" });
    } else if (el.dataset.match === "edit-customer") { d.close(); F.editRecord("customers", customerId); }
  });
  return p;
}
