// Druckansicht (A4) für Offerte, Auftragsbestätigung, Pro-forma-Rechnung, Lieferschein (alle aus einem Angebot) und Rechnung:
// #/druck/offerte|auftragsbestaetigung|proforma|lieferschein/<Angebots-ID>, #/druck/rechnung/<Rechnungs-ID>.
// Jeder Beleg trägt dieselbe Fusszeile (Firma, UID/MWST-Nr., IBAN des Kontos der Belegwährung). AGB können als Zusatzseite folgen,
// Rechnungen an Kunden in CH/LI tragen den QR-Zahlteil (js/qrbill.js).
// Ohne Seitenleiste; die Sprache des Belegs ist die gewählte Oberflächensprache. Zeigt nie Einkaufspreise (Positionen tragen keinen EK).
import { byId, getTeam, isSuper, S } from "../store.js";
import * as api from "../api.js";
import { html, raw, fmtDate, fmtNum, todayISO } from "../util.js";
import { icon } from "../ui.js";
import * as brand from "../branding.js";
import { primaryContact, billingContact, countryLabel, activeDeliveryAddresses, effectiveAddress, billingAddress, addressLines } from "../model.js";
import { fmtArtNr, lineTotal, docCurrency, bankFor, senderCityLine, landCode, vatByCountry } from "../billing.js";
import { billingSettings, totalsOf, n2, money2, qty } from "./docs.js";
import { t, mountSwitches } from "../i18n.js";
import { invoiceFromDeal } from "./invoices.js";
import { prepareQrBill, QR_COUNTRIES, fmtIban } from "../qrbill.js";
import { encode as qrEncode, toPath as qrPath } from "../vendor/qr-encoder.js";

const KINDS = { offerte: "deals", auftragsbestaetigung: "deals", proforma: "deals", lieferschein: "deals", rechnung: "invoices" };
const FILE_KEYS = { offerte: "print.offerFile", auftragsbestaetigung: "print.abFile", proforma: "print.pfFile", lieferschein: "print.lsFile", rechnung: "print.invoiceFile" };
/** Belegnummer: Offerte/AB = Angebotsnummer, Pro-forma «PF-<Nr>», Lieferschein «LS-<Nr>», Rechnung = Rechnungsnummer */
const docNr = (kind, rec) => (kind === "proforma" ? `PF-${rec.nr}` : kind === "lieferschein" ? `LS-${rec.nr}` : rec.nr);

// ------------------------------------------------------------ Absender-Darstellung des Belegs
// Ein Beleg zeigt IMMER die Darstellung des Teams, zu dem er gehört – nie die der betrachtenden Person und nie «KGC CRM»
// (der Superadmin sieht in der Oberfläche immer KGC, im Beleg aber das Team, das er betreten hat). Hat das Team kein Logo,
// steht nur der Firmenname (Firmenangaben, sonst Anzeigename des Teams) als Überschrift. Die Darstellung des Teams wird
// ausdrücklich geladen und nicht auf die Oberfläche angewendet.
const DOC_BRAND_TTL = 20000;
let docBrand = null; // { teamId, at, logo, name }
brand.onChange(() => { docBrand = null; });

const docBrandFresh = () => (docBrand && docBrand.teamId === (getTeam()?.id || "") && Date.now() - docBrand.at < DOC_BRAND_TTL ? docBrand : null);

async function loadDocBrand() {
  const team = getTeam();
  const teamId = team?.id || "";
  const hit = docBrandFresh();
  if (hit) return hit;
  let logo = null;
  let name = team?.name || "";
  if (team && S.mode !== "local") {
    try {
      const r = await api.branding(isSuper() ? team.id : undefined, { timeout: 8000 });
      const b = r.branding;
      if (b && brand.safeSrc(b.logo)) logo = b.logo;
      name = (b && typeof b.displayName === "string" && b.displayName.trim()) || r.team?.name || name;
    } catch { /* Server nicht erreichbar: ohne Logo, mit Teamname drucken */ }
  }
  docBrand = { teamId, at: Date.now(), logo, name };
  return docBrand;
}

/** Kopf links: Logo des Teams, sonst Firmenname als Text (nie ein Standard-Logo) */
const logoSlot = (logo, name) => (logo ? html`<img id="sh-logo" src="${logo}" alt="${name}">` : name ? html`<div class="sh-brandname">${name}</div>` : "");

