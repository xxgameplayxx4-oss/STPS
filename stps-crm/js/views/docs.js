// Gemeinsame Bausteine für Offerten und Rechnungen: Einstellungen, Summen, Positionstabelle, Statusanzeige.
import { html, fmtNum, todayISO } from "../util.js";
import { getBilling } from "../store.js";
import { fmtArtNr, docTotals, lineTotal, invoiceStatus, docCurrency, vatByCountry } from "../billing.js";
import { RECHNUNGSSTATUS, OVERDUE } from "../config.js";
import { t, tv } from "../i18n.js";

export const INVOICE_STATUS = RECHNUNGSSTATUS;
const TONE = { Entwurf: "grey", Gesendet: "blue", [OVERDUE]: "red", Bezahlt: "green", Storniert: "grey" };

/** Abrechnungs-Einstellungen des Teams (settings.billing), immer vollständig */
export const billingSettings = () => getBilling();

/** Beleg-Optionen (MWST) eines Angebots oder einer Rechnung */
export const vatOpts = (doc) => ({ mwstAktiv: Boolean(doc?.mwstAktiv), mwstSatz: Number(doc?.mwstSatz) || 0 });
export const totalsOf = (doc) => docTotals(doc?.positions || [], vatOpts(doc));

export const n2 = (v) => fmtNum(v, 2);
export const chf2 = (v) => `CHF ${fmtNum(v, 2)}`;
/** Betrag mit Währung des Belegs (CHF/EUR/USD): money2(v, "EUR") → «EUR 1’234.50» */
export const money2 = (v, cur = "CHF") => `${cur} ${fmtNum(v, 2)}`;
/** Betrag in der Währung eines Belegs */
export const docMoney = (doc) => (v) => money2(v, docCurrency(doc));
/** Summen je Währung als Text («CHF 100.00 · EUR 50.00»); nur Währungen mit Betrag */
export function sumsByCurrency(rows, amountOf) {
  const m = new Map();
  for (const r of rows) m.set(docCurrency(r), (m.get(docCurrency(r)) || 0) + amountOf(r));
  return [...m].filter(([, v]) => v).map(([c, v]) => money2(v, c)).join(" · ");
}
/** MWST-Vorgabe aus dem Land des Kunden: true = Inland (mit MWST), false = Ausland (Export, 0 %), null = unbekannt */
export const vatForCustomer = (customer) => vatByCountry(customer?.land);
export const qty = (v) => fmtNum(v);

/** Angezeigter Status einer Rechnung (inkl. abgeleitetem «Überfällig») */
export const statusOf = (inv, today = todayISO()) => invoiceStatus(inv, today);

export const invBadge = (status) => (status ? html`<span class="badge t-${TONE[status] || "grey"}">${tv("invStatus", status)}</span>` : "");

/**
 * Positionstabelle (Detailansicht und Druck): Pos / Artikelnr. / Bezeichnung / Menge / Einheit / Brutto / Rabatt % / Netto / Total.
 * Enthält nie Einkaufspreise: Positionen tragen keinen EK.
 */
export function positionsTable(positions, cls = "") {
  const list = positions || [];
  if (!list.length) return html`<p class="muted pad">${t("pos.none")}</p>`;
  return html`<div class="table-wrap"><table class="tbl pos-tbl ${cls}">
    <thead><tr><th class="num">${t("pos.col.pos")}</th><th>${t("pos.col.artNr")}</th><th>${t("pos.col.bezeichnung")}</th><th class="num">${t("pos.col.menge")}</th><th>${t("pos.col.einheit")}</th><th class="num">${t("pos.col.brutto")}</th><th class="num">${t("pos.col.rabatt")}</th><th class="num">${t("pos.col.netto")}</th><th class="num">${t("pos.col.total")}</th></tr></thead>
    <tbody>${list.map((p, i) => html`<tr>
      <td class="num" data-label="${t("pos.col.pos")}">${i + 1}</td>
      <td data-label="${t("pos.col.artNr")}" class="nowrap">${p.artNr ? fmtArtNr(p.artNr) : ""}</td>
      <td data-label="${t("pos.col.bezeichnung")}" class="c-first">${p.bezeichnung}</td>
      <td class="num" data-label="${t("pos.col.menge")}">${qty(p.menge)}</td>
      <td data-label="${t("pos.col.einheit")}">${p.einheit || ""}</td>
      <td class="num" data-label="${t("pos.col.brutto")}">${n2(p.brutto)}</td>
      <td class="num" data-label="${t("pos.col.rabatt")}">${Number(p.rabatt) ? `${fmtNum(p.rabatt, Number.isInteger(+p.rabatt) ? 0 : 1)} %` : ""}</td>
      <td class="num" data-label="${t("pos.col.netto")}">${n2(p.netto)}</td>
      <td class="num" data-label="${t("pos.col.total")}">${n2(lineTotal(p).netto)}</td></tr>`)}</tbody></table></div>`;
}

/** Summenblock: Brutto, Rabatt, Netto, MWST, Total */
export function totalsBlock(doc, cls = "") {
  const tot = totalsOf(doc);
  const chf2 = docMoney(doc);
  const row = (label, value, strong = false) => html`<tr class="${strong ? "strong" : ""}"><th scope="row">${label}</th><td class="num">${value}</td></tr>`;
  return html`<table class="totals ${cls}"><tbody>
    ${row(t("pos.tot.brutto"), chf2(tot.brutto))}
    ${tot.rabatt ? row(t("pos.tot.rabatt"), `– ${chf2(tot.rabatt)}`) : ""}
    ${row(t("pos.tot.netto"), chf2(tot.netto), !doc?.mwstAktiv)}
    ${doc?.mwstAktiv ? row(t("pos.tot.mwst", { satz: fmtNum(doc.mwstSatz, Number.isInteger(+doc.mwstSatz) ? 0 : 1) }), chf2(tot.mwst)) : ""}
    ${doc?.mwstAktiv ? row(t("pos.tot.total"), chf2(tot.total), true) : ""}
  </tbody></table>`;
}
