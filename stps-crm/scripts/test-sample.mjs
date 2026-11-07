#!/usr/bin/env node
// Beispieldaten: gültig (normalizeDb + Server-isValidDb), Wechselkurse, AGB, Zertifikate, QR-Rechnung mit den Beispiel-IBANs – npm run test:sample
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeDb, getFx } from "../js/store.js";
import { isValidDb } from "../netlify/functions/lib/db.mjs";
import { prepareQrBill, isQrIban, isSwissIban } from "../js/qrbill.js";
import { CERT_TYPES } from "../js/certs.js";

const raw = JSON.parse(fs.readFileSync(new URL("../sample/beispieldaten.json", import.meta.url), "utf8"));
assert.ok(isValidDb(raw), "Rohdaten gültig");
const db = normalizeDb(raw);
assert.ok(isValidDb(db), "normalisiert gültig");
assert.deepEqual(db.settings.fx, { EUR: 0.93, USD: 0.8, date: "2026-11-02" });
const b = db.settings.billing;
assert.ok(b.agb.length > 500, "AGB-Text vorhanden");
const chf = b.banks.find((k) => k.waehrung === "CHF");
assert.equal(chf.iban, "CH93 0076 2011 6238 5295 7");
assert.equal(chf.qrIban, "CH44 3199 9123 0008 8901 2");
assert.ok(isSwissIban(chf.iban) && isQrIban(chf.qrIban));
const docs = db.suppliers.flatMap((s) => s.dokumente || []);
assert.ok(docs.length >= 6 && docs.every((d) => CERT_TYPES.includes(d.typ)), "Zertifikatstypen gültig");
assert.ok(docs.some((d) => d.intervall === 36) && docs.some((d) => d.intervall === 12), "Intervalle");
const inv = db.invoices.find((i) => i.waehrung === "CHF" && i.status === "Gesendet");
assert.ok(inv && inv.bankId === chf.id);
const r = prepareQrBill({ billing: b, bank: chf, currency: "CHF", nr: inv.nr, total: 1000, customer: db.customers[0], customerCountry: "CH", message: "" });
assert.ok(r.ok, JSON.stringify(r.warnings));
assert.equal(r.view.refType, "QRR");
console.log("test-sample: OK");