function resolveDoc(route) {
  const coll = KINDS[route.id];
  const rec = coll && route.sub ? byId(coll, route.sub) : null;
  return rec ? { kind: route.id, rec } : null;
}

/** Titel der Registerkarte = Vorschlag für den Dateinamen beim «Als PDF speichern» */
export function pageTitle(route) {
  const d = resolveDoc(route);
  if (!d) return t("print.title");
  return t(FILE_KEYS[d.kind], { nr: docNr(d.kind, d.rec) });
}

const lines = (...parts) => parts.filter((p) => p !== "" && p !== null && p !== undefined && p !== false);

function posTable(positions) {
  return html`<table class="doc-tbl"><thead><tr>
    <th class="num">${t("pos.col.pos")}</th><th>${t("pos.col.artNr")}</th><th>${t("pos.col.bezeichnung")}</th><th class="num">${t("pos.col.menge")}</th><th>${t("pos.col.einheit")}</th>
    <th class="num">${t("pos.col.brutto")}</th><th class="num">${t("pos.col.rabatt")}</th><th class="num">${t("pos.col.netto")}</th><th class="num">${t("pos.col.total")}</th></tr></thead>
    <tbody>${positions.map((p, i) => html`<tr>
      <td class="num">${i + 1}</td><td class="nowrap">${p.artNr ? fmtArtNr(p.artNr) : ""}</td><td class="desc">${p.bezeichnung}</td>
      <td class="num">${qty(p.menge)}</td><td>${p.einheit || ""}</td><td class="num">${n2(p.brutto)}</td>
      <td class="num">${Number(p.rabatt) ? `${fmtNum(p.rabatt, Number.isInteger(+p.rabatt) ? 0 : 1)} %` : ""}</td>
      <td class="num">${n2(p.netto)}</td><td class="num">${n2(lineTotal(p).netto)}</td></tr>`)}</tbody></table>`;
}

function totalsTable(doc) {
  const tot = totalsOf(doc);
  const chf2 = (v) => money2(v, docCurrency(doc));
  const row = (label, v, cls = "") => html`<tr class="${cls}"><th scope="row">${label}</th><td class="num">${v}</td></tr>`;
  return html`<table class="doc-tot"><tbody>
    ${row(t("pos.tot.brutto"), chf2(tot.brutto))}
    ${tot.rabatt ? row(t("pos.tot.rabatt"), `– ${chf2(tot.rabatt)}`) : ""}
    ${row(t("pos.tot.netto"), chf2(tot.netto), doc.mwstAktiv ? "" : "grand")}
    ${doc.mwstAktiv ? row(t("pos.tot.mwst", { satz: fmtNum(doc.mwstSatz, Number.isInteger(+doc.mwstSatz) ? 0 : 1) }), chf2(tot.mwst)) : ""}
    ${doc.mwstAktiv ? row(t("pos.tot.total"), chf2(tot.total), "grand") : ""}
  </tbody></table>`;
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

/** Positionen des Lieferscheins: Menge und Einheit, nie Preise */
function deliveryTable(positions) {
  return html`<table class="doc-tbl doc-tbl-ls"><thead><tr>
    <th class="num">${t("pos.col.pos")}</th><th>${t("pos.col.artNr")}</th><th>${t("pos.col.bezeichnung")}</th><th class="num">${t("pos.col.menge")}</th><th>${t("pos.col.einheit")}</th></tr></thead>
    <tbody>${positions.map((p, i) => html`<tr>
      <td class="num">${i + 1}</td><td class="nowrap">${p.artNr ? fmtArtNr(p.artNr) : ""}</td><td class="desc">${p.bezeichnung}</td>
      <td class="num">${qty(p.menge)}</td><td>${p.einheit || ""}</td></tr>`)}</tbody></table>`;
}

/** Lieferadresse: die des Angebots, sonst die (gewählte bzw. erste aktive) Lieferadresse des Kunden, sonst die Stammadresse */
export function deliveryLines(rec, customer) {
  const own = (rec.lieferadresse || "").trim();
  if (own) return own.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!customer) return [];
  const list = activeDeliveryAddresses(customer);
  const a = list.find((x) => x.id === rec.lieferadresseId) || list[0];
  return [customer.firma, ...addressLines(a ? effectiveAddress(customer, a) : billingAddress(customer))].filter(Boolean);
}

