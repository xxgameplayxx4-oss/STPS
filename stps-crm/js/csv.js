// CSV-Export (UTF-8 mit BOM, Semikolon als Trenner – öffnet sich direkt im Schweizer Excel) und Datei-Download.
import { all, byId, getBilling } from "./store.js";
import { fmtDate, todayISO } from "./util.js";
import { countryName } from "./countries.js";
import { contactsOf, primaryContact, deliveryAddresses, effectiveAddress, addressNr, weightedCustomer, weightedDeal, rfqContact, normChance, curOf } from "./model.js";
import { docTotals, lineTotal, invoiceStatus, margin } from "./billing.js";

const SEP = ";";

/** Zelle quoten; schützt vor Formel-Injektion (=, @, Tab/CR, sowie +/- ausser bei Zahlen/Telefonnummern). */
export function cell(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? String(v) : String(v);
  if (typeof v !== "number" && /^[=@\t\r]/.test(s)) s = "'" + s;
  else if (typeof v !== "number" && /^[+-]/.test(s) && !/^[+-]?[\d\s().\/-]+$/.test(s)) s = "'" + s;
  return /[";\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

export function downloadFile(filename, text, mime = "text/csv;charset=utf-8", bom = false) {
  const blob = new Blob([bom ? "﻿" : "", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const d = fmtDate;
const cust = (id) => byId("customers", id);
const supp = (id) => byId("suppliers", id);
const others = (rec) => contactsOf(rec).filter((c) => c !== primaryContact(rec)).map((c) => [c.name, c.funktion, c.email, c.telefon || c.mobile].filter(Boolean).join(" / ")).join(" | ");

export const CSV_TABLES = [
  {
    id: "kunden",
    headers: ["Kundennr.", "Kunde / Firma", "Kontaktperson", "E-Mail", "Telefon", "Weitere Kontakte", "Priorität", "Produkt / Projekt", "Phase", "Potenzial CHF", "Angebot CHF", "Nächster Schritt", "Termin", "Kommentar", "Verantwortlich", "Quelle", "Erstkontakt", "Letzter Kontakt", "Nächster Follow-up", "Chance %", "Gewichtete Pipeline CHF", "Kundenstatus", "Strasse", "PLZ", "Ort", "Land", "Währung", "Rechnungskontakt (Buchhaltung)"],
    rows: () => [...all("customers")].sort((a, b) => a.nr - b.nr).map((c) => {
      const p = primaryContact(c);
      return [c.nr, c.firma, p?.name, p?.email, p?.telefon || p?.mobile, others(c), c.prioritaet, c.produkt, c.phase, c.potenzial, c.angebot, c.naechsterSchritt, d(c.termin), c.kommentar, c.owner, c.quelle, d(c.erstkontakt), d(c.letzterKontakt), d(c.followUp), normChance(c.chance, c.phase), weightedCustomer(c), c.status, c.strasse, c.plz, c.ort, countryName(c.land), curOf(c), contactsOf(c).find((k) => k.rechnung)?.name];
    }),
  },
  {
    id: "lieferadressen",
    headers: ["Kundennr.", "Kunde", "Adressnr.", "Bezeichnung", "Strasse", "PLZ", "Ort", "Land", "Gleich wie Rechnungsadresse", "Kontaktperson", "Aktiv", "Lieferhinweis"],
    rows: () => [...all("customers")].sort((a, b) => a.nr - b.nr).flatMap((c) => deliveryAddresses(c).map((a) => {
      const e = effectiveAddress(c, a);
      return [c.nr, c.firma, addressNr(c, a), a.bezeichnung, e.strasse, e.plz, e.ort, countryName(e.land), a.same ? "Ja" : "Nein", contactsOf(c).find((k) => k.id === a.contactId)?.name, a.aktiv === false ? "Nein" : "Ja", a.notiz];
    })),
  },
  {
    id: "kontakte",
    headers: ["Typ", "Nr.", "Firma", "Name", "Funktion / Rolle", "E-Mail", "Telefon", "Mobile", "Notiz", "Hauptkontakt", "Rechnungskontakt"],
    rows: () => [
      ...[...all("customers")].sort((a, b) => a.nr - b.nr).flatMap((c) => contactsOf(c).map((k) => ["Kunde", c.nr, c.firma, k.name, k.funktion, k.email, k.telefon, k.mobile, k.notiz, k.primary ? "Ja" : "Nein", k.rechnung ? "Ja" : "Nein"])),
      ...[...all("suppliers")].sort((a, b) => a.nr - b.nr).flatMap((s) => contactsOf(s).map((k) => ["Lieferant", s.nr, s.firma, k.name, k.funktion, k.email, k.telefon, k.mobile, k.notiz, k.primary ? "Ja" : "Nein", k.rechnung ? "Ja" : "Nein"])),
    ],
  },
  {
    id: "angebote",
    headers: ["Angebotsnr.", "Kundennr.", "Kunde", "Projekt / Produkt", "Angebot erstellt", "Angebot gesendet", "Angebotswert CHF", "Phase", "Chance %", "Gewichteter Wert CHF", "Erwarteter Abschluss", "Nächster Schritt", "Owner", "Kommentar", "Währung"],
    rows: () => [...all("deals")].sort((a, b) => a.nr - b.nr).map((x) => [x.nr, cust(x.customerId)?.nr, cust(x.customerId)?.firma, x.produkt, d(x.erstellt), d(x.gesendet), x.wert, x.phase, normChance(x.chance, x.phase), weightedDeal(x), d(x.erwarteterAbschluss), x.naechsterSchritt, x.owner, x.kommentar, curOf(x)]),
  },
  {
    id: "lieferanten",
    headers: ["Lieferant / Firma", "Lieferantennr.", "Kontaktperson", "E-Mail", "Telefon", "Weitere Kontakte", "Ort / Land", "Produkte / Verfahren", "Qualität / Zertifikate", "Status", "Notiz", "Verantwortlich", "Lieferant seit", "Bewertung 1–5", "Letzter Kontakt", "Nächster Follow-up", "Zahlungskonditionen"],
    rows: () => [...all("suppliers")].sort((a, b) => a.nr - b.nr).map((s) => {
      const p = primaryContact(s);
      return [s.firma, s.nr, p?.name, p?.email, p?.telefon || p?.mobile, others(s), s.ort, s.produkte, s.qualitaet, s.status, s.notiz, s.owner, d(s.seit), s.bewertung, d(s.letzterKontakt), d(s.followUp), s.zahlungskonditionen];
    }),
  },
  {
    id: "lieferantenzuordnung",
    headers: ["Kundennr.", "Kunde", "Lieferant", "Lieferantennr.", "Kontaktperson Lieferant", "E-Mail Lieferant", "Angebotsnr.", "Produkt / Projekt", "Lieferantenphase", "Angebot gesendet am", "Angebot erhalten am", "Angebot Lieferant", "Währung", "MOQ", "Lead Time", "Nächster Schritt", "Kommentar / Qualität"],
    rows: () => all("rfqs").map((r) => {
      const k = rfqContact(r);
      return [cust(r.customerId)?.nr, cust(r.customerId)?.firma, supp(r.supplierId)?.firma, supp(r.supplierId)?.nr, k?.name, k?.email, byId("deals", r.dealId)?.nr, r.produkt, r.phase, d(r.gesendetAm), d(r.erhaltenAm), r.angebot, r.waehrung, r.moq, r.leadTime, r.naechsterSchritt, r.kommentar];
    }).sort((a, b) => (a[0] || 0) - (b[0] || 0)),
  },
  {
    id: "aktivitaeten",
    headers: ["Aktivitätsnr.", "Datum", "Typ", "Kundennr.", "Kunde", "Lieferantennr.", "Lieferant", "Kontaktperson", "Ort", "Owner", "Notiz", "Nächster Schritt", "Fällig am", "Status"],
    rows: () => [...all("activities")].sort((a, b) => a.nr - b.nr).map((a) => [a.nr, d(a.datum), a.typ, cust(a.customerId)?.nr, cust(a.customerId)?.firma, supp(a.supplierId)?.nr, supp(a.supplierId)?.firma, [cust(a.customerId), supp(a.supplierId)].flatMap(contactsOf).find((k) => k.id === a.contactId)?.name, a.ort, a.owner, a.notiz, a.naechsterSchritt, d(a.faellig), a.status]),
  },
  {
    id: "aufgaben",
    headers: ["Aufgabennr.", "Fällig am", "Owner", "Kundennr.", "Kunde", "Lieferant", "Aufgabe", "Priorität", "Status", "Erledigt am", "Kommentar"],
    rows: () => [...all("tasks")].sort((a, b) => a.nr - b.nr).map((t) => [t.nr, d(t.faellig), t.owner, cust(t.customerId)?.nr, cust(t.customerId)?.firma, supp(t.supplierId)?.firma, t.aufgabe, t.prioritaet, t.status, d(t.erledigtAm), t.kommentar]),
  },
  {
    id: "wochenfokus",
    headers: ["Kundennr.", "Kunde", "Entscheid / Blocker", "Owner", "Diese Woche", "Kommentar"],
    rows: () => all("focus").map((f) => [cust(f.customerId)?.nr, cust(f.customerId)?.firma, f.blocker, f.owner, f.diese, f.kommentar]),
  },
  {
    id: "freigaben",
    headers: ["Kundennr.", "Thema", "Entscheidung / Aufgabe", "Termin", "Status"],
    rows: () => all("approvals").map((a) => [cust(a.customerId)?.nr, a.thema, a.entscheidung, d(a.termin), a.status]),
  },
];

/** Positionen aller Offerten (mit Positionen) und Rechnungen: eine Zeile je Position (Brutto/Netto je Einheit, Total = Menge × Netto). Nie der Einkaufspreis. */
const positionRows = () => [
  ...[...all("deals")].sort((a, b) => a.nr - b.nr).flatMap((x) => (x.positions || []).map((p, i) => ["Offerte", x.nr, cust(x.customerId)?.nr, cust(x.customerId)?.firma, i + 1, p.artNr, p.bezeichnung, p.menge, p.einheit, p.brutto, p.rabatt, p.netto, lineTotal(p).netto])),
  ...[...all("invoices")].sort((a, b) => a.nr - b.nr).flatMap((x) => (x.positions || []).map((p, i) => ["Rechnung", x.nr, cust(x.customerId)?.nr, cust(x.customerId)?.firma, i + 1, p.artNr, p.bezeichnung, p.menge, p.einheit, p.brutto, p.rabatt, p.netto, lineTotal(p).netto])),
];

export const CSV_BILLING_TABLES = [
  {
    id: "artikel",
    headers: ["Artikelnr.", "Bezeichnung", "Beschreibung", "Warengruppe", "Einheit", "Kundennr.", "Kunde", "Lieferantennr.", "Lieferant", "Artikelnr. Lieferant", "Währung", "Einkaufspreis (EK)", "Bruttopreis", "Rabatt %", "Nettopreis", "Marge", "Marge %", "Notiz"],
    rows: () => [...all("articles")].sort((a, b) => (a.nr ?? 0) - (b.nr ?? 0)).map((a) => {
      const m = margin(a);
      const g = getBilling().warengruppen.find((x) => x.id === a.warengruppeId);
      return [a.nr, a.bezeichnung, a.beschreibung, g?.code, a.einheit, cust(a.customerId)?.nr, cust(a.customerId)?.firma, supp(a.supplierId)?.nr, supp(a.supplierId)?.firma, a.lieferantenArtNr, a.waehrung, a.ek, a.brutto, a.rabatt, a.netto, m.betrag, m.prozent, a.notiz];
    }),
  },
  {
    id: "rechnungen",
    headers: ["Rechnungsnr.", "Rechnungsdatum", "Fällig am", "Status", "Kundennr.", "Kunde", "Angebotsnr.", "Referenz", "Brutto", "Rabatt", "Netto", "MWST", "Total", "MWST-Satz %", "Bemerkung"],
    rows: () => [...all("invoices")].sort((a, b) => a.nr - b.nr).map((i) => {
      const tt = docTotals(i.positions, i);
      return [i.nr, d(i.datum), d(i.faellig), invoiceStatus(i, todayISO()), cust(i.customerId)?.nr, cust(i.customerId)?.firma, byId("deals", i.dealId)?.nr, i.referenz, tt.brutto, tt.rabatt, tt.netto, tt.mwst, tt.total, i.mwstAktiv ? i.mwstSatz : "", i.bemerkung];
    }),
  },
  {
    id: "positionen",
    headers: ["Beleg", "Belegnr.", "Kundennr.", "Kunde", "Pos.", "Artikelnr.", "Bezeichnung", "Menge", "Einheit", "Brutto je Einheit", "Rabatt %", "Netto je Einheit", "Total netto"],
    rows: positionRows,
  },
];
CSV_TABLES.push(...CSV_BILLING_TABLES);

export function exportCsv(id) {
  const t = CSV_TABLES.find((x) => x.id === id);
  if (!t) return;
  const day = new Date().toISOString().slice(0, 10);
  downloadFile(`stps-${t.id}-${day}.csv`, toCsv(t.headers, t.rows()), "text/csv;charset=utf-8", true);
}
