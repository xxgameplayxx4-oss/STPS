// Druckansicht (A4) für Offerten, Auftragsbestätigungen und Rechnungen: #/druck/offerte/<Angebots-ID>, #/druck/auftragsbestaetigung/<Angebots-ID>, #/druck/rechnung/<Rechnungs-ID>.
// Ohne Seitenleiste; die Sprache des Belegs ist die gewählte Oberflächensprache. Zeigt nie Einkaufspreise (Positionen tragen keinen EK).
import { byId, getTeam, isSuper, S } from "../store.js";
import * as api from "../api.js";
import { html, fmtDate, fmtNum, todayISO } from "../util.js";
import { icon } from "../ui.js";
import * as brand from "../branding.js";
import { primaryContact, billingContact, countryLabel } from "../model.js";
import { fmtArtNr, lineTotal, docCurrency, bankFor, senderCityLine, landCode, vatByCountry } from "../billing.js";
import { billingSettings, totalsOf, n2, money2, qty } from "./docs.js";
import { t, mountSwitches } from "../i18n.js";
import { invoiceFromDeal } from "./invoices.js";

const KINDS = { offerte: "deals", auftragsbestaetigung: "deals", rechnung: "invoices" };

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
  return t({ offerte: "print.offerFile", auftragsbestaetigung: "print.abFile", rechnung: "print.invoiceFile" }[d.kind], { nr: d.rec.nr });
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
  const cur = docCurrency(rec);
  const bank = isInv ? bankFor(b, cur, rec.bankId) : null;
  const customer = byId("customers", rec.customerId);
  const contact = customer && (isInv ? billingContact(customer) : primaryContact(customer)); // Rechnung: Buchhaltung, Offerte: Einkäufer/Hauptkontakt
  const known = docBrandFresh();
  const teamName = known?.name || getTeam()?.name || "";
  const sender = lines(b.firma || teamName, b.adresse, senderCityLine(b), b.land);
  const hasLogo = Boolean(known?.logo);
  const senderContact = lines(b.telefon, b.email, b.uid && t("print.uid", { nr: b.uid }), b.mwstNr && t("print.vatNo", { nr: b.mwstNr }), b.handelsregister && t("print.hr", { nr: b.handelsregister }));
  const date = isInv ? rec.datum : isAB ? todayISO() : rec.gesendet || rec.erstellt || todayISO();
  const back = isInv ? `#/rechnungen/${rec.id}` : `#/angebote`;
  const title = isInv ? t("print.invoiceTitle", { nr: rec.nr }) : isAB ? t("print.abTitle", { nr: rec.nr }) : t("print.offerTitle", { nr: rec.nr });
  const cc = landCode(customer?.land);
  const zip = customer ? [customer.plz, customer.ort].filter(Boolean).join(" ") : "";
  const vatNote = rec.mwstAktiv ? t("print.vatIncluded", { cur }) : customer && vatByCountry(customer.land) === false ? t("print.vatExport", { cur }) : t("print.vatNone", { cur });
  const deliveryAddr = isAB ? (rec.lieferadresse || "").trim() : "";
  const positions = rec.positions || [];
  const days = isInv && rec.datum && rec.faellig ? Math.max(0, daysBetween(rec.datum, rec.faellig)) : b.zahlungsfristTage;
  const meta = lines(
    [isInv ? t("print.invoiceNo") : isAB ? t("print.abNo") : t("print.offerNo"), rec.nr],
    [t("print.date"), fmtDate(date)],
    customer && [t("print.customerNo"), customer.nr],
    isInv && rec.faellig && [t("print.dueDate"), fmtDate(rec.faellig)],
    isInv && rec.referenz && [t("print.reference"), rec.referenz],
    isAB && rec.liefertermin && [t("print.deliveryDate"), fmtDate(rec.liefertermin)],
    [t("print.currency"), cur],
  );

  root.innerHTML = html`
    <div class="print-bar">
      <a class="btn" href="${back}">${icon("back")} ${t("print.back")}</a>
      <span class="spacer"></span>
      <div class="lang-switch" data-lang-switch></div>
      ${!isInv && positions.length ? html`<a class="btn" href="#/druck/${isAB ? "offerte" : "auftragsbestaetigung"}/${rec.id}">${icon("download")} ${isAB ? t("print.offerBtn") : t("print.abBtn")}</a>
        <button type="button" class="btn" data-act="make-invoice">${icon("receipt")} ${t("inv.createFromDeal")}</button>` : ""}
      <button type="button" class="btn btn-primary" data-act="print" ${known ? "" : "disabled"}>${icon("download")} ${t("print.printBtn")}</button>
    </div>
    ${!b.firma ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.noSender")} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    ${isInv && !bank ? html`<div class="banner warn print-note" role="status">${icon("alert")}<div>${t("print.noBank", { cur })} <a href="#/einstellungen">${t("nav.einstellungen")}</a></div></div>` : ""}
    <article class="sheet" lang="${document.documentElement.lang}">
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
              <div class="sh-to-firma">${customer.firma}</div>
              ${contact ? html`<div>${t("print.attn")} ${contact.name}</div>` : ""}
              ${customer.strasse ? html`<div>${customer.strasse}</div>` : ""}
              ${zip ? html`<div>${cc ? `${cc}-` : ""}${zip}</div>` : ""}
              ${customer.land && cc !== "CH" ? html`<div>${countryLabel(customer.land)}</div>` : ""}`
            : html`<div class="muted">–</div>`}
        </div>
        <dl class="sh-meta">${meta.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      </section>
      <h1 class="sh-title">${title}</h1>
      ${isInv && rec.status === "Storniert" ? html`<p class="sh-cancelled">${t("print.cancelled")}</p>` : ""}
      <p class="sh-intro">${isInv ? t("print.invoiceIntro") : isAB ? t("print.abIntro", { nr: rec.nr }) : t("print.offerIntro")}</p>
      ${!isInv && rec.produkt ? html`<p class="sh-subject">${rec.produkt}</p>` : ""}
      ${positions.length ? posTable(positions) : html`<p class="muted">${t("pos.none")}</p>`}
      <div class="doc-tot-wrap">${totalsTable(rec)}</div>
      <p class="sh-note">${vatNote}</p>
      ${isInv && rec.bemerkung ? html`<div class="sh-remark">${rec.bemerkung}</div>` : ""}
      ${isAB
        ? html`<section class="sh-pay">
            <h2>${t("print.delivery")}</h2>
            <dl class="sh-bank">
              <div><dt>${t("print.deliveryDate")}</dt><dd>${rec.liefertermin ? fmtDate(rec.liefertermin) : t("print.deliveryTbd")}</dd></div>
              <div><dt>${t("print.deliveryAddr")}</dt><dd class="pre">${deliveryAddr || [customer?.firma, customer?.strasse, zip && `${cc ? cc + "-" : ""}${zip}`, countryLabel(customer?.land)].filter(Boolean).join("\n")}</dd></div>
              <div><dt>${t("print.payment")}</dt><dd>${t("print.payTermsAb", { n: b.zahlungsfristTage })}</dd></div>
            </dl>
          </section>
          <p class="sh-terms">${t("print.agb")}</p>
          <section class="sh-sign">
            <p>${t("print.signText")}</p>
            <div class="sh-sign-row"><div>${t("print.signPlaceDate")}</div><div>${t("print.signSignature")}</div></div>
          </section>`
        : ""}
      ${isInv
        ? html`<section class="sh-pay">
            <h2>${t("print.payment")}</h2>
            <p>${t("print.payTerms", { n: days, date: fmtDate(rec.faellig) })}</p>
            ${bank ? html`<dl class="sh-bank">
              ${bank.bank ? html`<div><dt>${t("print.bank")}</dt><dd>${bank.bank}</dd></div>` : ""}
              ${bank.iban ? html`<div><dt>${t("print.iban")}</dt><dd>${bank.iban}</dd></div>` : ""}
              ${bank.bic ? html`<div><dt>${t("print.bic")}</dt><dd>${bank.bic}</dd></div>` : ""}
              <div><dt>${t("print.currency")}</dt><dd>${cur}</dd></div>
              <div><dt>${t("print.payRef")}</dt><dd>${t("print.payRefValue", { nr: rec.nr })}</dd></div>
            </dl>` : ""}
          </section>`
        : ""}
      <p class="sh-thanks">${isInv ? t("print.thanksInvoice") : isAB ? t("print.thanksAb") : t("print.thanksOffer")}</p>
    </article>`.toString();

  mountSwitches();
  const slot = root.querySelector("[data-logo-slot]");
  const printBtn = root.querySelector('[data-act="print"]');
  const fillSlot = (db) => {
    if (!slot.isConnected) return;
    const name = b.firma || db.name;
    slot.innerHTML = logoSlot(db.logo, name).toString();
    const img = slot.querySelector("img");
    if (img) img.addEventListener("error", () => { slot.innerHTML = logoSlot(null, name).toString(); }, { once: true }); // beschädigtes Logo: Firmenname statt Standard-Logo
    const f = root.querySelector(".sh-sender .sh-firma"); // ohne Logo steht der Firmenname schon als Überschrift links
    if (f) { if (!b.firma) f.textContent = db.name; f.hidden = !db.logo; }
    if (printBtn) printBtn.disabled = false;
  };
  if (known) fillSlot(known); else loadDocBrand().then(fillSlot);
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "print") window.print();
    else if (act === "make-invoice") invoiceFromDeal(rec.id);
  });
}
