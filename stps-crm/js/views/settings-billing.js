// Einstellungen «Abrechnung»: Warengruppen (Nummernbereiche der Artikel), Firmenangaben für Dokumente, MWST, Zahlungsfrist, Rechnungs-Startnummer.
// Team-Admins ändern (im Lokalen Modus jede Person), Mitglieder sehen die Angaben nur. Gespeichert in db.settings.billing.
import * as store from "../store.js";
import { html } from "../util.js";
import { t } from "../i18n.js";
import { icon, toast } from "../ui.js";
import { uid } from "../util.js";
import { fmtArtNr, parseArtNr, validateRanges, INVOICE_CURRENCIES, DEFAULT_CURRENCY } from "../billing.js";
import { isQrIban, normIban, REF_TYPES } from "../qrbill.js";
import { subsOf, usageCount } from "../categories.js";

const canEdit = () => store.S.mode === "local" || store.isTeamAdmin();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const subRow = (s) => html`<div class="wg-sub" data-sub="${s.id}">
  <span class="wg-sub-mark" aria-hidden="true">›</span>
  <input type="text" data-sv="name" value="${s.name}" aria-label="${t("wg.subName")}" placeholder="${t("wg.subName")}">
  <button type="button" class="icon-btn" data-bill="sub-del" aria-label="${t("wg.subRemove")}" title="${t("common.remove")}">${icon("trash")}</button>
</div>`;

function groupRow(g, edit) {
  return edit
    ? html`<div class="wg-block" data-wg="${g.id}">
      <div class="wg-row">
        <input type="text" data-v="code" value="${g.code}" aria-label="${t("wg.code")}" placeholder="${t("wg.code")}" maxlength="12">
        <input type="text" data-v="name" value="${g.name}" aria-label="${t("wg.name")}" placeholder="${t("wg.name")}">
        <input type="text" data-v="von" inputmode="numeric" value="${g.von ? fmtArtNr(g.von) : ""}" aria-label="${t("wg.von")}" placeholder="100.001">
        <input type="text" data-v="bis" inputmode="numeric" value="${g.bis ? fmtArtNr(g.bis) : ""}" aria-label="${t("wg.bis")}" placeholder="100.100">
        <button type="button" class="icon-btn" data-bill="wg-del" aria-label="${t("wg.remove")}" title="${t("common.remove")}">${icon("trash")}</button>
      </div>
      <div class="wg-subs" data-wg-subs>${subsOf(g).map(subRow)}</div>
      <button type="button" class="btn btn-sm btn-ghost wg-sub-add" data-bill="sub-add">${icon("plus")} ${t("wg.subAdd")}</button>
    </div>`
    : html`<tr><td><span class="badge t-navy">${g.code}</span></td><td>${g.name}${subsOf(g).length ? html`<div class="muted wg-sublist">› ${subsOf(g).map((x) => x.name).join(" · ")}</div>` : ""}</td><td class="num">${fmtArtNr(g.von)}</td><td class="num">${fmtArtNr(g.bis)}</td></tr>`;
}

function groupsCard(b, edit) {
  const gs = b.warengruppen;
  return html`<section class="card span-all" data-bill-card="groups">
    <div class="card-head"><h2>${t("wg.title")}</h2></div>
    ${edit
      ? html`<form class="list-ed pad" data-bill-form="groups" novalidate>
          <p class="help">${t("wg.help")}</p>
          <div class="wg-head" aria-hidden="true"><span>${t("wg.code")}</span><span>${t("wg.name")}</span><span>${t("wg.von")}</span><span>${t("wg.bis")}</span><span></span></div>
          <div class="wg-rows" data-wg-rows>${gs.map((g) => groupRow(g, true))}</div>
          <p class="muted" data-wg-empty ${gs.length ? "hidden" : ""}>${t("wg.empty")}</p>
          <div class="le-actions">
            <button type="button" class="btn btn-sm" data-bill="wg-add">${icon("plus")} ${t("wg.add")}</button>
            <span class="spacer"></span>
            <button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button>
          </div>
          <div class="err" role="alert" data-bill-err></div>
        </form>`
      : html`<div class="pad">
          ${gs.length
            ? html`<div class="table-wrap"><table class="tbl mini"><thead><tr><th>${t("wg.code")}</th><th>${t("wg.name")}</th><th class="num">${t("wg.von")}</th><th class="num">${t("wg.bis")}</th></tr></thead><tbody>${gs.map((g) => groupRow(g, false))}</tbody></table></div>`
            : html`<p class="muted">${t("wg.empty")}</p>`}
          <p class="help">${t("billing.readOnly")}</p>
        </div>`}
  </section>`;
}

