#!/usr/bin/env node
// Prüft Beleg-Logik (WP2): MWST nach Land, Währung/Bankkonto, Absenderadresse, Migration alter Einstellungen, Aufbewahrung
// Aufruf: node scripts/test-billing-docs.mjs
import assert from "node:assert/strict";
import * as B from "../js/billing.js";

// MWST nach Land: Code oder Name, CH/LI = Inland
for (const l of ["CH", "ch", "Schweiz", "Switzerland", "Liechtenstein", "LI"]) assert.equal(B.vatByCountry(l), true, l);
for (const l of ["DE", "Deutschland", "Germany", "AT", "Österreich", "Atlantis"]) assert.equal(B.vatByCountry(l), false, l);
assert.equal(B.vatByCountry(""), null);
assert.equal(B.vatByCountry(undefined), null);

// Währung
assert.equal(B.docCurrency({}), "CHF");
assert.equal(B.docCurrency({ waehrung: "EUR" }), "EUR");
assert.equal(B.docCurrency({ waehrung: "VND" }), "CHF");

// Alte Einstellungen: plzOrt → plz/ort, iban/bank → ein CHF-Konto
const old = B.normalizeBilling({ firma: "X", plzOrt: "8807 Freienbach", iban: "CH93 0076 2011 6238 5295 7", bank: "UBS" });
assert.equal(old.plz, "8807"); assert.equal(old.ort, "Freienbach"); assert.equal(B.senderCityLine(old), "CH-8807 Freienbach");
assert.deepEqual(old.banks.map((k) => [k.bank, k.waehrung]), [["UBS", "CHF"]]);
assert.equal(old.uid, ""); assert.equal(old.handelsregister, "");
assert.equal(B.normalizeBilling({ plzOrt: "CH-8807 Freienbach" }).ort, "Freienbach");
assert.equal(B.senderCityLine(B.normalizeBilling(null)), "");

// Bankkonto nach Währung
const b = B.normalizeBilling({
  banks: [
    { id: "a", bank: "UBS", iban: "CH1", bic: "UBSWCHZH", waehrung: "CHF" },
    { id: "b", bank: "Deutsche Bank", iban: "DE1", bic: "DEUTDEFF", waehrung: "EUR" },
    { id: "c", bank: "Valiant", iban: "CH2", bic: "VABECH22", waehrung: "CHF" },
  ],
});
assert.equal(B.bankFor(b, "EUR").id, "b");
assert.equal(B.bankFor(b, "CHF").id, "a");
assert.equal(B.bankFor(b, "CHF", "c").id, "c");
assert.equal(B.bankFor(b, "EUR", "c").id, "b"); // Konto passt nicht zur Währung
assert.equal(B.bankFor(b, "USD"), null);

// Aufbewahrung: nur Entwürfe löschbar
assert.equal(B.isRetainedInvoice({ status: "Entwurf" }), false);
for (const s of ["Gesendet", "Bezahlt", "Storniert"]) assert.equal(B.isRetainedInvoice({ status: s }), true);
console.log("test-billing-docs: OK");
