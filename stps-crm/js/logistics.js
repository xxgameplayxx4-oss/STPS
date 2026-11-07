// Lieferverfolgung je Lieferantenzuordnung (RFQ/Bestellung): Versanddatum, erwartetes Lieferdatum, Spediteur, Tracking, Status.
// Reine Funktionen ohne Oberfläche (in Node testbar). Gespeicherte Werte sind deutsch; Anzeige übersetzt js/i18n.
//
// Kundensicht: Der Hersteller/Lieferant darf auf Dokumenten und in Auskünften an Kunden NIE erscheinen. Wer Versandangaben an den Kunden
// weitergibt (Auftragsbestätigung, Lieferhinweis), nimmt ausschliesslich customerShipment() – eine Positivliste ohne Lieferanten-Bezug.

export const SHIP_STATUS = ["Offen", "Versendet", "Unterwegs", "Zugestellt", "Verzögert"];
export const CARRIERS = ["DHL", "DPD", "UPS", "FedEx", "Schweizerische Post", "Maersk", "MSC", "Hapag-Lloyd", "CMA CGM", "DHL Global Forwarding", "Kuehne+Nagel", "Swiss WorldCargo", "Andere"];
export const SHIP_TONES = { Offen: "grey", Versendet: "blue", Unterwegs: "sky", Zugestellt: "green", "Verzögert": "red" };

const TRACK_URL = {
  DHL: "https://www.dhl.com/ch-de/home/tracking.html?tracking-id=",
  DPD: "https://tracking.dpd.de/parcelstatus?query=",
  UPS: "https://www.ups.com/track?tracknum=",
  FedEx: "https://www.fedex.com/fedextrack/?trknbr=",
  "Schweizerische Post": "https://service.post.ch/ekp-web/external/surveillance/search?identifier=",
  Maersk: "https://www.maersk.com/tracking/",
  MSC: "https://www.msc.com/en/track-a-shipment?trackingNumber=",
  "Hapag-Lloyd": "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=",
  "CMA CGM": "https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=",
  "DHL Global Forwarding": "https://www.dhl.com/global-en/home/tracking.html?tracking-id=",
};

/** Nur http(s)-Adressen ohne Leerzeichen/Anführungszeichen (kein javascript:, data: …); sonst "" */
export function safeUrl(v) {
  const s = String(v ?? "").trim();
  return s.length <= 600 && /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : "";
}

/** Referenz für die Verfolgung: Sendungsnummer, sonst Containernummer, sonst B/L- bzw. AWB-Nummer */
export const trackingRef = (r) => String(r?.trackingNr || r?.containerNr || r?.blAwbNr || "").trim();

/** Link zur Sendungsverfolgung: eigener Link, sonst aus Spediteur + Sendungsnummer */
export function trackingHref(r) {
  const own = safeUrl(r?.trackingLink);
  if (own) return own;
  const base = TRACK_URL[r?.spediteur];
  const nr = trackingRef(r);
  return base && nr ? base + encodeURIComponent(nr) : "";
}

/** Hat die Zuordnung überhaupt Versandangaben? */
export const hasShipment = (r) => Boolean(r && (r.versandAm || r.containerNr || r.blAwbNr || r.transport || (Array.isArray(r.events) && r.events.length) || r.lieferungErwartet || r.spediteur || r.trackingNr || r.trackingLink || r.versandStatus));

/** Wirksamer Status: gespeicherter Wert; sonst «Versendet» wenn ein Versanddatum gesetzt ist; sonst leer */
export const shipStatus = (r) => (SHIP_STATUS.includes(r?.versandStatus) ? r.versandStatus : r?.versandAm ? "Versendet" : "");

/** Liefertermin überschritten und noch nicht zugestellt? (ISO-Daten, today = YYYY-MM-DD) */
export const shipOverdue = (r, today) => Boolean(r?.lieferungErwartet && today && r.lieferungErwartet < today && shipStatus(r) !== "Zugestellt");

/** Positivliste für Kunden: keine Lieferanten-ID, kein Lieferantenname, kein Kommentar, keine Preise */
export function customerShipment(r) {
  if (!hasShipment(r)) return null;
  return {
    versandAm: r.versandAm || "",
    lieferungErwartet: r.lieferungErwartet || "",
    spediteur: r.spediteur || "",
    trackingNr: r.trackingNr || "",
    trackingLink: trackingHref(r),
    status: shipStatus(r),
  };
}

