// STPS CRM – Excel-Export im Layout der Vorlage STPS_CRM_v.1.0.
//
// Ein Blatt pro Tabelle (gleiche Blattnamen, Kopfzeile in Zeile 4, bei «Aufgaben» in Zeile 3, gleiche Spalten wie die Vorlage),
// ergänzt um Zusatzspalten am Ende («Weitere Kontakte», «Angebotsnr.», «Lieferantennr.») und ein Blatt «Kontakte» mit allen
// Kontaktpersonen. Alle Werte sind feste Werte (keine Formeln). Das Ergebnis lässt sich mit xlsx-import.mjs wieder einlesen.
import { zurichDate } from "./db.mjs";
import { fmtArtNr, docTotals, lineTotal, invoiceStatus, margin } from "../../../js/billing.js";

const RED = "FFE30613";
const DARK = "FF1E1E1E";
const WHITE = "FFFFFFFF";
const CHF = '#,##0\\ "CHF"';
const DATE = "dd\\.mm\\.yyyy";
const MONEY = "#,##0.00";

const byNr = (a, b) => (a.nr ?? 0) - (b.nr ?? 0);
const dateOf = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const blank = (v) => (v === undefined || v === null || v === "" ? null : v);
const numOrNull = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

const contactsOf = (rec) => (Array.isArray(rec?.contacts) ? rec.contacts : []);
const primaryContact = (rec) => contactsOf(rec).find((c) => c.primary) || contactsOf(rec)[0] || null;
const otherContacts = (rec) => {
  const p = primaryContact(rec);
  return contactsOf(rec)
    .filter((c) => c !== p)
    .map((c) => [c.name, c.funktion, c.email, c.telefon || c.mobile].filter(Boolean).join(" / "))
    .join(" | ");
};

/** Spaltendefinition: [Titel, Breite, Format|null, Getter, wrap?] */
const col = (header, width, fmt, get, wrap = false) => ({ header, width, fmt, get, wrap });

