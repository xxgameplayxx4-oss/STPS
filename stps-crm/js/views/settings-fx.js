// Einstellungen «Wechselkurse»: Kurse für die Mehrwährungs-Anzeige (Basis CHF; EUR und USD manuell, mit Datum «Kurse vom»).
// Team-Admins ändern (im Lokalen Modus jede Person), Mitglieder sehen die Kurse nur. Gespeichert in db.settings.fx.
import * as store from "../store.js";
import { html, todayISO, fmtNum } from "../util.js";
import { t } from "../i18n.js";
import { toast } from "../ui.js";
import { convert } from "../fx.js";

const canEdit = () => store.S.mode === "local" || store.isTeamAdmin();

const rateField = (cur, v, edit) => html`<div class="field">
  <label for="fx-${cur}">${t("fx.rateLabel", { cur })}</label>
  <input type="text" id="fx-${cur}" name="${cur}" inputmode="decimal" autocomplete="off" value="${v}" ${edit ? "" : "disabled"}>
  <div class="err" role="alert"></div></div>`;

export function cardHtml() {
  const fx = store.getFx();
  const edit = canEdit();
  return html`<section class="card" data-fx-card>
    <div class="card-head"><h2>${t("fx.title")}</h2></div>
    <form class="list-ed pad" data-fx-form novalidate>
      <p class="help">${t("fx.help")}</p>
      <div class="field-row">
        ${rateField("EUR", fx.EUR, edit)}
        ${rateField("USD", fx.USD, edit)}
        <div class="field"><label for="fx-date">${t("fx.date")}</label><input type="date" id="fx-date" name="date" value="${fx.date}" ${edit ? "" : "disabled"}><div class="err" role="alert"></div></div>
      </div>
      <p class="help" data-fx-example>${example(fx)}</p>
      ${edit ? html`<div class="le-actions"><span class="spacer"></span><button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button></div>` : html`<p class="help">${t("billing.readOnly")}</p>`}
      <div class="err" role="alert" data-fx-err></div>
    </form>
  </section>`;
}

const example = (fx) => t("fx.example", { eur: fmtNum(convert(1000, "CHF", "EUR", fx), 0), usd: fmtNum(convert(1000, "CHF", "USD", fx), 0) });
const parseRate = (s) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) && n > 0 && n < 1000 ? n : NaN; };

export function bind(root) {
  const form = root.querySelector("[data-fx-form]");
  if (!form || !canEdit()) return;
  const read = () => ({ EUR: parseRate(form.EUR.value), USD: parseRate(form.USD.value) });
  form.addEventListener("input", () => {
    const r = read();
    if (Number.isFinite(r.EUR) && Number.isFinite(r.USD)) form.querySelector("[data-fx-example]").textContent = example({ ...r, date: "" });
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = read();
    let bad = false;
    for (const cur of ["EUR", "USD"]) {
      const f = form.querySelector(`[name="${cur}"]`).closest(".field");
      const invalid = !Number.isFinite(r[cur]);
      f.classList.toggle("invalid", invalid);
      f.querySelector(".err").textContent = invalid ? t("fx.err.rate") : "";
      bad ||= invalid;
    }
    form.querySelector("[data-fx-err]").textContent = bad ? t("val.checkFields") : "";
    if (bad) return;
    store.setFx({ ...r, date: form.date.value || todayISO() });
    toast(t("fx.saved"), { type: "ok" });
  });
}