// ------------------------------------------------------------ Sendungen (Seefracht/Luftfracht/Strasse/Bahn): Statusereignisse, Verspätung, Kennzahlen
// Eine Sendung ist eine Lieferantenzuordnung mit Versandangaben. Zusatzfelder an der Zuordnung: transport, containerNr, blAwbNr,
// originPort, destPort, vessel, currentLocation, events [{ id, date, location, status, note }]. ETD = versandAm, ETA = lieferungErwartet.
// Keine Carrier-Schnittstelle: Ereignisse werden von Hand erfasst.

export const TRANSPORT_MODES = ["Seefracht", "Luftfracht", "Strasse", "Bahn"];
/** Meilensteine in Reihenfolge (gespeicherte deutsche Werte; Anzeige: val.milestone.<Wert>) */
export const MILESTONES = ["Gebucht", "Abgeholt", "Abgefahren", "Unterwegs", "Angekommen", "Zollabfertigung", "Zugestellt"];
const MS_STATUS = { Gebucht: "Offen", Abgeholt: "Versendet", Abgefahren: "Unterwegs", Unterwegs: "Unterwegs", Angekommen: "Unterwegs", Zollabfertigung: "Unterwegs", Zugestellt: "Zugestellt" };

const evList = (r) => (Array.isArray(r?.events) ? r.events.filter((e) => e && typeof e === "object") : []);

/** Ereignisse chronologisch (Datum, dann Reihenfolge der Meilensteine) */
export function sortedEvents(r) {
  return [...evList(r)].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || MILESTONES.indexOf(a.status) - MILESTONES.indexOf(b.status));
}

/** Neuester Stand aus den Ereignissen → { status, location } (leer ohne Ereignisse) */
export function stateFromEvents(r) {
  const ev = sortedEvents(r);
  const last = ev[ev.length - 1];
  return last ? { status: MS_STATUS[last.status] || "", location: last.location || "", milestone: last.status } : { status: "", location: "", milestone: "" };
}

/** Zugestellt am (ISO): Datum des Ereignisses «Zugestellt»; sonst erwartetes Datum, falls als zugestellt markiert */
export function deliveredOn(r) {
  if (shipStatus(r) !== "Zugestellt") return "";
  const e = sortedEvents(r).reverse().find((x) => x.status === "Zugestellt" && x.date);
  return e ? e.date : r?.lieferungErwartet || "";
}

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
/** Tage von a bis b (ISO), negativ wenn b vor a liegt */
export const daysBetween = (a, b) => (a && b ? dayNum(b) - dayNum(a) : 0);

/** Verspätet: ETA verstrichen und nicht zugestellt */
export const isDelayed = (r, today) => shipOverdue(r, today);
/** Verspätung in Tagen (0, wenn nicht verspätet) */
export const delayDays = (r, today) => (isDelayed(r, today) ? daysBetween(r.lieferungErwartet, today) : 0);

/** Anzeigestatus: «Verzögert» bei überschrittener ETA, sonst der Status; leer ohne Versandangaben */
export const shipDisplayStatus = (r, today) => (isDelayed(r, today) ? "Verzögert" : shipStatus(r));

/** Kennzahlen über Sendungen (today = ISO): unterwegs, in 7 Tagen erwartet, verzögert, in diesem Monat zugestellt */
export function shipmentKpis(rows, today) {
  const month = String(today).slice(0, 7);
  const end = addDaysISO(today, 7);
  const active = rows.filter((r) => hasShipment(r) && ["Versendet", "Unterwegs", "Verzögert"].includes(shipStatus(r)));
  return {
    inTransit: active.length,
    arriving7: active.filter((r) => r.lieferungErwartet && r.lieferungErwartet >= today && r.lieferungErwartet <= end).length,
    delayed: rows.filter((r) => hasShipment(r) && isDelayed(r, today)).length,
    deliveredMonth: rows.filter((r) => deliveredOn(r).slice(0, 7) === month).length,
  };
}

function addDaysISO(iso, n) {
  return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
}