function sheetDefs(db, today = zurichDate()) {
  const customers = [...db.customers].sort(byNr);
  const suppliers = [...db.suppliers].sort(byNr);
  const cust = new Map(db.customers.map((c) => [c.id, c]));
  const supp = new Map(db.suppliers.map((s) => [s.id, s]));
  const deal = new Map(db.deals.map((d) => [d.id, d]));
  const group = new Map((db.settings?.billing?.warengruppen || []).map((g) => [g.id, g]));
  const articles = [...db.articles].sort((a, b) => (a.nr ?? 0) - (b.nr ?? 0));
  const invoices = [...db.invoices].sort(byNr);
  const totals = (r) => docTotals(r.positions, r);
  // Eine Zeile je Position – Offerten (mit Positionen) und Rechnungen. Der Einkaufspreis gehört nie in Belegdaten.
  const posRows = [
    ...[...db.deals].sort(byNr).flatMap((x) => (Array.isArray(x.positions) ? x.positions : []).map((p, i) => ({ beleg: "Offerte", doc: x, pos: i + 1, p }))),
    ...invoices.flatMap((x) => (Array.isArray(x.positions) ? x.positions : []).map((p, i) => ({ beleg: "Rechnung", doc: x, pos: i + 1, p }))),
  ];
  const weighted = (base, chance) => (numOrNull(base) === null || numOrNull(chance) === null ? null : (Number(base) * Number(chance)) / 100);
  const chanceCell = (v) => (numOrNull(v) === null ? null : Number(v) / 100);
  const d = (key) => (r) => dateOf(r[key]);

  const contactRows = [
    ...customers.flatMap((c) => contactsOf(c).map((k) => ({ typ: "Kunde", kundennr: c.nr, lieferantennr: null, firma: c.firma, k }))),
    ...suppliers.flatMap((s) => contactsOf(s).map((k) => ({ typ: "Lieferant", kundennr: null, lieferantennr: s.nr, firma: s.firma, k }))),
  ];

  return [
    {
      name: "Kunden", title: "KUNDEN & SALES PIPELINE – Pascal", headerRow: 4, rows: customers,
      columns: [
        col("Kundennr.", 12, "0", (r) => r.nr),
        col("Kunde / Firma", 30, null, (r) => blank(r.firma)),
        col("Kontaktperson", 22, null, (r) => blank(primaryContact(r)?.name)),
        col("E-Mail", 28, null, (r) => blank(primaryContact(r)?.email)),
        col("Telefon", 18, null, (r) => blank(primaryContact(r)?.telefon || primaryContact(r)?.mobile)),
        col("Priorität", 10, null, (r) => blank(r.prioritaet)),
        col("Produkt / Projekt", 28, null, (r) => blank(r.produkt), true),
        col("Phase", 22, null, (r) => blank(r.phase)),
        col("Potenzial CHF", 16, CHF, (r) => numOrNull(r.potenzial)),
        col("Angebot CHF", 16, CHF, (r) => numOrNull(r.angebot)),
        col("Nächster Schritt", 30, null, (r) => blank(r.naechsterSchritt), true),
        col("Termin", 13, DATE, d("termin")),
        col("Kommentar", 34, null, (r) => blank(r.kommentar), true),
        col("Verantwortlich", 15, null, (r) => blank(r.owner)),
        col("Quelle", 22, null, (r) => blank(r.quelle)),
        col("Erstkontakt", 13, DATE, d("erstkontakt")),
        col("Letzter Kontakt", 13, DATE, d("letzterKontakt")),
        col("Nächster Follow-up", 13, DATE, d("followUp")),
        col("Chance %", 11, "0%", (r) => chanceCell(r.chance)),
        col("Gewichtete Pipeline CHF", 20, CHF, (r) => weighted(r.potenzial, r.chance)),
        col("Kundenstatus", 16, null, (r) => blank(r.status)),
        col("Weitere Kontakte", 44, null, (r) => blank(otherContacts(r)), true),
      ],
    },
    {
      name: "Lieferantenstamm", title: "LIEFERANTENSTAMM – Liz", headerRow: 4, rows: suppliers,
      columns: [
        col("Lieferant / Firma", 30, null, (r) => blank(r.firma)),
        col("Lieferantennr.", 14, "0", (r) => r.nr),
        col("Kontaktperson", 22, null, (r) => blank(primaryContact(r)?.name)),
        col("E-Mail", 28, null, (r) => blank(primaryContact(r)?.email)),
        col("Telefon", 18, null, (r) => blank(primaryContact(r)?.telefon || primaryContact(r)?.mobile)),
        col("Ort / Land", 20, null, (r) => blank(r.ort)),
        col("Produkte / Verfahren", 34, null, (r) => blank(r.produkte), true),
        col("Qualität / Zertifikate", 28, null, (r) => blank(r.qualitaet), true),
        col("Status", 14, null, (r) => blank(r.status)),
        col("Notiz", 40, null, (r) => blank(r.notiz), true),
        col("Verantwortlich", 15, null, (r) => blank(r.owner)),
        col("Lieferant seit", 13, DATE, d("seit")),
        col("Bewertung 1–5", 14, "0", (r) => numOrNull(r.bewertung)),
        col("Letzter Kontakt", 13, DATE, d("letzterKontakt")),
        col("Nächster Follow-up", 13, DATE, d("followUp")),
        col("Zahlungskonditionen", 24, null, (r) => blank(r.zahlungskonditionen)),
        col("Weitere Kontakte", 44, null, (r) => blank(otherContacts(r)), true),
      ],
    },
    {
      name: "Lieferanten", title: "LIEFERANTENZUORDNUNG – Liz", headerRow: 4,
      rows: [...db.rfqs].sort((a, b) => (cust.get(a.customerId)?.nr ?? 0) - (cust.get(b.customerId)?.nr ?? 0) || (supp.get(a.supplierId)?.nr ?? 0) - (supp.get(b.supplierId)?.nr ?? 0)),
      columns: [
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 28, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Lieferant auswählen", 28, null, (r) => blank(supp.get(r.supplierId)?.firma)),
        col("Lieferantennr.", 14, "0", (r) => supp.get(r.supplierId)?.nr ?? null),
        col("Kontaktperson Lieferant", 24, null, (r) => {
          const s = supp.get(r.supplierId);
          return blank((contactsOf(s).find((c) => c.id === r.contactId) || primaryContact(s))?.name);
        }),
        col("E-Mail Lieferant", 28, null, (r) => {
          const s = supp.get(r.supplierId);
          return blank((contactsOf(s).find((c) => c.id === r.contactId) || primaryContact(s))?.email);
        }),
        col("Produkt / Projekt", 28, null, (r) => blank(r.produkt), true),
        col("Lieferantenphase", 22, null, (r) => blank(r.phase)),
        col("Angebot gesendet am", 14, DATE, d("gesendetAm")),
        col("Angebot erhalten am", 14, DATE, d("erhaltenAm")),
        col("Angebot Lieferant", 16, "#,##0.00", (r) => numOrNull(r.angebot)),
        col("Währung", 10, null, (r) => blank(r.waehrung)),
        col("MOQ", 12, null, (r) => blank(r.moq)),
        col("Lead Time", 15, null, (r) => blank(r.leadTime)),
        col("Nächster Schritt", 30, null, (r) => blank(r.naechsterSchritt), true),
        col("Kommentar / Qualität", 34, null, (r) => blank(r.kommentar), true),
        col("Angebotsnr.", 13, "0", (r) => deal.get(r.dealId)?.nr ?? null),
      ],
    },
    {
      name: "Aktivitäten", title: "CRM – AKTIVITÄTEN / KONTAKTHISTORIE", headerRow: 4, rows: [...db.activities].sort(byNr),
      columns: [
        col("Aktivitätsnr.", 13, "0", (r) => r.nr),
        col("Datum", 13, DATE, d("datum")),
        col("Typ", 18, null, (r) => blank(r.typ)),
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Lieferantennr.", 14, "0", (r) => supp.get(r.supplierId)?.nr ?? null),
        col("Lieferant", 26, null, (r) => blank(supp.get(r.supplierId)?.firma)),
        col("Owner", 13, null, (r) => blank(r.owner)),
        col("Notiz", 40, null, (r) => blank(r.notiz), true),
        col("Nächster Schritt", 32, null, (r) => blank(r.naechsterSchritt), true),
        col("Fällig am", 13, DATE, d("faellig")),
        col("Status", 13, null, (r) => blank(r.status)),
      ],
    },
    {
      name: "Angebote", title: "CRM – KUNDENANGEBOTE / DEALS", headerRow: 4, rows: [...db.deals].sort(byNr),
      columns: [
        col("Angebotsnr.", 13, "0", (r) => r.nr),
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Projekt / Produkt", 30, null, (r) => blank(r.produkt), true),
        col("Angebot erstellt", 14, DATE, d("erstellt")),
        col("Angebot gesendet", 14, DATE, d("gesendet")),
        col("Angebotswert CHF", 18, CHF, (r) => numOrNull(r.wert)),
        col("Phase", 22, null, (r) => blank(r.phase)),
        col("Chance %", 11, "0%", (r) => chanceCell(r.chance)),
        col("Gewichteter Wert CHF", 20, CHF, (r) => weighted(r.wert, r.chance)),
        col("Erwarteter Abschluss", 16, DATE, d("erwarteterAbschluss")),
        col("Nächster Schritt", 30, null, (r) => blank(r.naechsterSchritt), true),
        col("Owner", 13, null, (r) => blank(r.owner)),
        col("Kommentar", 34, null, (r) => blank(r.kommentar), true),
      ],
    },
    {
      name: "Aufgaben", title: "CRM – AUFGABEN / FOLLOW-UPS", headerRow: 3, rows: [...db.tasks].sort(byNr),
      columns: [
        col("Aufgabennr.", 13, "0", (r) => r.nr),
        col("Fällig am", 13, DATE, d("faellig")),
        col("Owner", 13, null, (r) => blank(r.owner)),
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Lieferant", 26, null, (r) => blank(supp.get(r.supplierId)?.firma)),
        col("Aufgabe", 40, null, (r) => blank(r.aufgabe), true),
        col("Priorität", 10, null, (r) => blank(r.prioritaet)),
        col("Status", 13, null, (r) => blank(r.status)),
        col("Erledigt am", 13, DATE, d("erledigtAm")),
        col("Kommentar", 34, null, (r) => blank(r.kommentar), true),
        col("Lieferantennr.", 14, "0", (r) => supp.get(r.supplierId)?.nr ?? null),
      ],
    },
    {
      name: "Kontakte", title: "KONTAKTPERSONEN (Kunden und Lieferanten)", headerRow: 4, rows: contactRows,
      columns: [
        col("Typ", 11, null, (r) => r.typ),
        col("Kundennr.", 12, "0", (r) => r.kundennr),
        col("Lieferantennr.", 14, "0", (r) => r.lieferantennr),
        col("Firma", 30, null, (r) => blank(r.firma)),
        col("Name", 24, null, (r) => blank(r.k.name)),
        col("Funktion / Rolle", 24, null, (r) => blank(r.k.funktion)),
        col("E-Mail", 28, null, (r) => blank(r.k.email)),
        col("Telefon", 18, null, (r) => blank(r.k.telefon)),
        col("Mobile", 18, null, (r) => blank(r.k.mobile)),
        col("Notiz", 34, null, (r) => blank(r.k.notiz), true),
        col("Hauptkontakt", 13, null, (r) => (r.k.primary ? "Ja" : "Nein")),
      ],
    },
    {
      name: "Wochenfokus", title: "WÖCHENTLICHER KUNDENFOKUS", headerRow: 4, rows: db.focus,
      columns: [
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 28, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Entscheid / Blocker", 34, null, (r) => blank(r.blocker), true),
        col("Owner", 13, null, (r) => blank(r.owner)),
        col("Diese Woche", 13, null, (r) => blank(r.diese)),
        col("Kommentar", 34, null, (r) => blank(r.kommentar), true),
      ],
    },
    {
      name: "Freigaben", title: "MARCO – ADMIN / FREIGABEN / ENTSCHEIDE", headerRow: 4, rows: db.approvals,
      columns: [
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Thema", 34, null, (r) => blank(r.thema), true),
        col("Entscheidung / Aufgabe", 40, null, (r) => blank(r.entscheidung), true),
        col("Termin", 13, DATE, d("termin")),
        col("Status", 13, null, (r) => blank(r.status)),
      ],
    },
    {
      name: "Artikel", title: "ARTIKEL (intern – mit Einkaufspreis)", headerRow: 4, rows: articles,
      columns: [
        col("Artikelnr.", 12, null, (r) => blank(fmtArtNr(r.nr))),
        col("Bezeichnung", 34, null, (r) => blank(r.bezeichnung), true),
        col("Beschreibung", 40, null, (r) => blank(r.beschreibung), true),
        col("Warengruppe", 16, null, (r) => blank(group.get(r.warengruppeId)?.code)),
        col("Einheit", 10, null, (r) => blank(r.einheit)),
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Lieferantennr.", 14, "0", (r) => supp.get(r.supplierId)?.nr ?? null),
        col("Lieferant", 26, null, (r) => blank(supp.get(r.supplierId)?.firma)),
        col("Artikelnr. Lieferant", 18, null, (r) => blank(r.lieferantenArtNr)),
        col("Währung", 9, null, (r) => blank(r.waehrung)),
        col("Einkaufspreis (EK)", 16, MONEY, (r) => numOrNull(r.ek)),
        col("Bruttopreis", 14, MONEY, (r) => numOrNull(r.brutto)),
        col("Rabatt %", 10, "0.##", (r) => numOrNull(r.rabatt)),
        col("Nettopreis", 14, MONEY, (r) => numOrNull(r.netto)),
        col("Marge", 12, MONEY, (r) => margin(r).betrag),
        col("Marge %", 10, "0.##", (r) => margin(r).prozent),
        col("Notiz", 34, null, (r) => blank(r.notiz), true),
      ],
    },
    {
      name: "Rechnungen", title: "RECHNUNGEN", headerRow: 4, rows: invoices,
      columns: [
        col("Rechnungsnr.", 13, "0", (r) => r.nr),
        col("Rechnungsdatum", 15, DATE, d("datum")),
        col("Fällig am", 13, DATE, d("faellig")),
        col("Status", 13, null, (r) => invoiceStatus(r, today)),
        col("Kundennr.", 12, "0", (r) => cust.get(r.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.customerId)?.firma)),
        col("Angebotsnr.", 13, "0", (r) => deal.get(r.dealId)?.nr ?? null),
        col("Referenz", 20, null, (r) => blank(r.referenz)),
        col("Brutto", 14, MONEY, (r) => totals(r).brutto),
        col("Rabatt", 14, MONEY, (r) => totals(r).rabatt),
        col("Netto", 14, MONEY, (r) => totals(r).netto),
        col("MWST-Satz %", 12, "0.##", (r) => (r.mwstAktiv ? numOrNull(r.mwstSatz) : null)),
        col("MWST", 14, MONEY, (r) => totals(r).mwst),
        col("Total", 14, MONEY, (r) => totals(r).total),
        col("Bemerkung", 34, null, (r) => blank(r.bemerkung), true),
      ],
    },
    {
      name: "Positionen", title: "POSITIONEN (Offerten und Rechnungen)", headerRow: 4, rows: posRows,
      columns: [
        col("Beleg", 11, null, (r) => r.beleg),
        col("Belegnr.", 11, "0", (r) => r.doc.nr),
        col("Kundennr.", 12, "0", (r) => cust.get(r.doc.customerId)?.nr ?? null),
        col("Kunde", 26, null, (r) => blank(cust.get(r.doc.customerId)?.firma)),
        col("Pos.", 7, "0", (r) => r.pos),
        col("Artikelnr.", 12, null, (r) => blank(fmtArtNr(r.p.artNr))),
        col("Bezeichnung", 36, null, (r) => blank(r.p.bezeichnung), true),
        col("Menge", 9, "0.##", (r) => numOrNull(r.p.menge)),
        col("Einheit", 9, null, (r) => blank(r.p.einheit)),
        col("Brutto je Einheit", 16, MONEY, (r) => numOrNull(r.p.brutto)),
        col("Rabatt %", 10, "0.##", (r) => numOrNull(r.p.rabatt)),
        col("Netto je Einheit", 16, MONEY, (r) => numOrNull(r.p.netto)),
        col("Total netto", 14, MONEY, (r) => lineTotal(r.p).netto),
      ],
    },
  ];
}

