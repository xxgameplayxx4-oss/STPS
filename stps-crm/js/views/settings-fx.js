// Einstellungen «Wechselkurse»: Kurse für die Mehrwährungs-Anzeige (Basis CHF; EUR und USD, mit Datum «Kurse vom»).
// «Automatisch» (Standard auf dem Server): täglich von der EZB, Felder schreibgeschützt, Button «Jetzt aktualisieren» (POST /api/fx/refresh).
// «Manuell»: handgepflegte Werte, werden nie überschrieben. Im Lokalen Modus (ohne Server) gibt es nur «Manuell».
// Team-Admins ändern (im Lokalen Modus jede Person), Mitglieder sehen die Kurse nur. Gespeichert in db.settings.fx.
import * as store from "../store.js";
import { html, todayISO, fmtNum, fmtDate, fmtDateTime } from "../util.js";
import { t } from "../i18n.js";
import { toast, icon } from "../ui.js";
import { convert, fxMode } from "../fx.js";
import * as api from "../api.js";

const canEdit = () => store.S.mode === "local" || store.isTeamAdmin();

const server = () => store.S.mode === "server";
const isAuto = (fx) => server() && fxMode(fx) === "auto";
let failedNow = false; // Abruf in dieser Sitzung gescheitert (auch wenn der Fehlervermerk noch nicht synchronisiert ist)
const failed = (fx) => failedNow || Boolean(fx.failedAt && (!fx.fetchedAt || Date.parse(fx.failedAt) > Date.parse(fx.fetchedAt)));

const rateField = (cur, v, edit, auto) => html`<div class="field">
  <label for="fx-${cur}">${t("fx.rateLabel", { cur })}</label>
  <input type="text" id="fx-${cur}" name="${cur}" inputmode="decimal" autocomplete="off" value="${v}" ${edit && !auto ? "" : "readonly"}>
  <div class="err" role="alert"></div></div>`;

const modeSwitch = (auto) => html`<div class="seg" role="group" aria-label="${t("fx.mode")}">
  <button type="button" class="seg-btn" data-fx-mode="auto" aria-pressed="${auto ? "true" : "false"}">${t("fx.auto")}</button>
  <button type="button" class="seg-btn" data-fx-mode="manual" aria-pressed="${auto ? "false" : "true"}">${t("fx.manual")}</button></div>`;

export function cardHtml() {
  const fx = store.getFx();
  const edit = canEdit();
  const auto = isAuto(fx);
  return html`<section class="card" data-fx-card>
    <div class="card-head"><h2>${t("fx.title")}</h2></div>
    <form class="list-ed pad" data-fx-form novalidate>
      <p class="help">${t("fx.help")}</p>
      ${server() && edit ? html`<div class="fx-mode">${modeSwitch(auto)}</div>` : ""}
      <div class="field-row">
        ${rateField("EUR", fx.EUR, edit, auto)}
        ${rateField("USD", fx.USD, edit, auto)}
        <div class="field"><label for="fx-date">${t("fx.date")}</label><input type="date" id="fx-date" name="date" value="${fx.date}" ${edit && !auto ? "" : "disabled"}><div class="err" role="alert"></div></div>
      </div>
      <p class="help" data-fx-example>${example(fx)}</p>
      ${auto ? html`<div class="fx-meta">
        <p class="help" data-fx-source>${fx.date ? t("fx.ratesFrom", { date: fmtDate(fx.date) }) : t("fx.noRates")} · ${t("fx.source", { source: fx.source || t("fx.sourceDefault") })}${fx.fetchedAt ? html` · ${t("fx.fetchedAt", { at: fmtDateTime(fx.fetchedAt) })}` : ""}</p>
        ${failed(fx) ? html`<p class="help fx-fail" role="status" data-fx-fail>${icon("alert")} ${fx.date ? t("fx.failed", { date: fmtDate(fx.date) }) : t("fx.failedNoDate")}</p>` : ""}
        ${edit ? html`<div class="le-actions"><button type="button" class="btn btn-sm" data-fx-refresh>${icon("repeat")} ${t("fx.refresh")}</button></div>` : ""}
      </div>` : edit ? html`<div class="le-actions"><span class="spacer"></span><button type="submit" class="btn btn-sm btn-primary">${t("common.save")}</button></div>` : html`<p class="help">${t("billing.readOnly")}</p>`}
      <div class="err" role="alert" data-fx-err></div>
    </form>
  </section>`;
}

const example = (fx) => t("fx.example", { eur: fmtNum(convert(1000, "CHF", "EUR", fx), 0), usd: fmtNum(convert(1000, "CHF", "USD", fx), 0) });
const parseRate = (s) => { const n = Number(String(s).trim().replace(",", ".")); return Number.isFinite(n) && n > 0 && n < 1000 ? n : NaN; };

/** Karte neu zeichnen (nach Moduswechsel oder Abruf) */
function rerender(root) {
  const card = root.querySelector("[data-fx-card]");
  if (!card) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = cardHtml().toString();
  card.replaceWith(tpl.content.firstElementChild);
  bind(root);
}

/** Kurse jetzt von der EZB holen. Bei Fehler bleiben die letzten Kurse bestehen. */
async function refreshNow(root, btn) {
  if (btn) btn.disabled = true;
  try {
    await store.flushNow(); // eigene Änderungen (z. B. Moduswechsel) zuerst speichern, damit der Server den aktuellen Modus kennt
    let r = await api.refreshFx();
    if (r.status === "nodb") { store.setFx({ mode: "auto" }); await store.flushNow(); r = await api.refreshFx(); } // noch keine Daten auf dem Server
    if (r.ok) {
      failedNow = false;
      await store.refresh();
      if (store.getFx().fetchedAt !== r.fx?.fetchedAt) store.setFx(r.fx); // eigene ungespeicherte Änderungen: Kurse lokal übernehmen
      toast(t("fx.updated"), { type: "ok" });
    } else if (r.status === "manual") {
      await store.refresh();
    } else {
      throw new Error(r.status);
    }
  } catch {
    failedNow = true;
    await store.refresh();
    toast(t("fx.failed", { date: store.getFx().date ? fmtDate(store.getFx().date) : "–" }), { type: "error" });
  }
  rerender(root);
}

export function bind(root) {
  const form = root.querySelector("[data-fx-form]");
  if (!form || !canEdit()) return;
  form.querySelectorAll("[data-fx-mode]").forEach((b) => b.addEventListener("click", async () => {
    const auto = b.dataset.fxMode === "auto";
    if (auto === isAuto(store.getFx())) return;
    store.setFx({ mode: auto ? "auto" : "manual", ...(auto ? {} : { source: undefined, fetchedAt: undefined, failedAt: undefined }) });
    failedNow = false;
    rerender(root);
    if (auto) await refreshNow(root, null);
  }));
  form.querySelector("[data-fx-refresh]")?.addEventListener("click", (e) => refreshNow(root, e.currentTarget));
  if (isAuto(store.getFx())) { form.addEventListener("submit", (e) => e.preventDefault()); return; }
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
    store.setFx({ ...r, date: form.date.value || todayISO(), mode: "manual" });
    toast(t("fx.saved"), { type: "ok" });
  });
}
