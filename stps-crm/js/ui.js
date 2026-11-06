// UI-Bausteine: Icons, Toasts, Dialoge (Formular-Seitenpanel, Bestätigung), Formular-Generator inkl. Kontaktpersonen.
import { html, raw, esc, uid, fmtNum, fmtDate, parseDate, parseAmount } from "./util.js";
import { t } from "./i18n.js";
import { openSlideOver } from "./slideover.js";
import { addressesHtml, readAddresses, bindAddresses } from "./addr-editor.js";

// ------------------------------------------------------------ Icons (inline SVG, CSP-tauglich)

const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  factory: "M3 21V10l6 4v-4l6 4V4h3a1 1 0 0 1 1 1v16zM3 21h18",
  link: "M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z",
  chatlines: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12zM8.5 10h7M8.5 14h4.5",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  gear: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  plus: "M12 5v14M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
  menu: "M3 6h18M3 12h18M3 18h18",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  calendar: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M8 2v4M16 2v4",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  upload: "M12 15V3M7 8l5-5 5 5M4 21h16",
  back: "M19 12H5M12 19l-7-7 7-7",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  cloud: "M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
  sort: "M7 15l5 5 5-5M7 9l5-5 5 5",
  team: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  shield: "M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6zM9 12l2 2 4-4",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  receipt: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  columns: "M3 4h18v16H3zM9 4v16M15 4v16",
  rows: "M3 4h18v16H3zM3 10h18M3 15h18",
  filter: "M4 4h16l-6 8v6l-4 2v-8z",
  command: "M6 6a3 3 0 1 1 3 3H6zm12 0a3 3 0 1 0-3 3h3zM6 18a3 3 0 1 0 3-3H6zm12 0a3 3 0 1 1-3-3h3zM9 9h6v6H9z",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  kanban: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
};

export const icon = (name, cls = "") =>
  raw(`<svg class="ic ${esc(cls)}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${P[name] || ""}"/></svg>`);

/**
 * Brotkrumen für die Seiten-/Detailkopfzeile (ersetzt den «Zurück»-Link).
 * @param {Array<{label:string, href?:string}>} items – der letzte Eintrag ist die aktuelle Seite (ohne href).
 */
export function crumbs(items) {
  const parts = items.filter(Boolean);
  return html`<nav class="crumbs" aria-label="Breadcrumb">${parts.map((c, i) => html`${i > 0 ? html`<span class="sep" aria-hidden="true">${icon("chevron-right", "sm")}</span>` : ""}${c.href && i < parts.length - 1 ? html`<a href="${c.href}">${c.label}</a>` : html`<span class="cur" aria-current="page">${c.label}</span>`}`)}</nav>`;
}

// ------------------------------------------------------------ Toasts

export function toast(msg, { type = "info", ms = 4500, link = null } = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  // Optionaler Link (nur https): {href, label}; öffnet in neuem Tab
  if (link && /^https:\/\//i.test(String(link.href || ""))) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.label;
    a.className = "toast-link";
    el.append(" ", a);
  }
  host.appendChild(el);
  // Popover = oberste Ebene, damit Toasts auch über offenen Dialogen sichtbar sind
  try { if (host.matches(":popover-open")) host.hidePopover(); host.showPopover(); } catch { /* ältere Browser */ }
  const kill = () => { el.classList.add("out"); setTimeout(() => el.remove(), 250); };
  el.addEventListener("click", kill);
  if (ms) setTimeout(kill, ms);
}

// ------------------------------------------------------------ Dialoge

const closeHooks = new Set();
export const anyDialogOpen = () => document.querySelector("dialog[open]") !== null;
export const onDialogsClosed = (fn) => { closeHooks.add(fn); return () => closeHooks.delete(fn); };

function makeDialog(cls) {
  const d = document.createElement("dialog");
  d.className = cls;
  document.body.appendChild(d);
  d.addEventListener("close", () => {
    d.remove();
    if (!anyDialogOpen()) closeHooks.forEach((f) => f());
  });
  return d;
}

