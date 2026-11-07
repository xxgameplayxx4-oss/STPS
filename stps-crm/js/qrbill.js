// Swiss QR-bill (QR-Rechnung): reine Logik, keine DOM-/Store-Abhängigkeit (auch in Node nutzbar).
// Grundlage: SIX «Swiss Payment Standards», Swiss Implementation Guidelines QR-bill, Version 2.3 (strukturierte Adresse Typ «S»,
// kombinierte Adresse «K» entfällt). Der Payload («SPC») wird Zeile für Zeile aufgebaut (siehe buildPayload) und mit js/vendor/qr-encoder.js
// (Fehlerkorrektur M) als QR-Code gezeichnet. Hinweis: vor dem Produktivbetrieb mit der Bank testen.
import { round2, toNum } from "./billing.js";

export const QR_CURRENCIES = ["CHF", "EUR"];
export const REF_TYPES = ["auto", "QRR", "SCOR", "NON"]; // auto: QR-IBAN vorhanden → QRR, sonst SCOR
export const QR_COUNTRIES = ["CH", "LI"]; // Rechnung mit QR-Zahlteil nur an Kunden in der Schweiz / Liechtenstein

// ------------------------------------------------------------ IBAN

/** Leerzeichen entfernen, Grossbuchstaben */
export const normIban = (s) => String(s ?? "").replace(/\s+/g, "").toUpperCase();
/** «CH93 0076 2011 6238 5295 7» (Vierergruppen) */
export const fmtIban = (s) => normIban(s).replace(/(.{4})/g, "$1 ").trim();