/** Gleiche Fusszeile auf jedem Beleg: Firma · UID / MWST-Nr. / Handelsregister · Bankverbindung (IBAN des Kontos der Belegwährung) */
function footerHtml(b, bank, cur, sender) {
  // Kompakt (2 Zeilen je Spalte + Handelsregister auf EINER Zeile über die ganze Breite): spart Platz, damit eine normale Auftragsbestätigung auf eine Seite passt
  const ids = lines(b.uid && t("print.uid", { nr: b.uid }), b.mwstNr && t("print.vatNo", { nr: b.mwstNr }));
  const [firma, ...addr] = sender;
  const bankHead = bank ? [bank.bank, bank.bic && `${t("print.bic")} ${bank.bic}`].filter(Boolean).join(" · ") : "";
  const bankIban = bank?.iban ? `${t("print.footIban", { cur })} ${fmtIban(bank.iban)}` : "";
  return html`<footer class="sh-foot">
    <div class="sh-foot-col"><div class="sh-foot-firma">${firma || ""}</div>${addr.length ? html`<div class="sh-foot-addr">${addr.join(", ")}</div>` : ""}</div>
    <div class="sh-foot-col">${ids.map((l) => html`<div>${l}</div>`)}</div>
    <div class="sh-foot-col">${bankHead ? html`<div>${bankHead}</div>` : ""}${bankIban ? html`<div class="sh-foot-iban">${bankIban}</div>` : ""}</div>
    ${b.handelsregister ? html`<div class="sh-foot-hr">${t("print.hr", { nr: b.handelsregister })}</div>` : ""}
  </footer>`;
}

const SCISSORS = '<svg class="qrs-scissors" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9 20 18M8.1 16.1 20 6" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/></svg>';
/** Schweizer Kreuz in der Mitte des QR-Codes: 7 × 7 mm, weisser Rahmen (Proportionen der Spezifikation) */
const SWISS_CROSS = '<svg class="qrs-cross" viewBox="0 0 19.8 19.8" aria-hidden="true"><rect width="19.8" height="19.8" fill="#fff"/><rect x="0.7" y="0.7" width="18.4" height="18.4" fill="#000"/><rect x="8.3" y="4" width="3.3" height="11" fill="#fff"/><rect x="4.4" y="7.9" width="11" height="3.3" fill="#fff"/></svg>';

