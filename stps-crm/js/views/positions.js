// Positionen-Editor (Angebote und Rechnungen): Artikel suchen und hinzufügen oder freie Zeile; Menge, Einheit, Brutto, Rabatt %, Netto
// (Brutto/Rabatt/Netto rechnen sich gegenseitig), Zeilensumme, Summen und MWST. Wird als Feldtyp «widget» in ui.js openForm eingebunden.
// Positionen enthalten nie den Einkaufspreis (EK): Beim Hinzufügen werden nur Bezeichnung, Einheit, Brutto, Rabatt und Netto übernommen.
import { all } from "../store.js";
import { html, uid, fmtNum, parseAmount, str } from "../util.js";
import { icon } from "../ui.js";
import { positionsFromDeal, fmtArtNr, parseArtNr, nettoFrom, rabattFrom, lineTotal, docTotals } from "../billing.js";
import { billingSettings, money2, n2 } from "./docs.js";
import { docCurrency } from "../billing.js";
import { t } from "../i18n.js";

const MAX_RESULTS = 8;
const numOrNull = (raw) => { const n = parseAmount(raw); return n === null || Number.isNaN(n) ? null : n; };
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Position aus einem Artikel (Snapshot; später geänderte Artikelpreise ändern bestehende Belege nicht) */
export function positionFromArticle(a) {
  const brutto = Number(a.brutto) || 0;
  const rabatt = Number(a.rabatt) || 0;
  return {
    id: uid(), articleId: a.id, artNr: a.nr ?? null, bezeichnung: a.bezeichnung || "", menge: 1, einheit: a.einheit || "",
    brutto, rabatt, netto: a.netto !== undefined && a.netto !== null && a.netto !== "" ? Number(a.netto) : nettoFrom(brutto, rabatt),
  };
}

const blankPosition = () => ({ id: uid(), articleId: null, artNr: null, bezeichnung: "", menge: 1, einheit: "", brutto: 0, rabatt: 0, netto: 0 });

/**
 * Feldobjekt für openForm: { key, type: "widget", label, full, widget }.
 * Wert der Form: { positions, mwstAktiv, mwstSatz } (der Aufrufer packt das beim Speichern in den Datensatz).
 * opts.vatDefault: MWST bei neuen Belegen vorbelegt (Rechnungen: ja, Angebote: nein)
 * opts.vatAuto: { isNew, forCustomer(customerId) → true (Inland, MWST) | false (Ausland, 0 %) | null (unbekannt) }: bei NEUEN Belegen folgt die MWST dem
 *   Land des gewählten Kunden, solange sie nicht von Hand umgestellt wurde (Haken «MWST berechnen» bleibt frei überschreibbar).
 * opts.fromDeal(dealId) → Angebot | null: Wird im Formular ein Angebot gewählt, werden dessen Positionen (und Währung/MWST) übernommen,
 *   aber nur solange der Benutzer noch keine eigenen Positionen erfasst hat.
 * Die Währung der Summen kommt aus dem Formularfeld «waehrung» (falls vorhanden), sonst CHF.
 */