export function confirmDialog({ title = t("dlg.confirm"), message = "", confirmLabel = t("common.ok"), cancelLabel = t("common.cancel"), danger = false, requireText = null, wide = false } = {}) {
  return new Promise((resolve) => {
    const d = makeDialog(wide ? "modal wide" : "modal");
    d.setAttribute("aria-labelledby", "cd-title");
    d.innerHTML = html`<form method="dialog" class="confirm">
      <h2 id="cd-title">${title}</h2>
      <div class="confirm-msg">${message}</div>
      ${requireText ? html`<label class="field"><span class="help">${t("dlg.typeToConfirm", { text: requireText })}</span><input type="text" data-require autocomplete="off"></label>` : ""}
      <div class="dlg-foot">
        ${cancelLabel ? html`<button type="button" class="btn" data-no>${cancelLabel}</button>` : ""}
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes ${requireText ? "disabled" : ""}>${confirmLabel}</button>
      </div>
    </form>`.toString();
    let result = false;
    const yes = d.querySelector("[data-yes]");
    d.querySelector("[data-no]")?.addEventListener("click", () => d.close());
    yes.addEventListener("click", () => { result = true; d.close(); });
    d.querySelector("[data-require]")?.addEventListener("input", (e) => { yes.disabled = e.target.value.trim() !== requireText; });
    d.addEventListener("close", () => resolve(result));
    d.showModal();
    (d.querySelector("[data-require]") || d.querySelector(danger ? "[data-no]" : "[data-yes]") || yes).focus();
  });
}

// ------------------------------------------------------------ Formular-Generator

let formSeq = 0;
const asOpt = (o) => (typeof o === "object" && o !== null ? o : { value: String(o), label: String(o) });

function optionsFor(f, vals) {
  const src = typeof f.options === "function" ? f.options(vals) : f.options || [];
  return src.map(asOpt);
}

function selectHtml(f, id, vals) {
  const opts = optionsFor(f, vals);
  const rawV = f.normalize ? f.normalize(vals[f.key], vals) : vals[f.key]; // z. B. alte freie Prozentwerte auf die Auswahl abbilden
  const cur = rawV === null || rawV === undefined ? "" : String(rawV);
  const hasCur = cur === "" || opts.some((o) => String(o.value) === cur);
  const blankLabel = (typeof f.blank === "function" ? f.blank(vals) : f.blank) || (f.required ? t("form.pleaseChoose") : "—");
  const blank = !f.required || cur === "" ? html`<option value="">${blankLabel}</option>` : "";
  return html`<select id="${id}" name="${f.key}" data-key="${f.key}">${blank}${hasCur ? "" : html`<option value="${cur}" selected>${cur}</option>`}${opts.map((o) => html`<option value="${o.value}" ${String(o.value) === cur ? "selected" : ""}>${o.label}</option>`)}</select>`;
}

function dateHtml(f, id, v) {
  return html`<div class="date-wrap"><input type="text" id="${id}" name="${f.key}" data-key="${f.key}" data-date inputmode="numeric" placeholder="${t("form.datePh")}" autocomplete="off" value="${fmtDate(v)}"><button type="button" class="icon-btn" data-datepick tabindex="-1" aria-label="${t("form.openCalendar")}">${icon("calendar")}</button><input type="date" class="date-native" tabindex="-1" aria-hidden="true" value="${v || ""}"></div>`;
}

const blankContact = (primary = false) => ({ id: uid(), name: "", funktion: "", email: "", telefon: "", mobile: "", notiz: "", primary });