const textField = (key, label, v, edit, { type = "text", help = "", ph = "" } = {}) => html`<div class="field">
  <label for="bill-${key}">${label}</label>
  <input type="${type}" id="bill-${key}" name="${key}" ${type === "number" ? html`step="any" inputmode="decimal"` : ""} autocomplete="off" value="${v ?? ""}" placeholder="${ph}" ${edit ? "" : "disabled"}>
  ${help ? html`<div class="help">${help}</div>` : ""}<div class="err" role="alert"></div></div>`;

function firmCard(b, edit) {
  return html`<section class="card" data-bill-card="firma">
    <div class="card-head"><h2>${t("billing.firma.title")}</h2></div>
    <form class="list-ed pad" data-bill-form="firma" novalidate>
      <p class="help">${t("billing.firma.help")}</p>
      ${textField("firma", t("billing.firma"), b.firma, edit)}
      ${textField("adresse", t("billing.adresse"), b.adresse, edit)}
      <div class="field-row">
        ${textField("landCode", t("billing.landCode"), b.landCode, edit, { ph: "CH" })}
        ${textField("plz", t("billing.plz"), b.plz, edit, { ph: "8807" })}
        ${textField("ort", t("billing.ort"), b.ort, edit, { ph: "Freienbach" })}
      </div>
      ${textField("land", t("billing.land"), b.land, edit, { help: t("billing.addrPreview", { line: senderLine(b) || "–" }) })}
      ${textField("telefon", t("billing.telefon"), b.telefon, edit)}
      ${textField("email", t("billing.email"), b.email, edit, { type: "email" })}
      ${textField("uid", t("billing.uid"), b.uid, edit, { ph: "CHE-123.456.789" })}
      ${textField("mwstNr", t("billing.mwstNr"), b.mwstNr, edit, { ph: "CHE-123.456.789 MWST" })}
      ${textField("handelsregister", t("billing.handelsregister"), b.handelsregister, edit, { help: t("billing.handelsregister.help") })}
      ${edit ? html`<div class="le-actions"><span class="spacer"></span><button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button></div>` : html`<p class="help">${t("billing.readOnly")}</p>`}
      <div class="err" role="alert" data-bill-err></div>
    </form>
  </section>`;
}

const senderLine = (b) => [b.landCode && b.plz ? `${b.landCode}-${b.plz}` : b.plz, b.ort].filter(Boolean).join(" ");

function bankRow(k, edit) {
  return edit
    ? html`<div class="bk-row" data-bk="${k.id}">
        <input type="text" data-v="bank" value="${k.bank}" aria-label="${t("billing.bank")}" placeholder="${t("billing.bank")}">
        <input type="text" data-v="iban" value="${k.iban}" aria-label="${t("billing.iban")}" placeholder="CH00 0000 0000 0000 0000 0">
        <input type="text" data-v="bic" value="${k.bic}" aria-label="${t("billing.bic")}" placeholder="BIC / SWIFT">
        <select data-v="waehrung" aria-label="${t("billing.bankCur")}">${INVOICE_CURRENCIES.map((c) => html`<option value="${c}" ${c === k.waehrung ? "selected" : ""}>${c}</option>`)}</select>
        <button type="button" class="icon-btn" data-bill="bk-del" aria-label="${t("billing.bankRemove")}" title="${t("common.remove")}">${icon("trash")}</button>
        <input type="text" class="bk-qr" data-v="qrIban" value="${k.qrIban || ""}" aria-label="${t("billing.qrIban")}" placeholder="${t("billing.qrIban.ph")}">
      </div>`
    : html`<tr><td>${k.bank}</td><td>${k.iban}${k.qrIban ? html`<div class="muted">${t("billing.qrIban")}: ${k.qrIban}</div>` : ""}</td><td>${k.bic}</td><td><span class="badge t-navy">${k.waehrung}</span></td></tr>`;
}

