// Lieferverfolgung je Lieferantenzuordnung (RFQ/Bestellung): Versanddatum, erwartetes Lieferdatum, Spediteur, Tracking, Status.
// Reine Funktionen ohne Oberfläche (in Node testbar). Gespeicherte Werte sind deutsch; Anzeige übersetzt js/i18n.
//
// Kundensicht: Der Hersteller/Lieferant darf auf Dokumenten und in Auskünften an Kunden NIE erscheinen. Wer Versandangaben an den Kunden
// weitergibt (Auftragsbestätigung, Lieferhinweis), nimmt ausschliesslich customerShipment() – eine Positivliste ohne Lieferanten-Bezug.

export const SHIP_STATUS = ["Offen", "Versendet", "Unterwegs", "Zugestellt", "Verzögert"];
export const CARRIERS = ["DHL", "DPD", "UPS", "FedEx", "Schweizerische Post", "Andere"];
export const SHIP_TONES = { Offen: "grey", Versendet: "blue", Unterwegs: "sky", Zugestellt: "green", "Verzögert": "red" };

const TRACK_URL = {
  DHL: "https://www.dhl.com/ch-de/home/tracking.html?tracking-id=",
  DPD: "https://tracking.dpd.de/parcelstatus?query=",
  UPS: "https://www.ups.com/track?tracknum=",
  FedEx: "https://www.fedex.com/fedextrack/?trknbr=",
  "Schweizerische Post": "https://service.post.ch/ekp-web/external/surveillance/search?identifier=",
};

/** Nur http(s)-Adressen ohne Leerzeichen/Anführungszeichen (kein javascript:, data: …); sonst "" */
export function safeUrl(v) {
  const s = String(v ?? "").trim();
  return s.length <= 600 && /^https?:\/\/[^\s<>"'`]+$/i.test(s) ? s : "";
}

/** Link zur Sendungsverfolgung: eigener Link, sonst aus Spediteur + Sendungsnummer */
export function trackingHref(r) {
  const own = safeUrl(r?.trackingLink);
  if (own) return own;
  const base = TRACK_URL[r?.spediteur];
  const nr = String(r?.trackingNr ?? "").trim();
  return base && nr ? base + encodeURIComponent(nr) : "";
}

/** Hat die Zuordnung überhaupt Versandangaben? */
export const hasShipment = (r) => Boolean(r && (r.versandAm || r.lieferungErwartet || r.spediteur || r.trackingNr || r.trackingLink || r.versandStatus));

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
