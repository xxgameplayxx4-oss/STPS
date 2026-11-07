// «Passende Lieferanten»: zu den Produktkategorien eines Kunden (bzw. Angebots) die Lieferanten, die diese Kategorien ganz oder teilweise abdecken.
// Geprüfte Lieferanten stehen zuerst. Aus einem Treffer lässt sich direkt eine Lieferantenzuordnung (RFQ) anlegen.
import { byId, all, create, remove, batch } from "../store.js";
import { html } from "../util.js";
import { confirmDialog, icon, toast } from "../ui.js";
import { t } from "../i18n.js";
import { badge, stars, ENT, isClosedPhase } from "../model.js";
import { kategorienOf, matchSuppliers, catShort } from "../categories.js";
import { dash } from "./common.js";
import * as F from "../forms.js";

/** Offene Angebote des Kunden (Auswahl im Dialog) */
const openDeals = (customerId) => all("deals").filter((d) => d.customerId === customerId && !isClosedPhase(d.phase)).sort((a, b) => b.nr - a.nr);

/** Geprüfte, passende Lieferanten, für die es zu diesem Kunden (und Angebot) noch keine Zuordnung gibt */
function rfqTargets(customerId, dealId) {
  const c = byId("customers", customerId);
  const res = matchSuppliers(kategorienOf(c));
  const have = new Set(all("rfqs").filter((r) => r.customerId === customerId && (r.dealId || "") === (dealId || "")).map((r) => r.supplierId));
  return res.rows.filter((r) => r.vetted && !have.has(r.supplier.id)).map((r) => r.supplier);
}

const chip = (id, cls = "t-navy") => html`<span class="badge ${cls}">${catShort(id)}</span>`;