const addrLines = (a) => [a.name, [a.street, a.houseNo].filter(Boolean).join(" "), [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean);
const addrBlock = (a) => addrLines(a).map((l) => html`<div>${l}</div>`);

/** QR-Zahlteil 210 × 105 mm (Empfangsschein 62 mm + Zahlteil 148 mm) */
function qrSlip(v, payload) {
  const q = qrEncode(payload);
  const svg = `<svg class="qrs-svg" viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges" aria-label="QR"><path d="${qrPath(q.modules)}" fill="#000"/></svg>`;
  const cc = v.creditor.country;
  const creditor = html`<div>${fmtIban(v.iban)}</div>${addrBlock({ ...v.creditor, zip: `${cc}-${v.creditor.zip}` })}`;
  const debtor = v.debtor ? addrBlock({ ...v.debtor, zip: `${v.debtor.country}-${v.debtor.zip}` }) : null;
  const amount = (cls) => (v.amount ? html`<div class="qrs-val">${v.amount}</div>` : html`<div class="qrs-box qrs-box-amount ${cls}"></div>`);
  return html`<section class="qrs" data-qr-slip>
    <div class="qrs-rec">
      <h3 class="qrs-title">${t("qr.receipt")}</h3>
      <div class="qrs-rec-info">
        <div class="qrs-h6">${t("qr.account")}</div><div class="qrs-v8">${creditor}</div>
        ${v.reference ? html`<div class="qrs-h6">${t("qr.reference")}</div><div class="qrs-v8">${v.reference}</div>` : ""}
        <div class="qrs-h6">${v.debtor ? t("qr.payableBy") : t("qr.payableByName")}</div>
        ${debtor ? html`<div class="qrs-v8">${debtor}</div>` : html`<div class="qrs-box qrs-box-rec"></div>`}
      </div>
      <div class="qrs-rec-amount">
        <div><div class="qrs-h6">${t("qr.currency")}</div><div class="qrs-v8">${v.currency}</div></div>
        <div><div class="qrs-h6">${t("qr.amount")}</div>${v.amount ? html`<div class="qrs-v8">${v.amount}</div>` : html`<div class="qrs-box qrs-box-rec-amount"></div>`}</div>
      </div>
      <div class="qrs-accept qrs-h6">${t("qr.acceptance")}</div>
    </div>
    <div class="qrs-pay">
      <h3 class="qrs-title">${t("qr.payment")}</h3>
      <div class="qrs-code"><div class="qrs-code-in">${raw(svg)}${raw(SWISS_CROSS)}</div></div>
      <div class="qrs-pay-amount">
        <div><div class="qrs-h8">${t("qr.currency")}</div><div class="qrs-v10">${v.currency}</div></div>
        <div><div class="qrs-h8">${t("qr.amount")}</div>${v.amount ? html`<div class="qrs-v10">${v.amount}</div>` : html`<div class="qrs-box qrs-box-pay-amount"></div>`}</div>
      </div>
      <div class="qrs-pay-info">
        <div class="qrs-h8">${t("qr.account")}</div><div class="qrs-v10">${creditor}</div>
        ${v.reference ? html`<div class="qrs-h8">${t("qr.reference")}</div><div class="qrs-v10">${v.reference}</div>` : ""}
        ${v.message ? html`<div class="qrs-h8">${t("qr.additional")}</div><div class="qrs-v10">${v.message}</div>` : ""}
        <div class="qrs-h8">${v.debtor ? t("qr.payableBy") : t("qr.payableByName")}</div>
        ${debtor ? html`<div class="qrs-v10">${debtor}</div>` : html`<div class="qrs-box qrs-box-pay"></div>`}
      </div>
    </div>
    <div class="qrs-sep" aria-hidden="true">${raw(SCISSORS)}<span>${t("qr.separate")}</span></div>
  </section>`;
}

let layoutHandler = null;

/** Rechnung mit QR-Zahlteil: passt der Inhalt über den Zahlteil (192 mm), steht er auf derselben Seite, sonst auf einer eigenen letzten Seite */
function layoutQr(root) {
  const page = root.querySelector("[data-qr-page]");
  if (!page) return;
  const flow = page.querySelector(".sh-flow"), foot = page.querySelector(".sh-foot");
  page.classList.remove("fit");
  page.classList.add("split");
  if (window.innerWidth < 800) return; // schmale Anzeige: Vorschau ohne Seitenmasse
  const mm = 96 / 25.4;
  const need = flow.offsetHeight + (foot ? foot.offsetHeight : 0);
  if (need <= (297 - 105 - 16 - 5) * mm - 2) { page.classList.remove("split"); page.classList.add("fit"); }
}

export function render(root, route) {
  const doc = resolveDoc(route);
  if (!doc) {
    root.innerHTML = html`<div class="print-bar"><a class="btn" href="#/uebersicht">${icon("back")} ${t("app.toOverview")}</a></div><div class="card pad"><h2>${t("print.notFound")}</h2></div>`.toString();
    return;
  }
  const { kind, rec } = doc;
  const b = billingSettings();
  const isInv = kind === "rechnung";
  const isAB = kind === "auftragsbestaetigung";
  const isPF = kind === "proforma";
  const isLS = kind === "lieferschein";
  const isOffer = kind === "offerte";
  const nr = docNr(kind, rec);
  const cur = docCurrency(rec);
  const bank = bankFor(b, cur, rec.bankId); // IBAN in der Fusszeile jedes Belegs
  const customer = byId("customers", rec.customerId);
  const contact = customer && (isInv || isPF ? billingContact(customer) : primaryContact(customer)); // Rechnung: Buchhaltung, sonst Einkäufer/Hauptkontakt
  const known = docBrandFresh();
  const teamName = known?.name || getTeam()?.name || "";
  const sender = lines(b.firma || teamName, b.adresse, senderCityLine(b), b.land);
  const hasLogo = Boolean(known?.logo);
  const senderContact = lines(b.telefon, b.email);
  const date = isInv ? rec.datum : isAB || isPF ? todayISO() : isLS ? rec.liefertermin || todayISO() : rec.gesendet || rec.erstellt || todayISO();
  const back = isInv ? `#/rechnungen/${rec.id}` : `#/angebote`;
  const title = t({ rechnung: "print.invoiceTitle", auftragsbestaetigung: "print.abTitle", proforma: "print.pfTitle", lieferschein: "print.lsTitle", offerte: "print.offerTitle" }[kind], { nr });
  const cc = landCode(customer?.land);
  const zip = customer ? [customer.plz, customer.ort].filter(Boolean).join(" ") : "";
  const vatNote = rec.mwstAktiv ? t("print.vatIncluded", { cur }) : customer && vatByCountry(customer.land) === false ? t("print.vatExport", { cur }) : t("print.vatNone", { cur });
  const delivery = isAB || isLS ? deliveryLines(rec, customer) : [];
  const positions = rec.positions || [];
  const days = isInv && rec.datum && rec.faellig ? Math.max(0, daysBetween(rec.datum, rec.faellig)) : b.zahlungsfristTage;
  const meta = lines(
    [{ rechnung: t("print.invoiceNo"), auftragsbestaetigung: t("print.abNo"), proforma: t("print.pfNo"), lieferschein: t("print.lsNo"), offerte: t("print.offerNo") }[kind], nr],
    [isLS ? t("print.lsDate") : t("print.date"), fmtDate(date)],
    customer && [t("print.customerNo"), customer.nr],
    (isLS || isPF) && [t("print.orderNo"), rec.nr],
    isInv && rec.faellig && [t("print.dueDate"), fmtDate(rec.faellig)],
    isInv && rec.referenz && [t("print.reference"), rec.referenz],
    isAB && rec.liefertermin && [t("print.deliveryDate"), fmtDate(rec.liefertermin)],
    !isLS && [t("print.currency"), cur],
  );

  // AGB: Standard aus den Einstellungen (AB: ein, Offerte: aus); in der Druckleiste für diesen Ausdruck umschaltbar
  const agbText = (b.agb || "").trim();
  const agbOn = (isAB && b.agbAuftragsbestaetigung) || (isOffer && b.agbOfferte);
  const agbCapable = (isAB || isOffer) && Boolean(agbText);
  const agbMissing = (isAB ? b.agbAuftragsbestaetigung : isOffer && b.agbOfferte) && !agbText; // gewünscht, aber kein Text erfasst

  // QR-Zahlteil: nur Rechnungen an Kunden in der Schweiz / Liechtenstein
  const qrWanted = isInv && rec.status !== "Storniert" && QR_COUNTRIES.includes(cc);
  const qr = qrWanted ? prepareQrBill({ billing: b, bank, currency: cur, nr: rec.nr, total: totalsOf(rec).total, customer, customerCountry: cc, message: t("print.payRefValue", { nr: rec.nr }) }) : null;
  const showSlip = Boolean(qr?.ok);

  const others = !isInv && positions.length ? ["offerte", "auftragsbestaetigung", "proforma", "lieferschein"].filter((k) => k !== kind) : [];
  const otherLabel = { offerte: "print.offerBtn", auftragsbestaetigung: "print.abBtn", proforma: "print.pfBtn", lieferschein: "print.lsBtn" };

  root.innerHTML = html`
    <div class="print-bar">
      <a class="btn" href="${back}">${icon("back")} ${t("print.back")}</a>
      <span class="spacer"></span>
      <div class="lang-switch" data-lang-switch></div>
      ${agbCapable ? html`<label class="check print-agb"><input type="checkbox" data-act="agb" ${agbOn ? "checked" : ""}> <span>${t("print.agbAttach")}</span></label>` : ""}
      ${others.map((k) => html`<a class="btn" href="#/druck/${k}/${rec.id}">${icon("download")} ${t(otherLabel[k])}</a>`)}
      ${!isInv && positions.length ? html`<button type="button" class="btn" data-act="make-invoice">${icon("receipt")} ${t("inv.createFromDeal")}</button>` : ""}
      <button type="button" class="btn btn-primary" data-act="print" ${known ? "" : "disabled"}>${icon("download")} ${t("print.printBtn")}</button>
    </div>
    ${!b.firma ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.noSender")} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${!b.uid ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.noUid")} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${!bank ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.noBank", { cur })} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${agbMissing ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.agbEmpty")} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${qr && !qr.ok ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div><strong>${t("qr.warn.intro")}</strong> ${qr.warnings.map((w) => t(`qr.warn.${w}`, { cur })).join(" ")} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${showSlip ? html`<div class="banner print-note qr-test-note" role="status">${icon("alert")}<div>${t("qr.testNote")}</div></div>` : ""}
    <div class="doc-pages">
    <div ${showSlip ? raw('class="qr-page split" data-qr-page') : raw('class="plain-page"')}>
    <article class="sheet sheet-doc kind-${kind}" lang="${document.documentElement.lang}">
      <div class="sh-flow">
      <header class="sh-head">
        <div class="sh-logo" data-logo-slot>${known ? logoSlot(known.logo, b.firma || known.name) : ""}</div>
        <div class="sh-sender">
          ${sender.map((l, i) => html`<div class="${i === 0 ? "sh-firma" : ""}" ${i === 0 && known && !hasLogo ? "hidden" : ""}>${l}</div>`)}
          ${senderContact.length ? html`<div class="sh-gap"></div>${senderContact.map((l) => html`<div>${l}</div>`)}` : ""}
        </div>
      </header>
      <section class="sh-addr">
        <div class="sh-to">
          ${customer
            ? html`<div class="sh-fine">${sender.slice(0, 2).join(", ")}</div>
              ${isLS
                ? html`<div class="sh-to-label">${t("print.lsAddr")}</div>${delivery.map((l, i) => html`<div class="${i === 0 ? "sh-to-firma" : ""}">${l}</div>`)}${contact ? html`<div>${t("print.attn")} ${contact.name}</div>` : ""}`
                : html`<div class="sh-to-firma">${customer.firma}</div>
              ${contact ? html`<div>${t("print.attn")} ${contact.name}</div>` : ""}
              ${customer.strasse ? html`<div>${customer.strasse}</div>` : ""}
              ${zip ? html`<div>${cc ? `${cc}-` : ""}${zip}</div>` : ""}
              ${customer.land && cc !== "CH" ? html`<div>${countryLabel(customer.land)}</div>` : ""}`}`
            : html`<div class="muted">–</div>`}
        </div>
        <dl class="sh-meta">${meta.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      </section>
      <h1 class="sh-title">${title}</h1>
      ${isInv && rec.status === "Storniert" ? html`<p class="sh-cancelled">${t("print.cancelled")}</p>` : ""}
      ${isPF ? html`<p class="sh-proforma">${t("print.pfNotice")}</p>` : ""}
      <p class="sh-intro">${isInv ? t("print.invoiceIntro") : isAB ? t("print.abIntro", { nr: rec.nr }) : isPF ? t("print.pfIntro", { nr: rec.nr }) : isLS ? t("print.lsIntro", { nr: rec.nr }) : t("print.offerIntro")}</p>
      ${!isInv && rec.produkt ? html`<p class="sh-subject">${rec.produkt}</p>` : ""}
      ${positions.length ? (isLS ? deliveryTable(positions) : posTable(positions)) : html`<p class="muted">${t("pos.none")}</p>`}
      ${isLS ? "" : html`<div class="doc-tot-wrap">${totalsTable(rec)}</div>
      <p class="sh-note">${vatNote}</p>`}
      ${isInv && rec.bemerkung ? html`<div class="sh-remark">${rec.bemerkung}</div>` : ""}
      ${isAB
        ? html`<section class="sh-pay">
            <h2>${t("print.delivery")}</h2>
            <dl class="sh-bank">
              <div><dt>${t("print.deliveryDate")}</dt><dd>${rec.liefertermin ? fmtDate(rec.liefertermin) : t("print.deliveryTbd")}</dd></div>
              <div><dt>${t("print.deliveryAddr")}</dt><dd class="pre">${delivery.join("\n")}</dd></div>
              <div><dt>${t("print.payment")}</dt><dd>${t("print.payTermsAb", { n: b.zahlungsfristTage })}</dd></div>
            </dl>
          </section>
          <p class="sh-terms">${t("print.agb")}</p>
          <section class="sh-sign">
            <p>${t("print.signText")}</p>
            <div class="sh-sign-row"><div>${t("print.signPlaceDate")}</div><div>${t("print.signSignature")}</div></div>
          </section>`
        : ""}
      ${isPF
        ? html`<section class="sh-pay">
            <h2>${t("print.payment")}</h2>
            <p>${t("print.pfPay")}</p>
            ${bank ? html`<dl class="sh-bank">
              ${bank.bank ? html`<div><dt>${t("print.bank")}</dt><dd>${bank.bank}</dd></div>` : ""}
              ${bank.iban ? html`<div><dt>${t("print.iban")}</dt><dd>${fmtIban(bank.iban)}</dd></div>` : ""}
              ${bank.bic ? html`<div><dt>${t("print.bic")}</dt><dd>${bank.bic}</dd></div>` : ""}
              <div><dt>${t("print.currency")}</dt><dd>${cur}</dd></div>
              <div><dt>${t("print.payRef")}</dt><dd>${t("print.pfPayRefValue", { nr })}</dd></div>
            </dl>` : ""}
          </section>`
        : ""}
      ${isLS
        ? html`          <section class="sh-sign">
            <h2 class="sh-sign-h">${t("print.lsReceipt")}</h2>
            <p>${t("print.lsRecvText")}</p>
            <div class="sh-sign-row"><div>${t("print.signPlaceDate")}</div><div>${t("print.lsSign")}</div></div>
          </section>`
        : ""}
      ${isInv
        ? html`<section class="sh-pay">
            <h2>${t("print.payment")}</h2>
            <p>${t("print.payTerms", { n: days, date: fmtDate(rec.faellig) })}</p>
            ${bank && !showSlip ? html`<dl class="sh-bank">
              ${bank.bank ? html`<div><dt>${t("print.bank")}</dt><dd>${bank.bank}</dd></div>` : ""}
              ${bank.iban ? html`<div><dt>${t("print.iban")}</dt><dd>${fmtIban(bank.iban)}</dd></div>` : ""}
              ${bank.bic ? html`<div><dt>${t("print.bic")}</dt><dd>${bank.bic}</dd></div>` : ""}
              <div><dt>${t("print.currency")}</dt><dd>${cur}</dd></div>
              <div><dt>${t("print.payRef")}</dt><dd>${t("print.payRefValue", { nr: rec.nr })}</dd></div>
            </dl>` : ""}
          </section>`
        : ""}
      <p class="sh-thanks">${isInv ? t("print.thanksInvoice") : isAB ? t("print.thanksAb") : isPF ? t("print.thanksPf") : isLS ? t("print.thanksLs") : t("print.thanksOffer")}</p>
      </div>
      ${footerHtml(b, bank, cur, sender)}
    </article>
    ${showSlip ? html`<div class="qr-slip-wrap"><p class="qr-slip-note">${t("qr.slipNote", { nr: rec.nr })}</p>${qrSlip(qr.view, qr.payload)}</div>` : ""}
    </div>
    ${agbCapable ? html`<article class="sheet sheet-agb" data-agb ${agbOn ? "" : "hidden"} lang="${document.documentElement.lang}">
      <h2 class="agb-title">${t("print.agbTitle")}</h2>
      <div class="agb-text">${agbText}</div>
    </article>` : ""}
    </div>`.toString();

  mountSwitches();
  const slot = root.querySelector("[data-logo-slot]");
  const printBtn = root.querySelector('[data-act="print"]');
  const relayout = () => layoutQr(root);
  const fillSlot = (db) => {
    if (!slot.isConnected) return;
    const name = b.firma || db.name;
    slot.innerHTML = logoSlot(db.logo, name).toString();
    const img = slot.querySelector("img");
    if (img) {
      img.addEventListener("error", () => { slot.innerHTML = logoSlot(null, name).toString(); relayout(); }, { once: true }); // beschädigtes Logo: Firmenname statt Standard-Logo
      img.addEventListener("load", relayout, { once: true });
    }
    const f = root.querySelector(".sh-sender .sh-firma"); // ohne Logo steht der Firmenname schon als Überschrift links
    if (f) { if (!b.firma) f.textContent = db.name; f.hidden = !db.logo; }
    if (printBtn) printBtn.disabled = false;
    relayout();
  };
  if (known) fillSlot(known); else loadDocBrand().then(fillSlot);
  relayout();
  if (layoutHandler) window.removeEventListener("beforeprint", layoutHandler);
  layoutHandler = () => { if (root.isConnected) relayout(); else { window.removeEventListener("beforeprint", layoutHandler); layoutHandler = null; } };
  window.addEventListener("beforeprint", layoutHandler);
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "print") window.print();
    else if (act === "make-invoice") invoiceFromDeal(rec.id);
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches('[data-act="agb"]')) { const el = root.querySelector("[data-agb]"); if (el) el.hidden = !e.target.checked; }
  });
}