/** Dateinamen des Exports (Datum in Zürcher Zeit) */
export function exportFileNames(now = new Date()) {
  const day = zurichDate(now);
  return { day, xlsx: `STPS_CRM_Export_${day}.xlsx`, json: `STPS_CRM_Export_${day}.json`, current: "STPS_CRM_aktuell.xlsx" };
}

/**
 * Erzeugt die Excel-Arbeitsmappe.
 * @param db   Datenbank (Struktur wie im Blob «db»)
 * @returns {Promise<Buffer>}
 */
export async function buildWorkbookBuffer(db, { now = new Date() } = {}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "STPS CRM";
  wb.created = new Date(now);
  const stamp = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" }).format(now);
  const safe = (x) => ({ ...x, customers: x.customers || [], suppliers: x.suppliers || [], rfqs: x.rfqs || [], deals: x.deals || [], activities: x.activities || [], tasks: x.tasks || [], focus: x.focus || [], approvals: x.approvals || [], articles: x.articles || [], invoices: x.invoices || [] });

  for (const def of sheetDefs(safe(db), zurichDate(now))) {
    const ws = wb.addWorksheet(def.name, { views: [{ state: "frozen", ySplit: def.headerRow }] });
    const n = def.columns.length;
    def.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

    ws.mergeCells(1, 1, 1, Math.min(n, 12));
    const title = ws.getCell(1, 1);
    title.value = def.title;
    title.font = { name: "Calibri", size: 16, bold: true, color: { argb: WHITE } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    title.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;

    ws.mergeCells(2, 1, 2, Math.min(n, 12));
    const note = ws.getCell(2, 1);
    note.value = `Export aus dem STPS CRM vom ${stamp}. Das CRM ist führend – Änderungen in dieser Datei werden nur über Einstellungen → Excel-Datei importieren übernommen.`;
    note.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5D6C82" } };

    const head = ws.getRow(def.headerRow);
    def.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });
    head.height = 27.6;

    def.rows.forEach((rec, ri) => {
      const row = ws.getRow(def.headerRow + 1 + ri);
      def.columns.forEach((c, i) => {
        const v = c.get(rec);
        if (v === null || v === undefined) return;
        const cell = row.getCell(i + 1);
        cell.value = v;
        if (c.fmt) cell.numFmt = c.fmt;
        if (c.header === "Chance %") cell.numFmt = Number.isInteger(Math.round(v * 1e6) / 1e4) ? "0%" : "0.0%";
        if (c.wrap) cell.alignment = { vertical: "top", wrapText: true };
        else cell.alignment = { vertical: "top" };
      });
    });

    ws.autoFilter = { from: { row: def.headerRow, column: 1 }, to: { row: def.headerRow + Math.max(def.rows.length, 1), column: n } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Vollständige JSON-Sicherung (gleiches Format wie «JSON exportieren» in den Einstellungen) */
export const buildJsonBackup = (db) => JSON.stringify(db, null, 2);
