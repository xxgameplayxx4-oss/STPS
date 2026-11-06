// Formular-Baustein «Lieferadressen» des Kunden (Feldtyp "addresses"): beliebig viele Lieferadressen mit Unternummer (10000.1, .2 …),
// «gleich wie Rechnungsadresse»-Haken, Kontaktperson vor Ort (aus den Kontakten desselben Formulars) und Aktiv-Schalter.
// Die Rechnungsadresse sind die Stammfelder Strasse/PLZ/Ort/Land des Kunden. Wird von ui.js (openForm) eingebunden.
import { html, uid } from "./util.js";
import { icon } from "./ui.js";
import { t, getLang } from "./i18n.js";
import { COUNTRIES, countryName } from "./countries.js";

const countryOpts = (cur) => {
  const known = !cur || COUNTRIES.some((c) => c.code === cur);
  return html`<option value="">${t("form.pleaseChoose")}</option>${known ? "" : html`<option value="${cur}" selected>${cur}</option>`}${COUNTRIES.map((c) => html`<option value="${c.code}" ${c.code === cur ? "selected" : ""}>${c.code} · ${countryName(c.code, getLang())}</option>`)}`;
};
const contactOpts = (contacts, cur) => html`<option value="">${t("addr.noContact")}</option>${contacts.map((c) => html`<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${c.name}${c.funktion ? " – " + c.funktion : ""}</option>`)}`;

function cardHtml(a, nr, contacts) {
  const inp = (key, label, extra = "") => html`<label class="cf ${extra}"><span>${label}</span><input type="text" data-a="${key}" value="${a[key] || ""}" autocomplete="off"></label>`;
  return html`<fieldset class="contact-card addr-card" data-addr-id="${a.id}" data-sub="${a.sub}">
    <div class="cc-head">
      <span class="cc-title">${t("addr.delivery")} <span class="addr-nr">${nr ? nr + "." : "."}${a.sub}</span></span>
      <label class="radio"><input type="checkbox" data-a="aktiv" ${a.aktiv !== false ? "checked" : ""}> ${t("addr.active")}</label>
      <button type="button" class="icon-btn" data-remove-addr aria-label="${t("addr.remove")}" title="${t("common.remove")}">${icon("trash")}</button>
    </div>
    <div class="cc-err" role="alert"></div>
    <div class="grid2">
      <label class="cf full"><span>${t("f.addr.bezeichnung")}</span><input type="text" data-a="bezeichnung" value="${a.bezeichnung || ""}" placeholder="${t("f.addr.bezeichnung.ph")}" autocomplete="off"></label>
      <label class="check full"><input type="checkbox" data-a="same" ${a.same ? "checked" : ""}> ${t("addr.same")}</label>
      <div class="addr-fields full grid2" ${a.same ? "hidden" : ""}>
        ${inp("strasse", t("f.customers.strasse"), "full")}
        ${inp("plz", t("f.customers.plz"))}
        ${inp("ort", t("f.customers.ort"))}
        <label class="cf full"><span>${t("f.customers.land")} *</span><select data-a="land">${countryOpts(a.land || "")}</select></label>
      </div>
      <label class="cf full"><span>${t("f.addr.contactId")}</span><select data-a="contactId">${contactOpts(contacts, a.contactId || "")}</select></label>
      <label class="cf full"><span>${t("f.addr.notiz")}</span><textarea data-a="notiz" rows="2">${a.notiz || ""}</textarea></label>
    </div>
  </fieldset>`;
}

