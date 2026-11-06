// Lieferverfolgung: Darstellung für Listen und Detailkarten (Logik in ../logistics.js). Nur intern – nie auf Kundendokumenten.
import { html, fmtDate, todayISO } from "../util.js";
import { t } from "../i18n.js";
import { icon } from "../ui.js";
import { badge } from "../model.js";
import { shipStatus, shipOverdue, trackingHref, hasShipment } from "../logistics.js";

const dash = html`<span class="muted">–</span>`;

/** Status-Badge (+ «überfällig», wenn der erwartete Liefertermin verstrichen ist) */
export function shipBadge(r) {
  const st = shipStatus(r);
  return html`${st ? badge(st) : ""}${shipOverdue(r, todayISO()) ? html` <span class="badge t-red" title="${t("log.overdueTitle")}">${t("log.overdue")}</span>` : ""}`;
}

/** Link «Sendung verfolgen» (leer ohne Link) */
export function trackLink(r) {
  const href = trackingHref(r);
  return href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${icon("link")} ${r.trackingNr || t("log.track")}</a>` : r?.trackingNr ? html`${r.trackingNr}` : "";
}

/** Zelle «Lieferung»: Status, erwartetes Datum, Spediteur/Tracking (kompakt) */
export function shipCell(r) {
  if (!hasShipment(r)) return dash;
  return html`<div class="ccell">${shipBadge(r)}${r.lieferungErwartet ? html`<small>${t("log.expectedShort")} ${fmtDate(r.lieferungErwartet)}</small>` : ""}${r.spediteur || r.trackingNr || r.trackingLink ? html`<small>${r.spediteur ? html`${r.spediteur} ` : ""}${trackLink(r)}</small>` : ""}</div>`;
}
