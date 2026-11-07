// Einstellungen «Produktkategorien importieren»: CSV-Matrix (Hauptkategorie, Unterkategorie, optional Code) mit Vorschau in den bestehenden Baum einlesen.
// Logik (Parsen, Zusammenführen) in js/catimport.js. Team-Admins (im Lokalen Modus alle) übernehmen; Mitglieder sehen die Karte nicht.
import * as store from "../store.js";
import { html } from "../util.js";
import { t } from "../i18n.js";
import { icon, toast } from "../ui.js";
import { downloadFile } from "../csv.js";
import { parseMatrix, planMerge, applyMerge, templateCsv } from "../catimport.js";
import { canEditCategories } from "../categories.js";

const MAX_PREVIEW = 300;
let pending = null; // { rows } der zuletzt eingelesenen Datei

export function cardHtml() {
  if (!canEditCategories()) return "";
  return html`<section class="card span-all" data-cat-import>
    <div class="card-head"><h2>${t("cat.imp.title")}</h2></div>
    <div class="pad stack">
      <p class="help">${t("cat.imp.help")}</p>
      <div class="btn-row wrap">
        <button type="button" class="btn" data-cat="template">${icon("download")} ${t("cat.imp.template")}</button>
        <label class="btn">${icon("upload")} ${t("cat.imp.choose")}<input type="file" accept=".csv,.txt,text/csv,text/plain" data-cat="file" class="sr"></label>
      </div>
      <div data-cat-preview aria-live="polite"></div>
    </div>
  </section>`;
}

/** Datei als Text lesen: UTF-8, sonst Windows-1252 (Excel «CSV (Trennzeichen-getrennt)») */
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

const tag = (st, kind) => (st === "new" ? html`<span class="badge t-green">${kind}: ${t("cat.imp.new")}</span>` : st === "existing" ? html`<span class="badge t-grey">${kind}: ${t("cat.imp.existing")}</span>` : st === "dup" ? html`<span class="badge t-grey">${kind}: ${t("cat.imp.dup")}</span>` : "");

function previewHtml(parsed, plan) {
  const err = (e) => html`<li>${t(e.key, e.params)}</li>`;
  if (!parsed.rows.length) return html`<p class="err-text" role="alert">${parsed.errors.map((e) => t(e.key, e.params)).join(" ")}</p>`;
  const nothing = !plan.newMain && !plan.newSub;
  return html`<div class="cat-prev">
    <p><strong>${t("cat.imp.summary", { rows: parsed.rows.length, main: plan.newMain, sub: plan.newSub, existing: plan.existing })}</strong>${nothing ? html` <span class="muted">${t("cat.imp.nothing")}</span>` : ""}</p>
    ${parsed.errors.length ? html`<div class="err-text" role="alert"><p>${t("cat.imp.skipped", { n: parsed.errors.length })}</p><ul>${parsed.errors.slice(0, 10).map(err)}</ul></div>` : ""}
    ${plan.warnings.length ? html`<ul class="cat-warn">${plan.warnings.slice(0, 10).map(err)}</ul>` : ""}
    <div class="table-wrap"><table class="tbl mini"><thead><tr><th>${t("cat.imp.colMain")}</th><th>${t("cat.imp.colSub")}</th><th>${t("cat.imp.colCode")}</th><th>${t("cat.imp.colStatus")}</th></tr></thead>
      <tbody>${plan.items.slice(0, MAX_PREVIEW).map((i) => html`<tr><td class="c-first">${i.haupt}</td><td>${i.unter || ""}</td><td>${i.code || ""}</td><td class="cat-tags">${tag(i.main, t("cat.imp.tagMain"))}${i.unter ? html` ${tag(i.sub, t("cat.imp.tagSub"))}` : ""}</td></tr>`)}</tbody></table></div>
    ${plan.items.length > MAX_PREVIEW ? html`<p class="muted">${t("cat.imp.more", { n: plan.items.length - MAX_PREVIEW })}</p>` : ""}
    <div class="btn-row wrap"><button type="button" class="btn btn-primary" data-cat="apply" ${nothing ? "disabled" : ""}>${icon("check")} ${t("cat.imp.apply", { main: plan.newMain, sub: plan.newSub })}</button>
      <button type="button" class="btn btn-ghost" data-cat="cancel">${t("common.cancel")}</button></div>
  </div>`;
}

export function bind(root) {
  const host = root.querySelector("[data-cat-import]");
  if (!host) return;
  const out = host.querySelector("[data-cat-preview]");
  const show = (parsed) => {
    const plan = planMerge(store.getBilling().warengruppen, parsed.rows);
    pending = parsed.rows.length ? { rows: parsed.rows } : null;
    out.innerHTML = previewHtml(parsed, plan).toString();
  };
  host.addEventListener("change", async (e) => {
    if (!e.target.matches('[data-cat="file"]')) return;
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { pending = null; out.innerHTML = html`<p class="err-text" role="alert">${t("cat.imp.xlsx")}</p>`.toString(); return; }
    try { show(parseMatrix(await readText(f))); } catch (err) { pending = null; out.innerHTML = html`<p class="err-text" role="alert">${t("cat.imp.err.read")}</p>`.toString(); console.error(err); }
  });
  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    if (b.dataset.cat === "template") downloadFile("kategorien-vorlage.csv", templateCsv(), "text/csv;charset=utf-8", true);
    else if (b.dataset.cat === "cancel") { pending = null; out.innerHTML = ""; }
    else if (b.dataset.cat === "apply" && pending) {
      const before = store.getBilling().warengruppen;
      const plan = planMerge(before, pending.rows);
      store.setBilling({ warengruppen: applyMerge(before, pending.rows) });
      pending = null;
      out.innerHTML = html`<p class="ok-text" role="status">${t("cat.imp.done", { main: plan.newMain, sub: plan.newSub })}</p>`.toString();
      toast(t("cat.imp.done", { main: plan.newMain, sub: plan.newSub }), { type: "ok" });
    }
  });
}