/** Feld im Formular: vals.addresses = Lieferadressen, vals.contacts = Kontakte (für die Auswahl), vals.nr = Kundennummer */
export function addressesHtml(f, vals) {
  const list = Array.isArray(vals.addresses) ? vals.addresses : [];
  const contacts = (Array.isArray(vals.contacts) ? vals.contacts : []).filter((c) => c.name);
  return html`<div class="field full" data-field="${f.key}"><div class="label">${f.label}</div>
    <p class="help">${t("addr.help")}</p>
    <div class="contacts-ed" data-addresses data-nr="${vals.nr ?? ""}" data-seq="${vals.addrSeq || 0}">
      <div class="contacts-list">${list.map((a) => cardHtml(a, vals.nr, contacts))}</div>
      <button type="button" class="btn btn-sm" data-add-addr>${icon("plus")} ${t("addr.add")}</button>
    </div><div class="err" role="alert"></div></div>`;
}

const currentContacts = (form) =>
  [...form.querySelectorAll("[data-contacts] .contact-card")].map((c) => ({ id: c.dataset.contactId, name: c.querySelector("[data-c=name]")?.value.trim(), funktion: c.querySelector("[data-c=funktion]")?.value.trim() })).filter((c) => c.name);

/** Gelesene Lieferadressen; leere Karten fallen weg. ok=false, wenn Pflichtangaben fehlen. */
export function readAddresses(form) {
  const wrap = form.querySelector("[data-addresses]");
  const out = [];
  let ok = true;
  const ids = new Set(currentContacts(form).map((c) => c.id));
  wrap.querySelectorAll(".addr-card").forEach((card) => {
    const a = { id: card.dataset.addrId, sub: Number(card.dataset.sub) };
    card.querySelectorAll("[data-a]").forEach((i) => { a[i.dataset.a] = i.type === "checkbox" ? i.checked : i.value.trim(); });
    const err = card.querySelector(".cc-err");
    err.textContent = "";
    card.classList.remove("invalid");
    if (a.same) { a.strasse = ""; a.plz = ""; a.ort = ""; a.land = ""; }
    if (!ids.has(a.contactId)) a.contactId = "";
    if (!a.same && !["bezeichnung", "strasse", "plz", "ort", "land", "contactId", "notiz"].some((k) => a[k])) return; // leere Karte
    const msgs = [];
    if (!a.same && !a.ort) msgs.push(t("addr.val.ort"));
    if (!a.same && !a.land) msgs.push(t("addr.val.land"));
    if (msgs.length) { ok = false; err.textContent = msgs.join(" "); card.classList.add("invalid"); }
    out.push(a);
  });
  return { value: out, ok };
}

/** Ereignisse des Bausteins; markDirty: Formular als geändert markieren */
export function bindAddresses(form, cur, markDirty) {
  const wrap = form.querySelector("[data-addresses]");
  if (!wrap) return;
  const list = wrap.querySelector(".contacts-list");
  form.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !wrap.contains(btn)) return;
    if (btn.hasAttribute("data-add-addr")) {
      const subs = [...list.querySelectorAll(".addr-card")].map((c) => Number(c.dataset.sub) || 0);
      const sub = Math.max(Number(wrap.dataset.seq) || 0, ...subs) + 1;
      list.insertAdjacentHTML("beforeend", cardHtml({ id: uid(), sub, aktiv: true, same: false, land: form.querySelector('[name="land"]')?.value || "" }, wrap.dataset.nr, currentContacts(form)).toString());
      markDirty();
      list.lastElementChild.querySelector("[data-a=bezeichnung]").focus();
    } else if (btn.hasAttribute("data-remove-addr")) {
      btn.closest(".addr-card").remove();
      markDirty();
    }
  });
  form.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset?.a === "same") el.closest(".addr-card").querySelector(".addr-fields").hidden = el.checked;
  });
  // Kontaktpersonen-Auswahl bei Bedarf aus den (evtl. neu erfassten) Kontakten des Formulars neu aufbauen
  const refresh = (e) => {
    const sel = e.target;
    if (!sel.matches?.('select[data-a="contactId"]') || !wrap.contains(sel)) return;
    const prev = sel.value;
    sel.innerHTML = contactOpts(currentContacts(form), prev).toString();
    sel.value = prev;
  };
  form.addEventListener("focusin", refresh);
  form.addEventListener("mousedown", refresh);
}
