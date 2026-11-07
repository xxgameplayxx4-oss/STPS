// Gemeinsame Darstellungs-Bausteine für die Ansichten.
import { html, fmtDate, isOverdue, relDay, mailLink, telLink, initials, todayISO } from "../util.js";
import { icon } from "../ui.js";
import { badge, landTag, customerCountry, contactsOf, primaryContact, customerLabel, supplierLabel, deliveryAddresses, billingAddress, effectiveAddress, addressNr, addressLines } from "../model.js";
import { byId, all } from "../store.js";
import { t, tv } from "../i18n.js";

/** Datum, überfällige rot. done=true: nie rot (z. B. erledigte Aufgaben) */
export function dateCell(iso, { done = false, rel = false } = {}) {
  if (!iso) return html`<span class="muted">–</span>`;
  const over = !done && isOverdue(iso);
  const today = !done && iso === todayISO();
  return html`<span class="date ${over ? "overdue" : ""} ${today ? "today" : ""}" ${over ? html`title="${t("date.overdue", { rel: relDay(iso) })}"` : ""}>${fmtDate(iso)}${rel && !done && (over || today) ? html` <small>${relDay(iso)}</small>` : ""}</span>`;
}

export const ownerCell = (o) => (o ? html`<span class="owner"><span class="av" aria-hidden="true">${initials(o)}</span>${o}</span>` : html`<span class="muted">–</span>`);

export const dash = html`<span class="muted">–</span>`;

/** Hauptkontakt für Tabellen: Name, E-Mail/Telefon als Links, "+n" für weitere */
export function contactCell(rec) {
  const p = primaryContact(rec);
  if (!p) return dash;
  const more = contactsOf(rec).length - 1;
  return html`<div class="ccell"><span class="cname">${p.name}${more > 0 ? html` <span class="more" title="${t("contact.moreCount", { n: more })}">+${more}</span>` : ""}</span>
    ${p.funktion ? html`<small class="muted">${p.funktion}</small>` : ""}
    ${p.rechnung ? html`<small><span class="badge t-teal">${t("contact.billingShort")}</span></small>` : ""}
    ${p.email ? html`<small>${mailLink(p.email)}</small>` : ""}
    ${p.telefon || p.mobile ? html`<small>${telLink(p.telefon || p.mobile)}</small>` : ""}</div>`;
}

export const customerLink = (id, { land = false } = {}) => {
  const c = byId("customers", id);
  return c ? html`<a href="#/kunden/${c.id}" class="rowlink">${c.firma}</a><small class="nr">${c.nr}</small>${land ? landTag(customerCountry(c)) : ""}` : dash;
};
export const supplierLink = (id) => {
  const s = byId("suppliers", id);
  return s ? html`<a href="#/lieferanten/${s.id}" class="rowlink">${s.firma}</a><small class="nr">${s.nr}</small>` : dash;
};

export const textCell = (v) => (v ? html`<span class="clamp" title="${v}">${v}</span>` : dash);

/** Verlauf einer Kontaktperson: Aktivitäten (wann, wie, wo), neueste zuerst */
const activitiesOfContact = (contactId) => all("activities").filter((a) => a.contactId === contactId).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || b.nr - a.nr);
function contactHistory(c) {
  const acts = activitiesOfContact(c.id);
  return html`<details class="c-hist" data-contact-history="${c.id}"><summary>${t("hist.contact")} <span class="count-pill">${acts.length}</span></summary>
    ${acts.length
      ? html`<ul class="hist-list">${acts.map((a) => html`<li><span class="h-date">${dateCell(a.datum, { done: true })}</span> <strong>${tv("actType", a.typ)}</strong>${a.ort ? html` <span class="muted">· ${a.ort}</span>` : ""}${a.owner ? html` <span class="muted">· ${a.owner}</span>` : ""}
          <button type="button" class="icon-btn" data-act="edit-activity" data-id="${a.id}" aria-label="${t("common.edit")}" title="${t("common.edit")}">${icon("edit")}</button>
          ${a.notiz ? html`<div class="tl-note">${a.notiz}</div>` : ""}</li>`)}</ul>`
      : html`<p class="muted">${t("hist.contactNone")}</p>`}
    <button type="button" class="btn btn-sm" data-act="add-contact-activity" data-id="${c.id}">${icon("plus")} ${t("hist.addForContact")}</button>
  </details>`;
}