export function positionsField(opts = {}) {
  let el = null, ctx = null, state = null, form = null, vatTouched = false;
  const chf2 = (v) => money2(v, docCurrency({ waehrung: form?.querySelector('[name="waehrung"]')?.value }));
  const setVat = (on) => {
    state.mwstAktiv = on;
    const box = el.querySelector("[data-pos-vat]"), rate = el.querySelector("[data-pos-rate]");
    if (box) box.checked = on;
    if (rate) rate.disabled = !on;
    paintTotals();
  };

  const fieldOf = (id) => state.positions.find((p) => p.id === id);
  const vat = () => ({ mwstAktiv: state.mwstAktiv, mwstSatz: state.mwstSatz });

  function rowHtml(p, i) {
    const inp = (key, label, val, extra = "") => html`<label class="pf"><span>${label}</span><input type="text" data-p="${key}" inputmode="${key === "einheit" ? "text" : "decimal"}" autocomplete="off" value="${val}" ${extra}></label>`;
    return html`<fieldset class="pos-row" data-pos="${p.id}">
      <div class="pos-top">
        <span class="pos-n">${i + 1}</span>
        <span class="pos-art ${p.artNr ? "" : "free"}" title="${p.artNr ? t("pos.fromArticle") : t("pos.freeLine")}">${p.artNr ? fmtArtNr(p.artNr) : t("pos.free")}</span>
        <label class="pf pos-name"><span class="sr">${t("pos.col.bezeichnung")}</span><input type="text" data-p="bezeichnung" autocomplete="off" placeholder="${t("pos.col.bezeichnung")}" value="${p.bezeichnung}"></label>
        <button type="button" class="icon-btn" data-pos-del aria-label="${t("pos.remove", { n: i + 1 })}" title="${t("common.remove")}">${icon("trash")}</button>
      </div>
      <div class="pos-nums">
        ${inp("menge", t("pos.col.menge"), fmtNum(p.menge))}
        ${inp("einheit", t("pos.col.einheit"), p.einheit || "")}
        ${inp("brutto", t("pos.col.brutto"), n2(p.brutto))}
        ${inp("rabatt", t("pos.col.rabatt"), p.rabatt ? String(p.rabatt) : "")}
        ${inp("netto", t("pos.col.netto"), n2(p.netto))}
        <div class="pf pos-sum"><span>${t("pos.col.total")}</span><strong data-line-total>${n2(lineTotal(p).netto)}</strong></div>
      </div>
    </fieldset>`;
  }

  function totalsHtml() {
    const tot = docTotals(state.positions, vat());
    const row = (label, v, strong = false) => html`<div class="pt-row ${strong ? "strong" : ""}"><span>${label}</span><span>${v}</span></div>`;
    return html`${row(t("pos.tot.brutto"), chf2(tot.brutto))}${tot.rabatt ? row(t("pos.tot.rabatt"), `– ${chf2(tot.rabatt)}`) : ""}${row(t("pos.tot.netto"), chf2(tot.netto), !state.mwstAktiv)}${state.mwstAktiv ? html`${row(t("pos.tot.mwst", { satz: fmtNum(state.mwstSatz, Number.isInteger(+state.mwstSatz) ? 0 : 1) }), chf2(tot.mwst))}${row(t("pos.tot.total"), chf2(tot.total), true)}` : ""}`;
  }

  function paintTotals() {
    el.querySelector("[data-pos-totals]").innerHTML = totalsHtml().toString();
    const tot = docTotals(state.positions, vat());
    ctx.onTotals?.(tot, state.positions.length);
  }

  function paintRows() {
    el.querySelector("[data-pos-rows]").innerHTML = state.positions.length
      ? state.positions.map(rowHtml).map(str).join("")
      : html`<p class="muted pos-empty">${t("pos.empty")}</p>`.toString();
    paintTotals();
  }

  function paintAll() {
    el.innerHTML = html`<div class="pos-ed">
      <div class="pos-add">
        <div class="pos-search">
          <label class="sr" for="${ctx.id}-search">${t("pos.searchLabel")}</label>
          <input type="search" id="${ctx.id}-search" data-pos-search autocomplete="off" placeholder="${t("pos.searchPh")}" role="combobox" aria-expanded="false" aria-controls="${ctx.id}-res">
          <ul class="pos-results" id="${ctx.id}-res" role="listbox" data-pos-results hidden></ul>
        </div>
        <button type="button" class="btn btn-sm" data-pos-free>${icon("plus")} ${t("pos.addFree")}</button>
      </div>
      <div class="pos-rows" data-pos-rows></div>
      <div class="pos-foot">
        <div class="pos-vat">
          <label class="check"><input type="checkbox" data-pos-vat ${state.mwstAktiv ? "checked" : ""}> ${t("pos.vatOn")}</label>
          <label class="pf pos-rate"><span>${t("pos.vatRate")}</span><input type="text" data-pos-rate inputmode="decimal" autocomplete="off" value="${fmtNum(state.mwstSatz, Number.isInteger(+state.mwstSatz) ? 0 : 1)}" ${state.mwstAktiv ? "" : "disabled"}></label>
        </div>
        <div class="pos-totals" data-pos-totals></div>
      </div>
    </div>`.toString();
    paintRows();
  }

  // ---- Artikelsuche
  function matches(q) {
    const arts = all("articles") || [];
    const cust = form?.querySelector('[name="customerId"]')?.value || "";
    const needle = q.trim().toLowerCase();
    const nrNeedle = parseArtNr(q);
    const hit = (a) => !needle || (a.bezeichnung || "").toLowerCase().includes(needle) || fmtArtNr(a.nr).includes(needle) || String(a.nr).includes(needle.replace(/[.'\s]/g, "")) || (nrNeedle !== null && String(a.nr).startsWith(String(nrNeedle))) || (a.lieferantenArtNr || "").toLowerCase().includes(needle);
    return arts.filter(hit)
      .sort((a, b) => Number(b.customerId === cust && Boolean(cust)) - Number(a.customerId === cust && Boolean(cust)) || (a.nr || 0) - (b.nr || 0))
      .slice(0, MAX_RESULTS);
  }

  function showResults() {
    const input = el.querySelector("[data-pos-search]");
    const ul = el.querySelector("[data-pos-results]");
    const list = matches(input.value);
    const has = (all("articles") || []).length > 0;
    ul.innerHTML = list.length
      ? list.map((a) => html`<li role="option"><button type="button" data-pos-pick="${a.id}"><span class="r-nr">${fmtArtNr(a.nr)}</span><span class="r-name">${a.bezeichnung}</span><span class="r-price">${n2(a.netto)}${a.einheit ? html` <small>/ ${a.einheit}</small>` : ""}</span></button></li>`).map(str).join("")
      : html`<li class="r-none">${has ? t("pos.noMatch") : t("pos.noArticles")}</li>`.toString();
    ul.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function hideResults() {
    const ul = el.querySelector("[data-pos-results]");
    if (!ul) return;
    ul.hidden = true;
    el.querySelector("[data-pos-search]")?.setAttribute("aria-expanded", "false");
  }

  function addPosition(p) {
    state.positions.push(p);
    ctx.changed();
    paintRows();
    el.querySelector("[data-pos-search]").value = "";
    hideResults();
    const row = el.querySelector(`[data-pos="${p.id}"]`);
    row?.querySelector(p.articleId ? '[data-p="menge"]' : '[data-p="bezeichnung"]')?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }

  // ---- Eingaben in den Zeilen
  function onRowInput(input) {
    const row = input.closest("[data-pos]");
    const p = fieldOf(row.dataset.pos);
    if (!p) return;
    const key = input.dataset.p;
    const set = (k, v) => {
      const e = row.querySelector(`[data-p="${k}"]`);
      if (e && e !== document.activeElement) e.value = v;
    };
    switch (key) {
      case "bezeichnung": p.bezeichnung = input.value; break;
      case "einheit": p.einheit = input.value; break;
      case "menge": p.menge = numOrNull(input.value) ?? 0; break;
      case "brutto":
        p.brutto = numOrNull(input.value) ?? 0;
        p.netto = nettoFrom(p.brutto, p.rabatt);
        set("netto", n2(p.netto));
        break;
      case "rabatt":
        p.rabatt = Math.min(100, Math.max(0, numOrNull(input.value) ?? 0));
        p.netto = nettoFrom(p.brutto, p.rabatt);
        set("netto", n2(p.netto));
        break;
      case "netto":
        p.netto = numOrNull(input.value) ?? 0;
        p.rabatt = Math.max(0, rabattFrom(p.brutto, p.netto));
        set("rabatt", p.rabatt ? String(p.rabatt) : "");
        break;
    }
    row.querySelector("[data-line-total]").textContent = n2(lineTotal(p).netto);
    paintTotals();
  }

  function onFocusOut(input) {
    const p = fieldOf(input.closest("[data-pos]")?.dataset.pos);
    if (!p) return;
    const key = input.dataset.p;
    if (key === "menge") input.value = fmtNum(p.menge);
    else if (key === "brutto" || key === "netto") input.value = n2(p[key]);
    else if (key === "rabatt") input.value = p.rabatt ? String(round2(p.rabatt)) : "";
  }

  const widget = {
    mount(host, vals, c) {
      el = host; ctx = { ...c, id: `pw${uid().slice(0, 6)}`, onTotals: (tot, n) => opts.onTotals?.(tot, n, c) }; form = c.form; vatTouched = false;
      const b = billingSettings();
      state = {
        positions: (Array.isArray(vals.positions) ? vals.positions : []).map((p) => ({ ...p, id: p.id || uid() })),
        mwstAktiv: vals.mwstAktiv === undefined || vals.mwstAktiv === null ? Boolean(opts.vatDefault) : Boolean(vals.mwstAktiv),
        mwstSatz: Number(vals.mwstSatz) > 0 ? Number(vals.mwstSatz) : b.mwstSatz,
      };
      if (opts.vatAuto?.isNew) {
        const auto = opts.vatAuto.forCustomer(vals.customerId);
        if (auto !== null && auto !== undefined) state.mwstAktiv = auto;
      }
      paintAll();
      if (opts.vatAuto?.isNew) {
        // Kunde gewählt/gewechselt: MWST nach Land, ausser sie wurde von Hand umgestellt
        form.addEventListener("change", (e) => {
          if (!e.target.matches('[name="customerId"]') || vatTouched) return;
          const auto = opts.vatAuto.forCustomer(e.target.value);
          if (auto !== null && auto !== undefined) setVat(auto);
        });
      }
      form.addEventListener("change", (e) => { if (e.target.matches('[name="waehrung"]')) paintTotals(); });
      if (opts.fromDeal) {
        form.addEventListener("change", (e) => {
          if (!e.target.matches('[name="dealId"]') || !e.target.value) return;
          const d = opts.fromDeal(e.target.value);
          if (!d?.positions?.length) return;
          const typed = state.positions.some((p) => (p.bezeichnung || "").trim() || Number(p.brutto) || Number(p.netto));
          if (typed) return; // nichts überschreiben
          state.positions = positionsFromDeal(d).map((p) => ({ ...p, id: uid() }));
          if (d.mwstSatz > 0) state.mwstSatz = Number(d.mwstSatz);
          if (d.mwstAktiv !== undefined && d.mwstAktiv !== null) { vatTouched = true; setVat(Boolean(d.mwstAktiv)); }
          const cur = form.querySelector('[name="waehrung"]');
          if (cur && d.waehrung && [...cur.options].some((o) => o.value === d.waehrung) && cur.value !== d.waehrung) { cur.value = d.waehrung; cur.dispatchEvent(new Event("change", { bubbles: true })); }
          ctx.changed();
          paintRows();
        });
      }

      el.addEventListener("input", (e) => {
        const tgt = e.target;
        if (tgt.matches("[data-p]")) onRowInput(tgt);
        else if (tgt.matches("[data-pos-search]")) showResults();
        else if (tgt.matches("[data-pos-rate]")) { state.mwstSatz = numOrNull(tgt.value) ?? 0; paintTotals(); }
      });
      el.addEventListener("change", (e) => {
        if (e.target.matches("[data-pos-vat]")) {
          vatTouched = true;
          state.mwstAktiv = e.target.checked;
          el.querySelector("[data-pos-rate]").disabled = !state.mwstAktiv;
          paintTotals();
        }
      });
      el.addEventListener("focusout", (e) => {
        if (e.target.matches("[data-p]")) onFocusOut(e.target);
        if (!e.relatedTarget || !el.querySelector(".pos-search")?.contains(e.relatedTarget)) setTimeout(hideResults, 120);
      });
      el.addEventListener("focusin", (e) => { if (e.target.matches("[data-pos-search]")) showResults(); });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !el.querySelector("[data-pos-results]")?.hidden) { e.stopPropagation(); e.preventDefault(); hideResults(); return; }
        if (e.key !== "Enter" || !e.target.matches("input")) return;
        e.preventDefault(); // Enter soll das Formular nicht abschicken
        if (e.target.matches("[data-pos-search]")) {
          const first = matches(e.target.value)[0];
          if (first) addPosition(positionFromArticle(first));
        }
      });
      el.addEventListener("click", (e) => {
        const pick = e.target.closest("[data-pos-pick]");
        if (pick) {
          const a = (all("articles") || []).find((x) => x.id === pick.dataset.posPick);
          if (a) addPosition(positionFromArticle(a));
          return;
        }
        if (e.target.closest("[data-pos-free]")) { addPosition(blankPosition()); return; }
        const del = e.target.closest("[data-pos-del]");
        if (del) {
          const id = del.closest("[data-pos]").dataset.pos;
          state.positions = state.positions.filter((p) => p.id !== id);
          ctx.changed();
          paintRows();
          el.querySelector("[data-pos-search]").focus();
        }
      });
      ctx.onTotals?.(docTotals(state.positions, vat()), state.positions.length);
    },
    /** Wert für den Datensatz; leere Zeilen werden verworfen, unvollständige gemeldet */
    read() {
      const rows = state.positions.filter((p) => p.bezeichnung.trim() || Number(p.brutto) || Number(p.netto));
      for (const p of rows) {
        if (!p.bezeichnung.trim()) return { value: null, error: t("pos.err.name") };
        if (!(Number(p.menge) > 0)) return { value: null, error: t("pos.err.menge", { name: p.bezeichnung }) };
        if (Number(p.netto) < 0 || Number(p.brutto) < 0) return { value: null, error: t("pos.err.negative", { name: p.bezeichnung }) };
      }
      if (state.mwstAktiv && !(state.mwstSatz >= 0 && state.mwstSatz <= 100)) return { value: null, error: t("pos.err.rate") };
      const positions = rows.map((p) => ({
        id: p.id, articleId: p.articleId || null, artNr: p.artNr ?? null, bezeichnung: p.bezeichnung.trim(), menge: Number(p.menge),
        einheit: (p.einheit || "").trim(), brutto: round2(Number(p.brutto) || 0), rabatt: round2(Number(p.rabatt) || 0), netto: round2(Number(p.netto) || 0),
      }));
      return { value: { positions, mwstAktiv: state.mwstAktiv, mwstSatz: Number(state.mwstSatz) || 0 } };
    },
  };

  return { key: "positions", type: "widget", get label() { return t("pos.title"); }, full: true, widget };
}

/** Vom Formular gelieferten Wert { positions, mwstAktiv, mwstSatz } in Felder des Datensatzes übersetzen */
export function unpackPositions(v) {
  const p = v.positions;
  if (p && !Array.isArray(p)) {
    v.positions = p.positions;
    v.mwstAktiv = p.mwstAktiv;
    v.mwstSatz = p.mwstSatz;
  }
  return v;
}
