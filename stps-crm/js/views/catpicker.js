// Kategorien-Auswahl für Kunden- und Lieferantenformular (Feldtyp «widget» in ui.js openForm): der gemeinsame Kategorienbaum
// (Warengruppe → Unterkategorie) als Mehrfachauswahl, dazu «Neue Kategorie» direkt im Formular (nur wer die Warengruppen ändern darf).
import { html } from "../util.js";
import { icon, toast } from "../ui.js";
import { t } from "../i18n.js";
import { subsOf, kategorienOf, addCategory, canEditCategories } from "../categories.js";
import * as store from "../store.js";

/** Feldobjekt für openForm: { key: "kategorien", type: "widget", label, full, widget } */
export function categoriesField(label) {
  let el = null, ctx = null, selected = new Set();

  const treeHtml = () => {
    const gs = store.getBilling().warengruppen || [];
    if (!gs.length) return html`<p class="muted">${t("cat.none")}</p>`;
    return html`<div class="cat-tree">${gs.map((g) => html`<div class="cat-group">
      <label class="check cat-g"><input type="checkbox" data-cat="${g.id}" ${selected.has(g.id) ? "checked" : ""}> <span>${[g.code, g.name].filter(Boolean).join(" · ")}</span></label>
      ${subsOf(g).length ? html`<div class="cat-subs">${subsOf(g).map((s) => html`<label class="check cat-s"><input type="checkbox" data-cat="${s.id}" ${selected.has(s.id) ? "checked" : ""}> <span>${s.name}</span></label>`)}</div>` : ""}
    </div>`)}</div>`;
  };

  const addHtml = () => canEditCategories()
    ? html`<div class="cat-add" data-cat-add>
        <input type="text" data-cat-name autocomplete="off" aria-label="${t("cat.newName")}" placeholder="${t("cat.newName")}">
        <select data-cat-parent aria-label="${t("cat.newParent")}"><option value="">${t("cat.newMain")}</option>${(store.getBilling().warengruppen || []).map((g) => html`<option value="${g.id}">${t("cat.newSubOf", { name: g.name || g.code })}</option>`)}</select>
        <button type="button" class="btn btn-sm" data-cat-do>${icon("plus")} ${t("cat.add")}</button>
      </div>`
    : html`<p class="help">${t("cat.adminOnly")}</p>`;

  const paint = () => {
    const keepParent = el.querySelector("[data-cat-parent]")?.value || "";
    el.innerHTML = html`${treeHtml()}${addHtml()}<div class="help">${t("cat.help")}</div>`.toString();
    const p = el.querySelector("[data-cat-parent]");
    if (p) p.value = keepParent;
  };

  const widget = {
    mount(host, vals, c) {
      el = host; ctx = c;
      selected = new Set(kategorienOf(vals));
      paint();
      el.addEventListener("change", (e) => {
        const cb = e.target.closest("[data-cat]");
        if (!cb) return;
        if (cb.checked) selected.add(cb.dataset.cat); else selected.delete(cb.dataset.cat);
        ctx.changed();
      });
      const add = () => {
        const input = el.querySelector("[data-cat-name]");
        const res = addCategory(input.value, el.querySelector("[data-cat-parent]").value);
        if (!res) { input.focus(); return; }
        selected.add(res.id);
        ctx.changed();
        paint();
        toast(t(res.created ? "cat.created" : "cat.existed"), { type: res.created ? "ok" : "info" });
        el.querySelector("[data-cat-name]")?.focus();
      };
      el.addEventListener("click", (e) => { if (e.target.closest("[data-cat-do]")) add(); });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-cat-name]")) { e.preventDefault(); add(); }
      });
    },
    read: () => ({ value: kategorienOf({ kategorien: [...selected] }), error: "" }),
  };
  return { key: "kategorien", type: "widget", label, full: true, widget };
}
