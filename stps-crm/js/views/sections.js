// Abschnitte der Detailansichten (Kunde / Lieferant): Angebote, Zuordnungen, Aktivitäten, Aufgaben + gemeinsame Aktionen.
import { byId, update } from "../store.js";
import { html, money, fmtPct, price } from "../util.js";
import { icon, toast } from "../ui.js";
import { badge, prio, contactsOf, dealsOf, rfqsOfCustomer, rfqsOfSupplier, activitiesOf, tasksOf, rfqContact, isTaskDone, isActivityDone, weightedDeal, articlesOf, warengruppeOf, normChance, amt3 } from "../model.js";
import { fmtArtNr } from "../billing.js";
import { dateCell, dash, customerLink, supplierLink } from "./common.js";
import { shipCell } from "./logistics.js";
import * as F from "../forms.js";
import { openMatch } from "./match.js";
import { t, tv } from "../i18n.js";

const head = (title, count, actions) => html`<div class="card-head"><h2>${title} ${count !== null ? html`<span class="count-pill">${count}</span>` : ""}</h2><div class="card-actions">${actions}</div></div>`;
const addBtn = (act, label) => html`<button type="button" class="btn btn-sm" data-act="${act}">${icon("plus")} ${label}</button>`;
const editBtn = (act, id, label = t("common.edit")) => html`<button type="button" class="icon-btn" data-act="${act}" data-id="${id}" aria-label="${label}" title="${label}">${icon("edit")}</button>`;