function contactCardHtml(c, group) {
  const inp = (key, label, type = "text", extra = "") =>
    html`<label class="cf"><span>${label}</span><input type="${type}" data-c="${key}" value="${c[key] || ""}" autocomplete="off" ${extra}></label>`;
  return html`<fieldset class="contact-card" data-contact-id="${c.id}">
    <div class="cc-head">
      <span class="cc-title">${t("contact.person")}</span>
      <label class="radio"><input type="radio" name="${group}" value="${c.id}" ${c.primary ? "checked" : ""}> ${t("contact.primary")}</label>
      <button type="button" class="icon-btn" data-remove-contact aria-label="${t("contact.remove")}" title="${t("common.remove")}">${icon("trash")}</button>
    </div>
    <div class="cc-err" role="alert"></div>
    <div class="grid2">
      <div class="full">${inp("name", t("f.contact.name") + " *")}</div>
      ${inp("funktion", t("f.contact.funktion"))}
      ${inp("email", t("f.contact.email"), "email")}
      ${inp("telefon", t("f.contact.telefon"), "tel")}
      ${inp("mobile", t("f.contact.mobile"), "tel")}
      <label class="cf full"><span>${t("f.contact.notiz")}</span><textarea data-c="notiz" rows="2">${c.notiz || ""}</textarea></label>
      <label class="check full" title="${t("f.contact.rechnung.help")}"><input type="checkbox" data-c="rechnung" ${c.rechnung ? "checked" : ""}> ${t("f.contact.rechnung")}</label>
    </div>
  </fieldset>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldHtml(f, vals, seq) {
  const id = `f${seq}-${f.key}`;
  const v = vals[f.key];
  const req = f.required ? html`<span class="req" aria-hidden="true"> *</span>` : "";
  let control;
  switch (f.type) {
    case "textarea":
      control = html`<textarea id="${id}" name="${f.key}" data-key="${f.key}" rows="${f.rows || 3}" placeholder="${f.placeholder || ""}">${v ?? ""}</textarea>`; break;
    case "select": control = selectHtml(f, id, vals); break;
    case "password":
      control = html`<input type="password" id="${id}" name="${f.key}" data-key="${f.key}" autocomplete="${f.autocomplete || "new-password"}" value="">`; break;
    case "date": control = dateHtml(f, id, v); break;
    case "money":
      control = html`<input type="text" id="${id}" name="${f.key}" data-key="${f.key}" inputmode="decimal" autocomplete="off" placeholder="${f.placeholder || "0"}" value="${v === null || v === undefined || v === "" ? "" : fmtNum(v)}">`; break;
    case "percent":
      control = html`<input type="number" id="${id}" name="${f.key}" data-key="${f.key}" min="0" max="100" step="any" inputmode="decimal" placeholder="${t("form.percentPh")}" value="${v ?? ""}">`; break;
    case "email": case "tel":
      control = html`<input type="${f.type}" id="${id}" name="${f.key}" data-key="${f.key}" autocomplete="off" value="${v ?? ""}">`; break;
    case "checkbox":
      return html`<div class="field full" data-field="${f.key}"><label class="check"><input type="checkbox" id="${id}" name="${f.key}" data-key="${f.key}" ${v ? "checked" : ""}> ${f.label}</label>${f.help ? html`<div class="help">${f.help}</div>` : ""}<div class="err" role="alert"></div></div>`;
    case "widget":
      return html`<div class="field full" data-field="${f.key}"><div class="label">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ""}</div><div data-widget="${f.key}"></div><div class="err" role="alert"></div></div>`;
    case "info":
      control = html`<div class="info-box" id="${id}" data-info="${f.key}">${f.render ? f.render(vals) : ""}</div>`; break;
    case "addresses": return addressesHtml(f, vals);
    case "contacts": {
      const list = Array.isArray(v) && v.length ? v : [blankContact(true)];
      const group = `primary-${seq}`;
      const hasPrimary = list.some((c) => c.primary);
      control = html`<div class="contacts-ed" data-contacts data-group="${group}">
        <div class="contacts-list">${list.map((c, i) => contactCardHtml({ ...c, primary: hasPrimary ? c.primary : i === 0 }, group))}</div>
        <button type="button" class="btn btn-sm" data-add-contact>${icon("plus")} ${t("contact.addMore")}</button>
      </div>`;
      return html`<div class="field full" data-field="${f.key}"><div class="label">${f.label}</div>${control}<div class="err" role="alert"></div></div>`;
    }
    default:
      control = html`<input type="text" id="${id}" name="${f.key}" data-key="${f.key}" autocomplete="off" placeholder="${f.placeholder || ""}" value="${v ?? ""}">`;
  }
  return html`<div class="field ${f.full ? "full" : ""}" data-field="${f.key}"><label for="${id}">${f.label}${req}</label>${control}${f.help ? html`<div class="help">${f.help}</div>` : ""}<div class="err" role="alert"></div></div>`;
}

/**
 * Öffnet ein Formular als Seitenpanel.
 * @param {object} o { title, fields, values, submitLabel, onSubmit(vals)->Promise<false|void>, validate(vals)->{key:msg}, extra:[{label,danger,onClick}] }
 * @returns {Promise<boolean>} true = gespeichert
 */
export function openForm(o) {
  return new Promise((resolve) => {
    const seq = ++formSeq;
    const fields = o.fields;
    const cur = { ...(o.values || {}) };
    // Breiteres Panel für Formulare mit Positionen-Editor (Angebote, Rechnungen)
    const wide = o.wide ?? fields.some((f) => f.type === "widget");
    const d = makeDialog(wide ? "drawer wide" : "drawer");
    d.setAttribute("aria-labelledby", `ft-${seq}`);
    d.innerHTML = html`<form novalidate class="form" autocomplete="off">
      <header class="dlg-head"><div><h2 id="ft-${seq}">${o.title}</h2>${o.subtitle ? html`<div class="sub">${o.subtitle}</div>` : ""}</div><button type="button" class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x")}</button></header>
      <div class="dlg-body">
        <div class="form-error" role="alert"></div>
        <div class="grid2">${fields.map((f) => fieldHtml(f, cur, seq))}</div>
      </div>
      <footer class="dlg-foot">
        ${(o.extra || []).length ? html`<div class="foot-extra">${(o.extra || []).map((a, i) => html`<button type="button" class="btn ${a.danger ? "btn-danger-ghost" : ""}" data-extra="${i}">${a.label}</button>`)}</div>` : ""}
        <div class="foot-main">
          <button type="button" class="btn" data-close>${t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary" title="${t("form.submitHint", { label: o.submitLabel || t("common.save") })}">${o.submitLabel || t("common.save")}</button>
        </div>
      </footer>
    </form>`.toString();

    const form = d.querySelector("form");
    const formErr = d.querySelector(".form-error");
    let dirty = false;
    let done = false;
    let saved = false;

    const fieldEl = (key) => form.querySelector(`[data-field="${key}"]`);
    const setErr = (key, msg) => {
      const el = fieldEl(key);
      if (!el) return;
      const e = el.querySelector(":scope > .err");
      if (e) e.textContent = msg || "";
      el.classList.toggle("invalid", Boolean(msg));
      el.querySelectorAll("input,select,textarea").forEach((i) => (msg ? i.setAttribute("aria-invalid", "true") : i.removeAttribute("aria-invalid")));
    };

    // ---- Werte lesen
    function readContacts() {
      const wrap = form.querySelector("[data-contacts]");
      const out = [];
      let primaryId = wrap.querySelector('input[type="radio"]:checked')?.value;
      let ok = true;
      wrap.querySelectorAll(".contact-card").forEach((card) => {
        const c = { id: card.dataset.contactId, primary: false };
        card.querySelectorAll("[data-c]").forEach((i) => { c[i.dataset.c] = i.type === "checkbox" ? i.checked : i.value.trim(); });
        const any = ["name", "funktion", "email", "telefon", "mobile", "notiz"].some((k) => c[k]);
        const err = card.querySelector(".cc-err");
        err.textContent = "";
        card.classList.remove("invalid");
        if (!any) return;
        const msgs = [];
        if (!c.name) msgs.push(t("val.nameRequired"));
        if (c.email && !EMAIL_RE.test(c.email)) msgs.push(t("val.emailInvalid"));
        if (msgs.length) { ok = false; err.textContent = msgs.join(" "); card.classList.add("invalid"); }
        out.push(c);
      });
      let billingSeen = false; // genau ein Rechnungskontakt (Buchhaltung): der erste markierte gilt
      out.forEach((c) => { c.rechnung = Boolean(c.rechnung) && !billingSeen; billingSeen = billingSeen || c.rechnung; });
      if (out.length) {
        const p = out.find((c) => c.id === primaryId) || out[0];
        out.forEach((c) => { c.primary = c === p; });
      }
      return { value: out, ok };
    }

    function readField(f) {
      if (f.type === "addresses") { const r = readAddresses(form); return { value: r.value, error: r.ok ? "" : t("val.checkAddresses") }; }
      if (f.type === "contacts") { const r = readContacts(); return { value: r.value, error: r.ok ? "" : t("val.checkContacts") }; }
      if (f.type === "info") return { value: undefined };
      if (f.type === "widget") return f.widget.read();
      if (f.type === "checkbox") return { value: Boolean(form.querySelector(`[name="${f.key}"]`)?.checked) };
      const el = form.querySelector(`[name="${f.key}"]`);
      const raw = el ? el.value : "";
      let value, error = "";
      switch (f.type) {
        case "money": {
          const n = parseAmount(raw);
          if (Number.isNaN(n)) error = t("val.amountInvalid");
          else if (n !== null && n < 0) error = t("val.amountNegative");
          value = n; break;
        }
        case "percent": {
          if (String(raw).trim() === "") value = null;
          else { const n = Number(raw); if (Number.isNaN(n) || n < 0 || n > 100) error = t("val.percentRange"); value = n; }
          break;
        }
        case "date": {
          const iso = parseDate(raw);
          if (iso === null) error = t("val.dateInvalid");
          value = iso ?? ""; break;
        }
        case "select":
          value = f.numeric ? (raw === "" ? null : Number(raw)) : raw; break;
        case "password":
          value = raw; break; // Passwörter nie trimmen
        default:
          value = raw.trim();
      }
      if (!error && f.required && (value === "" || value === null || (Array.isArray(value) && !value.length))) error = t("val.required");
      if (!error && f.validate) error = f.validate(value) || "";
      return { value, error };
    }

    function collect() {
      const values = {};
      const errors = {};
      for (const f of fields) {
        const r = readField(f);
        if (f.type !== "info") values[f.key] = r.value;
        errors[f.key] = r.error || "";
      }
      if (o.validate) Object.assign(errors, Object.fromEntries(Object.entries(o.validate(values) || {}).filter(([, m]) => m)));
      return { values, errors };
    }

    function currentValues() {
      const v = { ...cur };
      for (const f of fields) {
        if (f.type === "contacts" || f.type === "addresses" || f.type === "info" || f.type === "widget") continue;
        const el = form.querySelector(`[name="${f.key}"]`);
        if (!el) continue;
        if (f.type === "checkbox") v[f.key] = el.checked;
        else if (f.type === "date") v[f.key] = parseDate(el.value) || "";
        else if (f.type === "money") { const n = parseAmount(el.value); v[f.key] = Number.isNaN(n) ? null : n; }
        else v[f.key] = el.value;
      }
      return v;
    }

    // ---- Abhängigkeiten (Optionen/Infos neu berechnen)
    function refreshDependents(changedKey) {
      const vals = currentValues();
      for (const f of fields) {
        if (!f.dependsOn || !f.dependsOn.includes(changedKey)) continue;
        const wrap = fieldEl(f.key);
        if (f.type === "select") {
          const sel = wrap.querySelector("select");
          const prev = sel.value;
          const tmp = { ...vals, [f.key]: prev };
          const keep = optionsFor(f, tmp).some((x) => String(x.value) === prev) ? prev : "";
          sel.outerHTML = selectHtml(f, sel.id, { ...vals, [f.key]: keep }).toString();
        } else if (f.type === "info") {
          wrap.querySelector("[data-info]").innerHTML = (f.render ? f.render(vals) : "").toString();
        }
      }
      if (o.onChange) o.onChange(changedKey, vals, { set: setValue, form });
    }

    function setValue(key, value) {
      const el = form.querySelector(`[name="${key}"]`);
      if (!el) return;
      const f = fields.find((x) => x.key === key);
      el.value = f?.type === "date" ? fmtDate(value) : f?.type === "money" ? fmtNum(value) : (value ?? "");
      if (f?.type === "date") el.parentElement.querySelector(".date-native").value = value || "";
    }

    // ---- Events
    form.addEventListener("input", (e) => { dirty = true; if (e.target.dataset?.key) { setErr(e.target.dataset.key, ""); } });
    form.addEventListener("change", (e) => {
      dirty = true;
      const t = e.target;
      if (t.classList.contains("date-native")) {
        const txt = t.parentElement.querySelector("[data-date]");
        txt.value = fmtDate(t.value);
        setErr(txt.dataset.key, "");
        refreshDependents(txt.dataset.key);
        return;
      }
      if (t.dataset?.key) refreshDependents(t.dataset.key);
    });
    form.addEventListener("focusout", (e) => {
      const t = e.target;
      if (t.matches?.("[data-date]")) {
        const iso = parseDate(t.value);
        if (iso) { t.value = fmtDate(iso); t.parentElement.querySelector(".date-native").value = iso; }
      } else if (t.matches?.('input[inputmode="decimal"][data-key]') && t.type === "text") {
        const n = parseAmount(t.value);
        if (n !== null && !Number.isNaN(n)) t.value = fmtNum(n);
      }
    });
    form.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.hasAttribute("data-close")) tryClose();
      else if (btn.hasAttribute("data-datepick")) {
        const nat = btn.parentElement.querySelector(".date-native");
        const txt = btn.parentElement.querySelector("[data-date]");
        const iso = parseDate(txt.value);
        if (iso) nat.value = iso;
        try { nat.showPicker(); } catch { nat.focus(); nat.click(); }
      } else if (btn.hasAttribute("data-add-contact")) {
        const wrap = btn.closest("[data-contacts]");
        const list = wrap.querySelector(".contacts-list");
        const first = !list.querySelector('input[type="radio"]:checked');
        list.insertAdjacentHTML("beforeend", contactCardHtml(blankContact(first), wrap.dataset.group).toString());
        dirty = true;
        list.lastElementChild.querySelector("[data-c=name]").focus();
      } else if (btn.hasAttribute("data-remove-contact")) {
        const card = btn.closest(".contact-card");
        const list = card.parentElement;
        const wasPrimary = card.querySelector('input[type="radio"]').checked;
        card.remove();
        if (wasPrimary) { const r = list.querySelector('input[type="radio"]'); if (r) r.checked = true; }
        dirty = true;
      } else if (btn.dataset.extra !== undefined) {
        o.extra[Number(btn.dataset.extra)].onClick?.({ close: (ok) => finish(ok), isDirty: () => dirty });
      }
    });

    async function tryClose() {
      if (dirty) {
        const ok = await confirmDialog({ title: t("form.discardTitle"), message: t("form.discardMsg"), confirmLabel: t("form.discard"), cancelLabel: t("form.keepEditing"), danger: true });
        if (!ok) return;
      }
      finish(false);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      saved = ok;
      d.close();
    }
    d.addEventListener("cancel", (e) => { e.preventDefault(); tryClose(); });
    d.addEventListener("close", () => resolve(saved));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      formErr.textContent = "";
      const { values, errors } = collect();
      let first = null;
      for (const f of fields) {
        if (f.type === "info") continue;
        setErr(f.key, errors[f.key]);
        if (errors[f.key] && !first) first = f.key;
      }
      for (const [k, m] of Object.entries(errors)) if (m && !fields.some((f) => f.key === k)) { formErr.textContent = m; first = first || "__form"; }
      if (first) {
        formErr.textContent = formErr.textContent || t("val.checkFields");
        const el = first === "__form" ? formErr : fieldEl(first);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.querySelector?.("input,select,textarea")?.focus({ preventScroll: true });
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const res = await o.onSubmit(values);
        if (res === false) { submit.disabled = false; return; }
        finish(true);
      } catch (err) {
        console.error(err);
        formErr.textContent = err?.message || t("form.saveFailed");
        submit.disabled = false;
      }
    });

    bindAddresses(form, cur, () => { dirty = true; });

    // Eingebettete Bausteine (z. B. Positionen-Editor) einhängen
    for (const f of fields) {
      if (f.type !== "widget") continue;
      f.widget.mount(form.querySelector(`[data-widget="${f.key}"]`), cur, { form, set: setValue, changed: () => { dirty = true; setErr(f.key, ""); } });
    }

    openSlideOver(d, { requestClose: tryClose, submit: () => { if (!form.querySelector('[type="submit"]').disabled) form.requestSubmit(); } });
    const firstInput = form.querySelector('.field:not([data-field="contacts"]):not([data-field="addresses"]) input:not([type=hidden]), .field select, .field textarea') || form.querySelector("input");
    firstInput?.focus({ preventScroll: true });
  });
}
