#!/usr/bin/env node
// Prüft Lieferanten-Zertifikate (Ablauf-Warnung, Link-Prüfung) und Lieferverfolgung (Status, Tracking, Kundensicht ohne Lieferant)
// – Aufruf: node scripts/test-wp5.mjs  (npm run test:wp5)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { certState, certSummary, docsOf } from "../js/certs.js";
import { safeUrl, trackingHref, shipStatus, shipOverdue, customerShipment, hasShipment } from "../js/logistics.js";

// ---- Zertifikate
const today = "2026-11-05";
assert.equal(certState({ gueltigBis: "2026-11-04" }, today), "expired");
assert.equal(certState({ gueltigBis: "2026-11-05" }, today), "soon", "heute gültig, läuft bald ab");
assert.equal(certState({ gueltigBis: "2027-01-04" }, today), "soon", "60 Tage = noch Warnung");
assert.equal(certState({ gueltigBis: "2027-01-05" }, today), "ok");
assert.equal(certState({ gueltigBis: "" }, today), "");
assert.equal(certState({}, today), "");
assert.deepEqual(docsOf({}), [], "alte Lieferanten ohne Feld");
assert.deepEqual(docsOf({ dokumente: [null, 3, { name: "x" }] }).length, 1);
assert.deepEqual(certSummary({ dokumente: [{ gueltigBis: "2025-01-01" }, { gueltigBis: "2026-12-01" }, { gueltigBis: "2030-01-01" }, { name: "Katalog" }] }, today), { expired: 1, soon: 1 });

// ---- Links: nur http(s)
assert.equal(safeUrl("https://example.sharepoint.com/sites/x/Shared%20Documents/ISO9001.pdf"), "https://example.sharepoint.com/sites/x/Shared%20Documents/ISO9001.pdf");
for (const bad of ["javascript:alert(1)", "data:text/html,<b>", "ftp://x", "https://a b", "//evil.example", "", null, 'https://x.ch/"onmouseover=1']) assert.equal(safeUrl(bad), "", String(bad));

// ---- Lieferverfolgung
assert.equal(trackingHref({ spediteur: "DHL", trackingNr: "JJD 0123/45" }), "https://www.dhl.com/ch-de/home/tracking.html?tracking-id=JJD%200123%2F45");
assert.equal(trackingHref({ spediteur: "DHL", trackingNr: "1", trackingLink: "https://t.example/1" }), "https://t.example/1", "eigener Link hat Vorrang");
assert.equal(trackingHref({ spediteur: "DHL", trackingNr: "1", trackingLink: "javascript:1" }).startsWith("https://www.dhl.com"), true, "unsicherer eigener Link wird ignoriert");
assert.equal(trackingHref({ spediteur: "Andere", trackingNr: "1" }), "");
assert.equal(shipStatus({}), "");
assert.equal(shipStatus({ versandAm: "2026-11-01" }), "Versendet");
assert.equal(shipStatus({ versandAm: "2026-11-01", versandStatus: "Unterwegs" }), "Unterwegs");
assert.equal(shipStatus({ versandStatus: "Quatsch" }), "");
assert.equal(shipOverdue({ lieferungErwartet: "2026-11-01", versandAm: "2026-10-20" }, today), true);
assert.equal(shipOverdue({ lieferungErwartet: "2026-11-01", versandStatus: "Zugestellt" }, today), false);
assert.equal(shipOverdue({ lieferungErwartet: "2026-11-20" }, today), false);
assert.equal(hasShipment({ phase: "Angebot erhalten", leadTime: "6 Wochen" }), false, "alte Zuordnungen ohne Versandangaben");

// ---- Kundensicht: keine Lieferanten-/Herstellerangaben
const rfq = {
  id: "r1", customerId: "c1", supplierId: "s1", contactId: "k1", dealId: "d1", produkt: "Dichtung", angebot: 1234, waehrung: "CHF", moq: "100",
  kommentar: "Hersteller Muster AG in Shenzhen", naechsterSchritt: "Muster anfordern",
  versandAm: "2026-11-01", lieferungErwartet: "2026-11-12", spediteur: "DHL", trackingNr: "123", versandStatus: "Unterwegs",
};
const cs = customerShipment(rfq);
assert.deepEqual(Object.keys(cs).sort(), ["lieferungErwartet", "spediteur", "status", "trackingLink", "trackingNr", "versandAm"]);
const dump = JSON.stringify(cs);
for (const secret of ["s1", "Muster AG", "Shenzhen", "1234", "supplier", "Dichtung"]) assert.ok(!dump.includes(secret), `Kundensicht enthält «${secret}»`);
assert.equal(customerShipment({ phase: "x" }), null);

// ---- Statische Schranke: Kundendokumente (Druck, Rechnungen, Dokumente) verweisen nie auf Lieferanten, RFQs oder Lieferverfolgung
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "js");
for (const f of ["views/print.js", "views/docs.js", "views/invoices.js", "views/positions.js"]) {
  const src = readFileSync(join(root, f), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/suppliers|supplierId|rfqs|rfqContact|supplierLabel|supplierLink|spediteur|trackingNr|dokumente/.test(src), `${f} darf keine Lieferanten-/Logistikdaten verwenden`);
}

console.log("WP5-Tests (Zertifikate, Lieferverfolgung, Kundensicht): alle bestanden");