export function dealsSection(customerId) {
  const deals = dealsOf(customerId).sort((a, b) => b.nr - a.nr);
  return html`<section class="card">
    ${head(t("nav.angebote"), deals.length, addBtn("add-deal", t("ent.deals.singular")))}
    ${deals.length
      ? html`<div class="table-wrap"><table class="tbl mini"><thead><tr><th>${t("sec.nr")}</th><th>${t("f.deals.produkt")}</th><th>${t("col.phase")}</th><th class="num">${t("sec.value")}</th><th class="num">${t("col.chance")}</th><th class="num hide-lg">${t("col.weighted")}</th><th>${t("col.expectedClose")}</th><th></th></tr></thead>
        <tbody>${deals.map((d) => html`<tr>
          <td data-label="${t("sec.nr")}">${d.nr}</td><td data-label="${t("sec.project")}" class="c-first">${d.produkt}</td><td data-label="${t("col.phase")}">${badge(d.phase)}</td>
          <td data-label="${t("sec.value")}" class="num">${amt3(d, d.wert) || dash}</td><td data-label="${t("col.chance")}" class="num">${fmtPct(normChance(d.chance, d.phase)) || dash}</td>
          <td data-label="${t("col.weighted")}" class="num hide-lg">${amt3(d, weightedDeal(d)) || dash}</td>
          <td data-label="${t("col.expectedClose")}">${dateCell(d.erwarteterAbschluss, { done: d.phase === "Abschluss Ja" || d.phase === "Abschluss Nein" })}</td>
          <td class="act">${d.phase === "Abschluss Ja" || d.phase === "Abschluss Nein" ? "" : html`<button type="button" class="icon-btn" data-act="match-deal" data-id="${d.id}" aria-label="${t("match.btn")}" title="${t("match.btn")}">${icon("search")}</button>`}${editBtn("edit-deal", d.id)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted pad">${t("sec.noDeals")}</p>`}
  </section>`;
}

/** Artikel eines Kunden bzw. Lieferanten (Kunde: Brutto/Rabatt/Netto; Lieferant: zusätzlich Einkaufspreis, intern) */
export function articlesSection(kind, id) {
  const rows = articlesOf(kind, id).sort((a, b) => a.nr - b.nr);
  const supplier = kind === "supplier";
  return html`<section class="card">
    ${head(t("nav.artikel"), rows.length, addBtn("add-article", t("ent.articles.singular")))}
    ${rows.length
      ? html`<div class="table-wrap"><table class="tbl mini"><thead><tr><th>${t("sec.nr")}</th><th>${t("f.articles.bezeichnung")}</th><th class="hide-lg">${t("f.articles.warengruppeId")}</th>${supplier ? html`<th class="num">${t("art.ekShort")}</th>` : ""}<th class="num">${t("f.articles.brutto")}</th><th class="num hide-lg">${t("art.rabattShort")}</th><th class="num">${t("f.articles.netto")}</th><th></th></tr></thead>
        <tbody>${rows.map((a) => html`<tr>
          <td data-label="${t("sec.nr")}"><a href="#/artikel/${a.id}" class="rowlink">${fmtArtNr(a.nr)}</a></td><td data-label="${t("f.articles.bezeichnung")}" class="c-first">${a.bezeichnung}</td>
          <td data-label="${t("f.articles.warengruppeId")}" class="hide-lg">${warengruppeOf(a.warengruppeId)?.code || dash}</td>
          ${supplier ? html`<td data-label="${t("art.ekShort")}" class="num">${price(a.ek, a.waehrung) || dash}</td>` : ""}
          <td data-label="${t("f.articles.brutto")}" class="num">${price(a.brutto, a.waehrung) || dash}</td><td data-label="${t("art.rabattShort")}" class="num hide-lg">${fmtPct(a.rabatt) || dash}</td>
          <td data-label="${t("f.articles.netto")}" class="num"><strong>${price(a.netto, a.waehrung) || "–"}</strong></td>
          <td class="act">${editBtn("edit-article", a.id)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted pad">${t("sec.noArticles")}</p>`}
  </section>`;
}

export function rfqsSection(kind, id) {
  const rows = (kind === "customer" ? rfqsOfCustomer(id) : rfqsOfSupplier(id));
  return html`<section class="card">
    ${head(t("sec.rfqsTitle"), rows.length, addBtn("add-rfq", t("ent.rfqs.singular")))}
    ${rows.length
      ? html`<div class="table-wrap"><table class="tbl mini"><thead><tr><th>${kind === "customer" ? t("ent.suppliers.singular") : t("ent.customers.singular")}</th>${kind === "customer" ? html`<th>${t("sec.contact")}</th>` : ""}<th>${t("f.rfqs.produkt")}</th><th>${t("col.phase")}</th><th class="num">${t("col.offer")}</th><th>${t("f.rfqs.leadTime")}</th><th>${t("log.delivery")}</th><th></th></tr></thead>
        <tbody>${rows.map((r) => {
          const c = rfqContact(r);
          return html`<tr>
            <td data-label="${kind === "customer" ? t("ent.suppliers.singular") : t("ent.customers.singular")}" class="c-first">${kind === "customer" ? supplierLink(r.supplierId) : customerLink(r.customerId)}</td>
            ${kind === "customer" ? html`<td data-label="${t("sec.contact")}">${c ? c.name : dash}</td>` : ""}
            <td data-label="${t("sec.product")}">${r.produkt || dash}</td><td data-label="${t("col.phase")}">${badge(r.phase)}</td>
            <td data-label="${t("col.offer")}" class="num">${money(r.angebot, r.waehrung) || dash}</td><td data-label="${t("f.rfqs.leadTime")}">${r.leadTime || dash}</td><td data-label="${t("log.delivery")}">${shipCell(r)}</td>
            <td class="act">${editBtn("edit-rfq", r.id)}</td></tr>`;
        })}</tbody></table></div>`
      : html`<p class="muted pad">${t("sec.noRfqs")}</p>`}
  </section>`;
}

/** Kontaktperson einer Aktivität (beim Kunden oder Lieferanten) */
const activityContact = (a) => (a.contactId ? [byId("customers", a.customerId), byId("suppliers", a.supplierId)].map((r) => contactsOf(r).find((c) => c.id === a.contactId)).find(Boolean) : null);

export function activitiesSection(kind, id) {
  const acts = activitiesOf(kind, id).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || b.nr - a.nr);
  return html`<section class="card">
    ${head(t("sec.activitiesTitle"), acts.length, addBtn("add-activity", t("ent.activities.singular")))}
    ${acts.length
      ? html`<ol class="timeline">${acts.map((a) => html`<li class="${isActivityDone(a) ? "done" : ""}">
          <div class="tl-dot" aria-hidden="true"></div>
          <div class="tl-body">
            <div class="tl-head"><strong>${tv("actType", a.typ)}</strong> <span class="muted">${dateCell(a.datum)}</span> ${a.ort ? html`<span class="muted">· ${a.ort}</span>` : ""} ${a.owner ? html`<span class="muted">· ${a.owner}</span>` : ""}
              ${activityContact(a) ? html`<span class="muted">· ${t("f.activities.contactId")}: <strong>${activityContact(a).name}</strong></span>` : ""}
              ${kind === "customer" && a.supplierId ? html`<span class="muted">· ${t("ent.suppliers.singular")}: ${supplierLink(a.supplierId)}</span>` : ""}
              ${kind === "supplier" && a.customerId ? html`<span class="muted">· ${t("ent.customers.singular")}: ${customerLink(a.customerId)}</span>` : ""}
              <span class="spacer"></span>${badge(a.status)}${editBtn("edit-activity", a.id)}</div>
            ${a.notiz ? html`<div class="tl-note">${a.notiz}</div>` : ""}
            ${a.naechsterSchritt || a.faellig ? html`<div class="tl-next">${t("f.activities.naechsterSchritt")}: <strong>${a.naechsterSchritt || "–"}</strong> ${a.faellig ? html`· ${t("sec.due")} ${dateCell(a.faellig, { done: isActivityDone(a) })}` : ""}</div>` : ""}
          </div></li>`)}</ol>`
      : html`<p class="muted pad">${t("sec.noActivities")}</p>`}
  </section>`;
}

export function tasksSection(kind, id) {
  const tasks = tasksOf(kind, id).sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)) || (a.faellig || "").localeCompare(b.faellig || ""));
  return html`<section class="card">
    ${head(t("ent.tasks.plural"), tasks.length, addBtn("add-task", t("ent.tasks.singular")))}
    ${tasks.length
      ? html`<ul class="tasklist">${tasks.map((tk) => html`<li class="${isTaskDone(tk) ? "done" : ""}">
          <input type="checkbox" class="chk" data-act="toggle-task" data-id="${tk.id}" ${isTaskDone(tk) ? "checked" : ""} aria-label="${t("tasks.doneAria", { name: tk.aufgabe })}">
          <div class="t-main"><div class="t-title">${tk.aufgabe}</div>
            <div class="muted">${dateCell(tk.faellig, { done: isTaskDone(tk) })} · ${tk.owner || "–"} ${tk.prioritaet ? html`· ${prio(tk.prioritaet)}` : ""}</div></div>
          ${badge(tk.status)}${editBtn("edit-task", tk.id)}</li>`)}</ul>`
      : html`<p class="muted pad">${t("sec.noTasks")}</p>`}
  </section>`;
}

/** Notizen-Karte (Lieferant): mehrzeilig, direkt bearbeitbar */
export function notesCard(rec, { title = t("notes.title"), field = "notiz", empty = t("notes.empty") } = {}) {
  return html`<section class="card notes-card" data-notes>
    <div class="card-head"><h2>${title}</h2><div class="card-actions"><button type="button" class="btn btn-sm" data-act="edit-notes">${icon("edit")} ${t("common.edit")}</button></div></div>
    <div class="notes-view" data-notes-view>${rec[field] ? html`<div class="notes-text">${rec[field]}</div>` : html`<p class="muted pad">${empty}</p>`}</div>
    <div class="notes-edit" data-notes-edit hidden>
      <label class="sr" for="notes-ta">${title}</label>
      <textarea id="notes-ta" rows="10" data-notes-ta>${rec[field] || ""}</textarea>
      <div class="notes-actions"><button type="button" class="btn" data-act="cancel-notes">${t("common.cancel")}</button><button type="button" class="btn btn-primary" data-act="save-notes">${t("notes.save")}</button></div>
    </div>
  </section>`;
}

/**
 * Klick-Handler für alle Aktionen in Kunden-/Lieferanten-Detailansichten.
 * ctx: { coll: 'customers'|'suppliers', id }
 */
export function bindDetailActions(root, ctx) {
  const kind = ctx.coll === "customers" ? "customer" : "supplier";
  const presetKey = kind === "customer" ? "customerId" : "supplierId";
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT") return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case "edit": return F.editRecord(ctx.coll, ctx.id);
      case "delete": return F.deleteRecord(ctx.coll, ctx.id, { navigate: true });
      case "add-activity": return F.editRecord("activities", null, { [presetKey]: ctx.id });
      case "add-contact-activity": return F.editRecord("activities", null, { [presetKey]: ctx.id, contactId: id });
      case "add-task": return F.editRecord("tasks", null, { [presetKey]: ctx.id });
      case "add-deal": return F.editRecord("deals", null, { customerId: ctx.id });
      case "add-rfq": return F.editRecord("rfqs", null, { [presetKey]: ctx.id });
      case "add-article": return F.editRecord("articles", null, { [presetKey]: ctx.id });
      case "edit-article": return F.editRecord("articles", id);
      case "edit-deal": return F.editRecord("deals", id);
      case "match-deal": return openMatch(ctx.id, { dealId: id });
      case "edit-rfq": return F.editRecord("rfqs", id);
      case "edit-activity": return F.editRecord("activities", id);
      case "edit-task": return F.editRecord("tasks", id);
      case "add-contact": return F.editContact(ctx.coll, ctx.id);
      case "edit-contact": return F.editContact(ctx.coll, ctx.id, id);
      case "delete-contact": return F.deleteContact(ctx.coll, ctx.id, id);
      case "primary-contact": return F.setPrimaryContact(ctx.coll, ctx.id, id);
      case "edit-notes": {
        root.querySelector("[data-notes-view]").hidden = true;
        root.querySelector("[data-notes-edit]").hidden = false;
        const ta = root.querySelector("[data-notes-ta]");
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return;
      }
      case "cancel-notes": {
        const rec = byId(ctx.coll, ctx.id);
        root.querySelector("[data-notes-ta]").value = rec.notiz || "";
        root.querySelector("[data-notes-view]").hidden = false;
        root.querySelector("[data-notes-edit]").hidden = true;
        return;
      }
      case "save-notes": {
        const text = root.querySelector("[data-notes-ta]").value.trim();
        root.querySelector("[data-notes-edit]").hidden = true; // damit das Neuzeichnen nicht blockiert wird
        update(ctx.coll, ctx.id, { notiz: text });
        toast(t("toast.notesSaved"), { type: "ok" });
        return;
      }
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset?.act === "toggle-task") F.toggleTask(el.dataset.id);
  });
}