function banksCard(b, edit) {
  const ks = b.banks;
  return html`<section class="card span-all" data-bill-card="banks">
    <div class="card-head"><h2>${t("billing.banks.title")}</h2></div>
    ${edit
      ? html`<form class="list-ed pad" data-bill-form="banks" novalidate>
          <p class="help">${t("billing.banks.help")}</p>
          <div class="bk-head" aria-hidden="true"><span>${t("billing.bank")}</span><span>${t("billing.iban")}</span><span>${t("billing.bic")}</span><span>${t("billing.bankCur")}</span><span></span></div>
          <div class="bk-rows" data-bk-rows>${ks.map((k) => bankRow(k, true))}</div>
          <p class="muted" data-bk-empty ${ks.length ? "hidden" : ""}>${t("billing.banks.empty")}</p>
          <div class="le-actions">
            <button type="button" class="btn btn-sm" data-bill="bk-add">${icon("plus")} ${t("billing.bankAdd")}</button>
            <span class="spacer"></span>
            <button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button>
          </div>
          <div class="err" role="alert" data-bill-err></div>
        </form>`
      : html`<div class="pad">
          ${ks.length
            ? html`<div class="table-wrap"><table class="tbl mini"><thead><tr><th>${t("billing.bank")}</th><th>${t("billing.iban")}</th><th>${t("billing.bic")}</th><th>${t("billing.bankCur")}</th></tr></thead><tbody>${ks.map((k) => bankRow(k, false))}</tbody></table></div>`
            : html`<p class="muted">${t("billing.banks.empty")}</p>`}
          <p class="help">${t("billing.readOnly")}</p>
        </div>`}
  </section>`;
}

function termsCard(b, edit) {
  return html`<section class="card" data-bill-card="terms">
    <div class="card-head"><h2>${t("billing.terms.title")}</h2></div>
    <form class="list-ed pad" data-bill-form="terms" novalidate>
      ${textField("mwstSatz", t("billing.mwstSatz"), b.mwstSatz, edit, { type: "number", help: t("billing.mwstSatz.help") })}
      ${textField("zahlungsfristTage", t("billing.zahlungsfrist"), b.zahlungsfristTage, edit, { type: "number", help: t("billing.zahlungsfrist.help") })}
      ${textField("invoiceStart", t("billing.invoiceStart"), b.invoiceStart, edit, { type: "number", help: t("billing.invoiceStart.help") })}
      ${edit ? html`<div class="le-actions"><span class="spacer"></span><button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button></div>` : html`<p class="help">${t("billing.readOnly")}</p>`}
      <div class="err" role="alert" data-bill-err></div>
    </form>
  </section>`;
}

function checkField(key, label, v, edit) {
  return html`<label class="check"><input type="checkbox" name="${key}" ${v ? "checked" : ""} ${edit ? "" : "disabled"}> <span>${label}</span></label>`;
}

/** WP-B: AGB (Zusatzseite hinter Auftragsbestätigung / Offerte) und Referenzart der QR-Rechnung */
function docsCard(b, edit) {
  return html`<section class="card span-all" data-bill-card="docs">
    <div class="card-head"><h2>${t("billing.docs.title")}</h2></div>
    <form class="list-ed pad" data-bill-form="docs" novalidate>
      <p class="help">${t("billing.docs.help")}</p>
      <div class="field">
        <label for="bill-agb">${t("billing.agb")}</label>
        <textarea id="bill-agb" name="agb" rows="10" ${edit ? "" : "disabled"}>${b.agb || ""}</textarea>
        <div class="help">${t("billing.agb.help")}</div>
      </div>
      ${checkField("agbAuftragsbestaetigung", t("billing.agbAb"), b.agbAuftragsbestaetigung, edit)}
      ${checkField("agbOfferte", t("billing.agbOfferte"), b.agbOfferte, edit)}
      <div class="field">
        <label for="bill-qrRefType">${t("billing.qrRefType")}</label>
        <select id="bill-qrRefType" name="qrRefType" ${edit ? "" : "disabled"}>${REF_TYPES.map((r) => html`<option value="${r}" ${r === b.qrRefType ? "selected" : ""}>${t(`billing.qrRef.${r}`)}</option>`)}</select>
        <div class="help">${t("billing.qrRefType.help")}</div>
      </div>
      <p class="help qr-test-help"><strong>${t("billing.qrTest")}</strong></p>
      ${edit ? html`<div class="le-actions"><span class="spacer"></span><button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button></div>` : html`<p class="help">${t("billing.readOnly")}</p>`}
      <div class="err" role="alert" data-bill-err></div>
    </form>
  </section>`;
}