function body(customerId, only, dealId = "", notice = null) {
  const c = byId("customers", customerId);
  const wanted = kategorienOf(c);
  if (!wanted.length) {
    return html`<p>${t("match.noCats")}</p><p><button type="button" class="btn" data-match="edit-customer">${icon("edit")} ${t("match.editCustomer")}</button></p>`;
  }
  const res = matchSuppliers(wanted);
  const rows = only ? res.rows.filter((r) => r.vetted) : res.rows;
  const deals = openDeals(customerId);
  const todo = rfqTargets(customerId, dealId);
  return html`<div class="match-wanted"><strong>${t("match.wanted")}</strong> ${wanted.map((id) => chip(id))}</div>
    ${deals.length ? html`<label class="field match-deal"><span>${t("match.deal")}</span><select data-match="deal"><option value="">${t("match.noDeal")}</option>${deals.map((d) => html`<option value="${d.id}" ${d.id === dealId ? "selected" : ""}>${d.nr} · ${d.produkt || ""}</option>`)}</select></label>` : ""}
    <label class="check match-only"><input type="checkbox" data-match="only" ${only ? "checked" : ""}> <span>${t("match.onlyVetted")}</span></label>
    <div class="match-bulk"><button type="button" class="btn btn-primary" data-match="rfq-all" ${todo.length ? "" : "disabled"}>${icon("plus")} ${t("match.rfqAll")}${todo.length ? ` (${todo.length})` : ""}</button>
      <span class="muted">${todo.length ? t("match.rfqAllHint") : t(res.rows.some((r) => r.vetted) ? "match.rfqAllDone" : "match.rfqAllNone")}</span></div>
    ${notice ? html`<div class="match-notice" role="status"><span>${notice.text}</span>${notice.undo ? html` <button type="button" class="btn btn-sm" data-match="undo">${t("board.undo")}</button>` : ""}</div>` : ""}
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
  // Angebot: vorgegeben, sonst das einzige offene
  const open = openDeals(customerId);
  let deal = (dealId && byId("deals", dealId)) || (open.length === 1 ? open[0] : null);
  let only = false;
  let notice = null;
  const p = confirmDialog({
    title: t("match.title"),
    message: html`<p class="muted" data-match-for>${forText(c, deal)}</p><div class="match" data-match-body>${body(customerId, only, deal?.id || "")}</div>`,
    confirmLabel: t("common.close"),
    cancelLabel: "",
    wide: true,
  });
  const d = document.querySelector("dialog.modal[open]");
  if (!d) return p;
  d.classList.add("match-dlg");
  const paint = () => {
    d.querySelector("[data-match-body]").innerHTML = body(customerId, only, deal?.id || "", notice).toString();
    d.querySelector("[data-match-for]").textContent = forText(c, deal);
  };
  d.addEventListener("change", (e) => {
    if (e.target.matches('[data-match="only"]')) { only = e.target.checked; paint(); d.querySelector('[data-match="only"]')?.focus(); }
    else if (e.target.matches('[data-match="deal"]')) { deal = e.target.value ? byId("deals", e.target.value) : null; notice = null; paint(); d.querySelector('[data-match="deal"]')?.focus(); }
  });
  const undoCreated = (made) => {
    if (made.undone) return;
    made.undone = true;
    // nur unveränderte Zuordnungen zurücknehmen (inzwischen bearbeitete bleiben)
    let removed = 0, kept = 0;
    batch(() => made.forEach(({ id, stamp }) => { const r = byId("rfqs", id); if (!r) return; if (r.updatedAt === stamp) { remove("rfqs", id); removed++; } else kept++; }));
    notice = { text: kept ? t("match.undoneKept", { n: removed, kept }) : t("match.undone", { n: removed }) };
    if (d.isConnected) paint();
    toast(notice.text, { type: "ok" });
  };
  const rfqAll = async () => {
    const targets = rfqTargets(customerId, deal?.id || "");
    if (!targets.length) return;
    const names = targets.slice(0, 8).map((s) => s.firma);
    const ok = await confirmDialog({
      title: t("match.rfqAllTitle"),
      message: html`<p>${t("match.rfqAllMsg", { n: targets.length, kunde: c.firma })}${deal ? " " + t("match.rfqAllDeal", { nr: deal.nr }) : ""}</p>
        <ul>${names.map((n) => html`<li>${n}</li>`)}${targets.length > names.length ? html`<li class="muted">${t("match.rfqAllMore", { n: targets.length - names.length })}</li>` : ""}</ul>
        <p class="muted">${t("match.rfqAllUndoHint")}</p>`,
      confirmLabel: t("match.rfqAllConfirm", { n: targets.length }),
    });
    if (!ok) return;
    const made = [];
    batch(() => {
      for (const s of targets) {
        const rec = create("rfqs", { ...ENT.rfqs.defaults(), customerId, supplierId: s.id, ...(deal ? { dealId: deal.id } : {}), produkt: deal?.produkt || c.produkt || "" });
        made.push({ id: rec.id, stamp: rec.updatedAt });
      }
    });
    const undo = () => undoCreated(made);
    notice = { text: t("match.rfqAllCreated", { n: made.length }), undo: true };
    if (d.isConnected) paint();
    toast(t("match.rfqAllCreated", { n: made.length }), { type: "ok", ms: 12000, action: { label: t("board.undo"), onClick: undo } });
    d.__undo = undo;
  };
  d.addEventListener("click", (e) => {
    const el = e.target.closest("[data-match]");
    if (!el) return;
    if (el.dataset.match === "close") d.close();
    else if (el.dataset.match === "rfq") {
      d.close();
      F.editRecord("rfqs", null, { customerId, supplierId: el.dataset.id, ...(deal ? { dealId: deal.id } : {}), produkt: deal?.produkt || c.produkt || "" });
    } else if (el.dataset.match === "rfq-all") rfqAll();
    else if (el.dataset.match === "undo") d.__undo?.();
    else if (el.dataset.match === "edit-customer") { d.close(); F.editRecord("customers", customerId); }
  });
  return p;
}

const forText = (c, deal) => (deal ? t("match.forDeal", { kunde: c.firma, nr: deal.nr }) : t("match.forCustomer", { kunde: c.firma }));