function mod97(numeric) {
  let r = 0;
  for (const ch of numeric) r = (r * 10 + Number(ch)) % 97;
  return r;
}
const alnumToDigits = (s) => [...s].map((c) => (/[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");

/** IBAN der Schweiz/Liechtensteins: 21 Zeichen, CH/LI, Prüfziffern nach ISO 7064 (mod 97) */
export function isSwissIban(iban) {
  const s = normIban(iban);
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(s)) return false;
  return mod97(alnumToDigits(s.slice(4) + s.slice(0, 4))) === 1;
}

/** Institutsidentifikation (Stellen 5–9 der IBAN) */
export const iidOf = (iban) => Number(normIban(iban).slice(4, 9));
/** QR-IBAN: gültige CH/LI-IBAN mit IID 30000–31999 (nur diese darf mit QR-Referenz verwendet werden) */
export const isQrIban = (iban) => isSwissIban(iban) && iidOf(iban) >= 30000 && iidOf(iban) <= 31999;

// ------------------------------------------------------------ Referenzen

const MOD10 = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
/** Prüfziffer nach «Modulo 10, rekursiv» (Übertragstabelle) für eine Ziffernfolge */
export function mod10Check(digits) {
  let carry = 0;
  for (const ch of String(digits)) carry = MOD10[(carry + Number(ch)) % 10];
  return (10 - carry) % 10;
}

/** QR-Referenz (27 Ziffern): Nummer links mit Nullen auf 26 Stellen aufgefüllt + Prüfziffer. null bei ungültiger Nummer. */
export function qrrReference(nr) {
  const d = String(nr ?? "").replace(/\D/g, "");
  if (!d || d.length > 26) return null;
  const base = d.padStart(26, "0");
  return base + mod10Check(base);
}
export const isValidQrr = (ref) => /^\d{27}$/.test(ref) && mod10Check(ref.slice(0, 26)) === Number(ref[26]);
/** «21 00000 00003 13947 14300 09017» */
export const fmtQrr = (ref) => String(ref).replace(/\s+/g, "").replace(/^(\d{2})(\d*)$/, (_, a, b) => [a, ...(b.match(/.{1,5}/g) || [])].join(" "));

/** Creditor Reference nach ISO 11649: «RF» + 2 Prüfziffern + bis 21 Zeichen (A–Z, 0–9). null bei ungültiger Eingabe. */
export function scorReference(nr) {
  const body = String(nr ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^[0-9A-Z]{1,21}$/.test(body)) return null;
  const check = 98 - mod97(alnumToDigits(`${body}RF00`));
  return `RF${String(check).padStart(2, "0")}${body}`;
}
export const isValidScor = (ref) => /^RF\d{2}[0-9A-Z]{1,21}$/.test(ref) && mod97(alnumToDigits(ref.slice(4) + ref.slice(0, 4))) === 1;
/** «RF18 5390 0754 7034» */
export const fmtScor = (ref) => String(ref).replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

// ------------------------------------------------------------ Texte (erlaubter Zeichensatz, Längen)

// Zeichensatz der Swiss Implementation Guidelines: Latin-Zeichen (Basic Latin + Latin-1), ohne Steuerzeichen, × und ÷
const allowedChar = (c) => /^[\u0020-\u007E\u00C0-\u00FF]$/.test(c) && c !== "\u00D7" && c !== "\u00F7";
/** Auf den erlaubten Zeichensatz bringen (Akzente nach Möglichkeit entfernen, sonst «.»), Leerraum vereinfachen, auf max Zeichen kürzen */
export function clean(text, max) {
  let out = "";
  for (const c of String(text ?? "").normalize("NFC").replace(/[\r\n\t]+/g, " ")) {
    if (allowedChar(c)) { out += c; continue; }
    const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base && [...base].every(allowedChar) ? base : ".";
  }
  return out.replace(/ {2,}/g, " ").trim().slice(0, max);
}

/** «Industriestrasse 12a» → { street: "Industriestrasse", houseNo: "12a" }; ohne Hausnummer: nur street */
export function splitStreet(s) {
  const v = String(s ?? "").trim();
  const m = /^(.*?)[\s,]+(\d+[A-Za-z]?(?:\s?[-/]\s?\d+[A-Za-z]?)?)$/.exec(v);
  return m && m[1] ? { street: m[1].trim(), houseNo: m[2].replace(/\s+/g, "") } : { street: v, houseNo: "" };
}

/** Betrag als «1234.50» (2 Dezimalstellen, kein Tausendertrenner); leer, wenn nicht 0.01 … 999999999.99 */
export function amountText(v) {
  const n = round2(toNum(v));
  return n >= 0.01 && n <= 999999999.99 ? n.toFixed(2) : "";
}
/** Anzeige im Zahlteil: «1 234.50» */
export const fmtAmount = (v) => (amountText(v) ? amountText(v).replace(/\B(?=(\d{3})+\.)/g, " ") : "");

// ------------------------------------------------------------ Payload

const addr = (a) => (a ? ["S", clean(a.name, 70), clean(a.street, 70), clean(a.houseNo, 16), clean(a.zip, 16), clean(a.city, 35), String(a.country || "").toUpperCase()] : ["", "", "", "", "", "", ""]);

/**
 * Inhalt des QR-Codes: 31 Zeilen bis «EPD» (+ optional Rechnungsinformation), getrennt durch LF.
 *  1 SPC · 2 0200 · 3 1 (UTF-8) · 4 IBAN · 5–11 Zahlungsempfänger (S, Name, Strasse, Nr., PLZ, Ort, Land) · 12–18 Endgültiger Zahlungsempfänger (leer, reserviert)
 *  19 Betrag · 20 Währung · 21–27 Zahlungspflichtiger (S …, oder 7 leere Zeilen) · 28 QRR|SCOR|NON · 29 Referenz · 30 Mitteilung · 31 EPD · 32 Rechnungsinformation
 * @param {{iban:string, creditor:object, amount?:number, currency:string, debtor?:object|null, refType:string, reference?:string, message?:string, billingInfo?:string}} q
 */
export function buildPayload(q) {
  const lines = [
    "SPC", "0200", "1",
    normIban(q.iban),
    ...addr(q.creditor),
    ...addr(null),
    amountText(q.amount),
    q.currency,
    ...addr(q.debtor),
    q.refType,
    q.refType === "NON" ? "" : String(q.reference ?? "").replace(/\s+/g, ""),
    clean(q.message, 140),
    "EPD",
  ];
  if (q.billingInfo) lines.push(clean(q.billingInfo, 140));
  return lines.join("\n");
}

/**
 * Prüft die Eingaben und liefert Warnungsschlüssel (i18n «qr.warn.*») statt eines Zahlteils, wenn etwas fehlt/nicht passt.
 * @returns {string[]} [] = in Ordnung
 */
export function problems({ currency, bank, creditor, refType, reference }) {
  const w = [];
  if (!QR_CURRENCIES.includes(currency)) w.push("currency");
  if (!bank || !(bank.iban || bank.qrIban)) { w.push("noIban"); return w; }
  if (bank.waehrung && bank.waehrung !== currency) w.push("bankCurrency");
  if (!creditor?.name || !creditor.zip || !creditor.city || !QR_COUNTRIES.includes(creditor.country)) w.push("creditor");
  if (refType === "QRR") {
    if (!bank.qrIban) w.push("noQrIban");
    else if (!isQrIban(bank.qrIban)) w.push("badQrIban");
  } else {
    if (!bank.iban) w.push("noIban");
    else if (!isSwissIban(bank.iban)) w.push("badIban");
    else if (isQrIban(bank.iban)) w.push("qrIbanWithScor"); // QR-IBAN verlangt die QR-Referenz
  }
  if (refType === "QRR" && !isValidQrr(reference || "")) w.push("reference");
  if (refType === "SCOR" && !isValidScor(reference || "")) w.push("reference");
  return w;
}

/** Referenzart: «auto» → QRR mit QR-IBAN, sonst SCOR */
export const effectiveRefType = (setting, bank) => (REF_TYPES.includes(setting) && setting !== "auto" ? setting : bank?.qrIban ? "QRR" : "SCOR");

/**
 * Alles für den Zahlteil einer Rechnung.
 * @param {{billing:object, bank:object|null, currency:string, nr:number|string, total:number, customer:object|null, landCode:string, message:string}} p
 * @returns {{ok:boolean, warnings:string[], payload?:string, view?:object}}
 */
export function prepareQrBill({ billing, bank, currency, nr, total, customer, customerCountry, message }) {
  const refType = effectiveRefType(billing?.qrRefType, bank);
  const reference = refType === "QRR" ? qrrReference(nr) : refType === "SCOR" ? scorReference(nr) : "";
  const cs = splitStreet(billing?.adresse);
  const creditor = { name: clean(billing?.firma, 70), street: cs.street, houseNo: cs.houseNo, zip: clean(billing?.plz, 16), city: clean(billing?.ort, 35), country: String(billing?.landCode || "").toUpperCase() };
  const warnings = problems({ currency, bank, creditor, refType, reference: reference || "" });
  if (warnings.length) return { ok: false, warnings };
  const iban = refType === "QRR" ? bank.qrIban : bank.iban;
  const ds = splitStreet(customer?.strasse);
  const dcountry = String(customerCountry || "").toUpperCase();
  const debtor = customer?.firma && customer.plz && customer.ort && /^[A-Z]{2}$/.test(dcountry) ? { name: customer.firma, street: ds.street, houseNo: ds.houseNo, zip: customer.plz, city: customer.ort, country: dcountry } : null;
  const payload = buildPayload({ iban, creditor, amount: total, currency, debtor, refType, reference, message });
  return {
    ok: true,
    warnings,
    payload,
    view: {
      iban: fmtIban(iban), creditor, debtor, refType, currency,
      reference: refType === "QRR" ? fmtQrr(reference) : refType === "SCOR" ? fmtScor(reference) : "",
      amount: fmtAmount(total), message: clean(message, 140),
    },
  };
}