export function cardsHtml() {
  const b = store.getBilling();
  const edit = canEdit();
  return html`${groupsCard(b, edit)}${firmCard(b, edit)}${termsCard(b, edit)}${banksCard(b, edit)}${docsCard(b, edit)}`;
}

const val = (form, name) => form.querySelector(`[name="${name}"]`).value.trim();

function setFieldErr(form, name, msg) {
  const f = form.querySelector(`[name="${name}"]`)?.closest(".field");
  if (!f) return;
  f.querySelector(".err").textContent = msg || "";
  f.classList.toggle("invalid", Boolean(msg));
}

function saveGroups(form) {
  const err = form.querySelector("[data-bill-err]");
  const rows = [...form.querySelectorAll("[data-wg]")].map((r) => ({
    id: r.dataset.wg,
    unterkategorien: [...r.querySelectorAll("[data-sub]")].map((x) => ({ id: x.dataset.sub, name: x.querySelector('[data-sv="name"]').value.trim() })),
    code: r.querySelector('[data-v="code"]').value.trim(),
    name: r.querySelector('[data-v="name"]').value.trim(),
    von: parseArtNr(r.querySelector('[data-v="von"]').value),
    bis: parseArtNr(r.querySelector('[data-v="bis"]').value),
  }));
  const fail = (key, params) => { err.textContent = t(key, params); };
  if (rows.some((r) => !r.code || !r.name)) return fail("wg.err.required");
  if (rows.some((r) => r.von === null || r.bis === null)) return fail("wg.err.range");
  if (rows.some((r) => r.unterkategorien.some((x) => !x.name))) return fail("wg.err.subRequired");
  if (rows.some((r) => new Set(r.unterkategorien.map((x) => x.name.toLowerCase())).size !== r.unterkategorien.length)) return fail("wg.err.subDup");
  const codes = rows.map((r) => r.code.toLowerCase());
  if (new Set(codes).size !== codes.length) return fail("wg.err.dupCode");
  const errs = validateRanges(rows);
  if (errs.includes("von>bis")) return fail("wg.err.order");
  if (errs.includes("overlap")) return fail("wg.err.overlap");
  const keep = new Set(rows.map((r) => r.id));
  for (const g of store.getBilling().warengruppen) {
    const n = store.all("articles").filter((a) => a.warengruppeId === g.id).length;
    if (!keep.has(g.id) && n) return fail("wg.err.inUse", { name: g.name, n });
    const nk = usageCount(g.id);
    if (!keep.has(g.id) && nk > 0) return fail("wg.err.inUseKat", { name: g.name, n: nk });
    const kept = new Set((rows.find((r) => r.id === g.id)?.unterkategorien || []).map((x) => x.id));
    for (const u of subsOf(g)) if (keep.has(g.id) && !kept.has(u.id) && usageCount(u.id)) return fail("wg.err.subInUse", { name: u.name, n: usageCount(u.id) });
  }
  err.textContent = "";
  store.setBilling({ warengruppen: rows });
  toast(t("wg.saved"), { type: "ok" });
}

function saveFirm(form) {
  const err = form.querySelector("[data-bill-err]");
  setFieldErr(form, "email", "");
  const email = val(form, "email");
  if (email && !EMAIL_RE.test(email)) { setFieldErr(form, "email", t("val.emailInvalidShort")); err.textContent = t("val.checkFields"); return; }
  err.textContent = "";
  store.setBilling(Object.fromEntries(["firma", "adresse", "landCode", "plz", "ort", "land", "telefon", "email", "uid", "mwstNr", "handelsregister"].map((k) => [k, val(form, k)])));
  toast(t("billing.saved"), { type: "ok" });
}

function saveBanks(form) {
  const err = form.querySelector("[data-bill-err]");
  const rows = [...form.querySelectorAll("[data-bk]")].map((r) => ({
    id: r.dataset.bk,
    bank: r.querySelector('[data-v="bank"]').value.trim(),
    iban: r.querySelector('[data-v="iban"]').value.trim(),
    qrIban: normIban(r.querySelector('[data-v="qrIban"]').value),
    bic: r.querySelector('[data-v="bic"]').value.trim().toUpperCase(),
    waehrung: r.querySelector('[data-v="waehrung"]').value,
  }));
  if (rows.some((r) => !r.iban)) { err.textContent = t("billing.err.iban"); return; }
  if (rows.some((r) => r.qrIban && !isQrIban(r.qrIban))) { err.textContent = t("billing.err.qrIban"); return; }
  err.textContent = "";
  store.setBilling({ banks: rows });
  toast(t("billing.saved"), { type: "ok" });
}