/** Adressen-Karte des Kunden: Rechnungsadresse (Stamm, Kundennr.) und Lieferadressen (Unternummern 10000.1 …) */
export function addressesCard(c) {
  const list = deliveryAddresses(c);
  const lines = (addr) => addressLines(addr).map((l, i) => html`${i ? html`<br>` : ""}${l}`);
  const billing = billingAddress(c);
  return html`<section class="card" aria-labelledby="h-addr">
    <div class="card-head"><h2 id="h-addr">${t("addr.title")} <span class="count-pill">${list.length + 1}</span></h2>
      <button type="button" class="btn btn-sm" data-act="edit">${icon("edit")} ${t("addr.edit")}</button></div>
    <ul class="addr-list">
      <li data-addr="billing"><div class="a-nr">${c.nr}</div><div class="a-main"><div class="a-title"><strong>${t("addr.billing")}</strong></div>
        <div>${c.firma}</div><div class="muted">${lines(billing).length ? lines(billing) : "–"}</div></div></li>
      ${list.map((a) => {
        const eff = effectiveAddress(c, a);
        const contact = contactsOf(c).find((x) => x.id === a.contactId);
        return html`<li data-addr="${a.id}" class="${a.aktiv === false ? "inactive" : ""}"><div class="a-nr">${addressNr(c, a)}</div><div class="a-main">
          <div class="a-title"><strong>${a.bezeichnung || t("addr.delivery")}</strong> ${a.aktiv === false ? html`<span class="badge t-grey">${t("addr.inactive")}</span>` : ""}${a.same ? html` <span class="badge t-sky">${t("addr.sameShort")}</span>` : ""}</div>
          <div class="muted">${lines(eff).length ? lines(eff) : "–"}</div>
          ${contact ? html`<div>${icon("users", "sm")} ${contact.name}${contact.telefon || contact.mobile ? html` · ${telLink(contact.telefon || contact.mobile)}` : ""}</div>` : ""}
          ${a.notiz ? html`<div class="c-note">${a.notiz}</div>` : ""}</div></li>`;
      })}
    </ul>
  </section>`;
}

/** Kontakte-Karte (Detailansicht), mailto:/tel:-Links, Aktionen pro Kontakt */
export function contactsCard(rec, coll) {
  const cs = contactsOf(rec);
  return html`<section class="card" aria-labelledby="h-contacts">
    <div class="card-head"><h2 id="h-contacts">${t("contact.persons")} <span class="count-pill">${cs.length}</span></h2>
      <button type="button" class="btn btn-sm" data-act="add-contact">${icon("plus")} ${t("contact.person")}</button></div>
    ${cs.length
      ? html`<ul class="contacts">${cs.map((c) => html`<li class="contact ${c.primary ? "primary" : ""}" data-contact="${c.id}">
          <div class="av lg" aria-hidden="true">${initials(c.name)}</div>
          <div class="c-main">
            <div class="c-name">${c.name}${c.primary ? html` <span class="badge t-navy" title="${t("contact.primaryTitle")}">${icon("star", "sm")} ${t("contact.primary")}</span>` : ""}${c.rechnung ? html` <span class="badge t-teal" title="${t("f.contact.rechnung.help")}">${t("contact.billingShort")}</span>` : ""}</div>
            ${c.funktion ? html`<div class="muted">${c.funktion}</div>` : ""}
            <div class="c-links">
              ${c.email ? html`<span>${icon("mail", "sm")} ${mailLink(c.email)}</span>` : ""}
              ${c.telefon ? html`<span>${icon("phone", "sm")} ${telLink(c.telefon)}</span>` : ""}
              ${c.mobile ? html`<span>${icon("phone", "sm")} ${telLink(c.mobile)} <small class="muted">${t("f.contact.mobile")}</small></span>` : ""}
            </div>
            ${c.notiz ? html`<div class="c-note">${c.notiz}</div>` : ""}
            ${contactHistory(c)}
          </div>
          <div class="c-actions">
            ${!c.primary ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="primary-contact" data-id="${c.id}">${t("contact.makePrimary")}</button>` : ""}
            <button type="button" class="icon-btn" data-act="edit-contact" data-id="${c.id}" aria-label="${t("common.editItem", { name: c.name })}" title="${t("common.edit")}">${icon("edit")}</button>
            <button type="button" class="icon-btn" data-act="delete-contact" data-id="${c.id}" aria-label="${t("common.deleteItem", { name: c.name })}" title="${t("common.delete")}">${icon("trash")}</button>
          </div>
        </li>`)}</ul>`
      : html`<p class="muted pad">${t("contact.noneYet")}</p>`}
  </section>`;
}

/** Definitionsliste (Label/Wert) */
export function dl(items) {
  return html`<dl class="dl">${items.filter(Boolean).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v === "" || v === null || v === undefined ? dash : v}</dd></div>`)}</dl>`;
}

// Strichskala (Signatur der Oberfläche): eine Teilung mit einer Ablesemarke, wie am Messschieber. Der Anteil wird als Klasse gesetzt
// (p-0 … p-10, Schritte von 10 %), weil die strenge CSP keine Inline-Stile erlaubt. Die Skala ist stumm für Hilfstechnik – die Zahl steht daneben.
export const scaleStep = (frac) => Math.max(0, Math.min(10, Math.round((Number(frac) || 0) * 10)));
export const gauge = (value, max) => html`<span class="gauge p-${scaleStep(max > 0 ? value / max : 0)}" aria-hidden="true"></span>`;

export { badge, customerLabel, supplierLabel };