function saveDocs(form) {
  store.setBilling({
    agb: form.querySelector('[name="agb"]').value.replace(/\r\n/g, "\n").trim(),
    agbAuftragsbestaetigung: form.querySelector('[name="agbAuftragsbestaetigung"]').checked,
    agbOfferte: form.querySelector('[name="agbOfferte"]').checked,
    qrRefType: form.querySelector('[name="qrRefType"]').value,
  });
  form.querySelector("[data-bill-err]").textContent = "";
  toast(t("billing.saved"), { type: "ok" });
}

function saveTerms(form) {
  const err = form.querySelector("[data-bill-err]");
  const out = {};
  let bad = false;
  const check = (key, parse, ok, msg) => {
    setFieldErr(form, key, "");
    const n = parse(val(form, key));
    if (!ok(n)) { setFieldErr(form, key, t(msg)); bad = true; } else out[key] = n;
  };
  const dec = (s) => (s === "" ? NaN : Number(s.replace(",", ".")));
  check("mwstSatz", dec, (n) => Number.isFinite(n) && n >= 0 && n <= 100, "billing.err.mwst");
  check("zahlungsfristTage", dec, (n) => Number.isInteger(n) && n >= 0 && n <= 365, "billing.err.days");
  check("invoiceStart", dec, (n) => Number.isInteger(n) && n >= 1, "billing.err.start");
  if (bad) { err.textContent = t("val.checkFields"); return; }
  err.textContent = "";
  store.setBilling(out);
  toast(t("billing.saved"), { type: "ok" });
}

export function bind(root) {
  if (!canEdit()) return;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-bill]");
    if (!b) return;
    const form = b.closest("form");
    if (b.dataset.bill === "sub-add") {
      const host = b.closest("[data-wg]").querySelector("[data-wg-subs]");
      host.insertAdjacentHTML("beforeend", subRow({ id: "uk_" + uid().slice(0, 8), name: "" }).toString());
      host.lastElementChild.querySelector("input").focus();
    } else if (b.dataset.bill === "sub-del") {
      b.closest("[data-sub]").remove();
    } else if (b.dataset.bill === "wg-add") {
      const rows = [...form.querySelectorAll("[data-wg]")];
      const maxBis = rows.reduce((m, r) => Math.max(m, parseArtNr(r.querySelector('[data-v="bis"]').value) || 0), 0);
      const von = maxBis ? maxBis + 1 : 100001;
      const code = String.fromCharCode(65 + Math.min(rows.length, 25));
      form.querySelector("[data-wg-rows]").insertAdjacentHTML("beforeend", groupRow({ id: uid(), code, name: "", von, bis: von + 99, unterkategorien: [] }, true).toString());
      form.querySelector("[data-wg-empty]").hidden = true;
      form.querySelector("[data-wg-rows]").lastElementChild.querySelector('[data-v="name"]').focus();
    } else if (b.dataset.bill === "bk-add") {
      form.querySelector("[data-bk-rows]").insertAdjacentHTML("beforeend", bankRow({ id: uid(), bank: "", iban: "", bic: "", qrIban: "", waehrung: DEFAULT_CURRENCY }, true).toString());
      form.querySelector("[data-bk-empty]").hidden = true;
      form.querySelector("[data-bk-rows]").lastElementChild.querySelector('[data-v="bank"]').focus();
    } else if (b.dataset.bill === "bk-del") {
      b.closest("[data-bk]").remove();
      form.querySelector("[data-bk-empty]").hidden = form.querySelectorAll("[data-bk]").length > 0;
    } else if (b.dataset.bill === "wg-del") {
      b.closest("[data-wg]").remove();
      form.querySelector("[data-wg-empty]").hidden = form.querySelectorAll("[data-wg]").length > 0;
    }
  });
  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-bill-form]");
    if (!form) return;
    e.preventDefault();
    ({ groups: saveGroups, firma: saveFirm, terms: saveTerms, banks: saveBanks, docs: saveDocs })[form.dataset.billForm](form);
  });
}
