#!/usr/bin/env node
// Prüft die QR-Rechnung (WP-B): Prüfziffern, IBAN/QR-IBAN, Payload (Zeilenfolge nach Swiss Implementation Guidelines QR-bill v2.3),
// QR-Encoder (Kapazitäten, Roundtrip über einen unabhängigen Decoder, Fehlerkorrektur bei verdeckter Mitte / Schweizer Kreuz).
// Aufruf: node scripts/test-qrbill.mjs
import assert from "node:assert/strict";
import * as Q from "../js/qrbill.js";
import * as B from "../js/billing.js";
import { encode, dataCapacity } from "../js/vendor/qr-encoder.js";
import { decodeMatrix } from "./lib/qr-decode.mjs";

// ---- Prüfziffer Modulo 10 rekursiv: Beispiel der Spezifikation (Referenz 21 00000 00003 13947 14300 09017)
assert.equal(Q.mod10Check("21000000000313947143000901"), 7);
assert.ok(Q.isValidQrr("210000000003139471430009017"));
assert.ok(!Q.isValidQrr("210000000003139471430009018"));
assert.ok(!Q.isValidQrr("21000000000313947143000901")); // 26 Stellen
assert.equal(Q.fmtQrr("210000000003139471430009017"), "21 00000 00003 13947 14300 09017");
assert.equal(Q.mod10Check("0"), 0);
// Rechnungsnummer 60000 → 26 Stellen + Prüfziffer, Prüfziffer stimmt
const r60000 = Q.qrrReference(60000);
assert.equal(r60000.length, 27);
assert.equal(r60000.slice(0, 26), "00000000000000000000060000");
assert.ok(Q.isValidQrr(r60000));
assert.equal(Q.qrrReference("abc"), null);
assert.equal(Q.qrrReference("1".repeat(27)), null);
// jede einzelne Ziffernänderung wird erkannt (Mod10 erkennt alle Einzelfehler)
for (let i = 0; i < 27; i++) for (const d of "0123456789") if (d !== r60000[i]) assert.ok(!Q.isValidQrr(r60000.slice(0, i) + d + r60000.slice(i + 1)), `${i}${d}`);

// ---- Creditor Reference ISO 11649: Beispiel der Norm RF18 5390 0754 7034
assert.equal(Q.scorReference("539007547034"), "RF18539007547034");
assert.equal(Q.fmtScor("RF18539007547034"), "RF18 5390 0754 7034");
assert.ok(Q.isValidScor("RF18539007547034"));
assert.ok(!Q.isValidScor("RF19539007547034"));
assert.ok(Q.isValidScor(Q.scorReference("60000")));
assert.equal(Q.scorReference("a".repeat(22)), null);

// ---- IBAN, QR-IBAN (IID 30000–31999)
assert.ok(Q.isSwissIban("CH93 0076 2011 6238 5295 7"));
assert.ok(!Q.isSwissIban("CH93 0076 2011 6238 5295 8"));
assert.ok(!Q.isSwissIban("DE89 3704 0044 0532 0130 00")); // gültig, aber nicht CH/LI
assert.ok(!Q.isSwissIban("CH00 0000 0000 0000 0000 0")); // Beispiel-IBAN der Beispieldaten ist ungültig
assert.ok(Q.isSwissIban("LI21 0881 0000 2324 013A A"));
assert.ok(Q.isSwissIban("CH58 0079 1123 0008 8901 2")); // normale IBAN (IID 00791), Beispiel der Spezifikation
assert.ok(!Q.isQrIban("CH58 0079 1123 0008 8901 2"));
assert.ok(Q.isQrIban("CH44 3199 9123 0008 8901 2")); // QR-IBAN (IID 31999), Beispiel der Spezifikation
const withIid = (iid) => { // IBAN mit beliebiger IID und gültiger Prüfziffer bilden
  const bban = `${String(iid).padStart(5, "0")}123456789012`;
  let n = ""; for (const c of bban + "CH00") n += /\d/.test(c) ? c : c.charCodeAt(0) - 55;
  let r = 0; for (const ch of n) r = (r * 10 + Number(ch)) % 97;
  return `CH${String(98 - r).padStart(2, "0")}${bban}`;
};
for (const [iid, qr] of [[29999, false], [30000, true], [30500, true], [31999, true], [32000, false], [0, false], [8000, false]]) {
  const iban = withIid(iid);
  assert.ok(Q.isSwissIban(iban), iban);
  assert.equal(Q.isQrIban(iban), qr, `IID ${iid}`);
}

// ---- Texte
assert.deepEqual(Q.splitStreet("Industriestrasse 12"), { street: "Industriestrasse", houseNo: "12" });
assert.deepEqual(Q.splitStreet("Rue du Lac 21a"), { street: "Rue du Lac", houseNo: "21a" });
assert.deepEqual(Q.splitStreet("Postfach"), { street: "Postfach", houseNo: "" });
assert.equal(Q.clean("Müller & Söhne – AG", 70), "Müller & Söhne . AG");
assert.equal(Q.clean("x".repeat(100), 70).length, 70);
assert.equal(Q.clean("Zeile1\nZeile2", 140), "Zeile1 Zeile2");
assert.equal(Q.amountText(1234.5), "1234.50");
assert.equal(Q.amountText(0), "");
assert.equal(Q.amountText(-5), "");
assert.equal(Q.fmtAmount(1234567.8), "1 234 567.80");
assert.equal(Q.fmtAmount(12.3), "12.30");

// ---- Payload: Zeilenfolge
const creditor = { name: "Beispiel Handels GmbH", street: "Musterstrasse", houseNo: "1", zip: "8000", city: "Zürich", country: "CH" };
const debtor = { name: "Muster Maschinenbau AG", street: "Industriestrasse", houseNo: "12", zip: "8400", city: "Winterthur", country: "CH" };
const qrIban = "CH4431999123000889012";
const p1 = Q.buildPayload({ iban: qrIban, creditor, amount: 1949.75, currency: "CHF", debtor, refType: "QRR", reference: r60000, message: "Rechnung 60000" }).split("\n");
assert.equal(p1.length, 31);
assert.deepEqual(p1.slice(0, 11), ["SPC", "0200", "1", qrIban, "S", "Beispiel Handels GmbH", "Musterstrasse", "1", "8000", "Zürich", "CH"]);
assert.deepEqual(p1.slice(11, 18), ["", "", "", "", "", "", ""]); // endgültiger Zahlungsempfänger: reserviert, leer
assert.equal(p1[18], "1949.75");
assert.equal(p1[19], "CHF");
assert.deepEqual(p1.slice(20, 27), ["S", "Muster Maschinenbau AG", "Industriestrasse", "12", "8400", "Winterthur", "CH"]);
assert.deepEqual(p1.slice(27, 31), ["QRR", r60000, "Rechnung 60000", "EPD"]);
// ohne Zahlungspflichtigen und Betrag: leere Zeilen bleiben erhalten
const p2 = Q.buildPayload({ iban: "CH5800791123000889012", creditor, amount: 0, currency: "EUR", debtor: null, refType: "NON", message: "" }).split("\n");
assert.equal(p2.length, 31);
assert.equal(p2[18], ""); assert.equal(p2[19], "EUR");
assert.deepEqual(p2.slice(20, 27), ["", "", "", "", "", "", ""]);
assert.deepEqual(p2.slice(27, 31), ["NON", "", "", "EPD"]);
assert.ok(!p2.join("\n").includes("\r"));

// ---- prepareQrBill: Regeln zu Referenzart, IBAN und Währung
const bill = (over = {}) => B.normalizeBilling({
  firma: "Beispiel Handels GmbH", adresse: "Musterstrasse 1", plz: "8000", ort: "Zürich", landCode: "CH",
  banks: [{ id: "k", bank: "X", iban: "CH5800791123000889012", qrIban, bic: "", waehrung: "CHF" }],
  ...over,
});
const cust = { firma: "Muster Maschinenbau AG", strasse: "Industriestrasse 12", plz: "8400", ort: "Winterthur" };
const prep = (b, bank, extra = {}) => Q.prepareQrBill({ billing: b, bank, currency: "CHF", nr: 60000, total: 100, customer: cust, customerCountry: "CH", message: "Rechnung 60000", ...extra });
let b = bill();
let r = prep(b, b.banks[0]);
assert.ok(r.ok);
assert.equal(r.view.refType, "QRR"); // «auto» + QR-IBAN → QRR
assert.equal(r.view.iban, "CH44 3199 9123 0008 8901 2");
assert.equal(r.view.reference, Q.fmtQrr(r60000));
assert.equal(r.view.amount, "100.00");
assert.equal(r.view.debtor.houseNo, "12");
assert.equal(r.payload.split("\n")[3], qrIban);
assert.equal(r.payload.split("\n")[27], "QRR");
// «auto» ohne QR-IBAN → SCOR mit normaler IBAN
b = bill({ banks: [{ id: "k", bank: "X", iban: "CH5800791123000889012", waehrung: "CHF" }] });
r = prep(b, b.banks[0]);
assert.ok(r.ok); assert.equal(r.view.refType, "SCOR"); assert.equal(r.payload.split("\n")[3], "CH5800791123000889012");
assert.ok(Q.isValidScor(r.payload.split("\n")[28]));
// NON: keine Referenz
b = bill({ qrRefType: "NON" });
r = prep(b, b.banks[0]);
assert.ok(r.ok); assert.equal(r.payload.split("\n")[27], "NON"); assert.equal(r.payload.split("\n")[28], "");
assert.equal(r.payload.split("\n")[3], "CH5800791123000889012");
// QRR verlangt eine QR-IBAN; SCOR/NON verbieten sie als Konto
b = bill({ qrRefType: "QRR", banks: [{ id: "k", bank: "X", iban: "CH5800791123000889012", waehrung: "CHF" }] });
assert.deepEqual(prep(b, b.banks[0]).warnings, ["noQrIban"]);
b = bill({ qrRefType: "QRR", banks: [{ id: "k", bank: "X", iban: "CH5800791123000889012", qrIban: "CH5800791123000889012", waehrung: "CHF" }] });
assert.deepEqual(prep(b, b.banks[0]).warnings, ["badQrIban"]);
b = bill({ qrRefType: "SCOR", banks: [{ id: "k", bank: "X", iban: qrIban, waehrung: "CHF" }] });
assert.deepEqual(prep(b, b.banks[0]).warnings, ["qrIbanWithScor"]);
// ungültige/fehlende IBAN, Währung, Empfängeradresse
b = bill({ banks: [{ id: "k", bank: "X", iban: "CH00 0000 0000 0000 0000 0", waehrung: "CHF" }] });
assert.deepEqual(prep(b, b.banks[0]).warnings, ["badIban"]);
assert.deepEqual(prep(b, null).warnings, ["noIban"]);
b = bill();
assert.ok(prep(b, b.banks[0], { currency: "USD" }).warnings.includes("currency"));
assert.ok(prep(b, { ...b.banks[0], waehrung: "EUR" }).warnings.includes("bankCurrency")); // Konto passt nicht zur Währung
assert.ok(prep(bill({ landCode: "DE" }), b.banks[0]).warnings.includes("creditor")); // Zahlungsempfänger muss in CH/LI sein
assert.ok(prep(bill({ firma: "" }), b.banks[0]).warnings.includes("creditor"));
assert.ok(prep(b, b.banks[0], { nr: "x".repeat(30) }).warnings.includes("reference"));
// Zahlungspflichtiger unvollständig → leere Felder (kein Fehler)
r = prep(b, b.banks[0], { customer: { firma: "Nur Name" } });
assert.ok(r.ok); assert.deepEqual(r.payload.split("\n").slice(20, 27), ["", "", "", "", "", "", ""]); assert.equal(r.view.debtor, null);

// ---- QR-Encoder: Kapazität Stufe M je Version (ISO/IEC 18004 Tabelle 7)
const CAP_M = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334];
CAP_M.forEach((c, i) => assert.equal(dataCapacity(i + 1), c, `Version ${i + 1}`));

// ---- Roundtrip über den unabhängigen Decoder (alle Versionen bis 25 + einige grössere, Umlaute/UTF-8)
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 äöüÄÖÜéèà.,-/\n";
const rndText = (n) => Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
const versionsSeen = new Set();
for (let ver = 1; ver <= 40; ver++) {
  const bytesWanted = Math.max(1, dataCapacity(ver) - 3 - (ver <= 9 ? 1 : 2) - 1); // knapp unter der Kapazität → genau diese Version
  let text = rndText(bytesWanted);
  while (Buffer.byteLength(text) > bytesWanted) text = text.slice(0, -1);
  const q = encode(text);
  versionsSeen.add(q.version);
  const d = decodeMatrix(q.modules);
  assert.equal(d.text, text, `Version ${ver}`);
  assert.equal(d.corrected, 0);
  assert.equal(d.version, q.version);
}
assert.ok(versionsSeen.size >= 30);
assert.equal(decodeMatrix(encode("").modules).text, "");
assert.equal(decodeMatrix(encode("HELLO WORLD").modules).text, "HELLO WORLD");
assert.equal(encode("HELLO WORLD").version, 1);
assert.throws(() => encode("x".repeat(3000)), RangeError);

// ---- Fehlerkorrektur: Mitte verdeckt (Schweizer Kreuz 7 mm von 46 mm ≈ 15 % der Kantenlänge), plus einzelne Störungen
const sample = Q.buildPayload({ iban: qrIban, creditor, amount: 1949.75, currency: "CHF", debtor, refType: "QRR", reference: r60000, message: "Rechnung 60000" });
const qq = encode(sample);
assert.ok(qq.version <= 25, `Payload passt in Version 25 (ist ${qq.version})`);
assert.equal(decodeMatrix(qq.modules).text, sample);
const covered = qq.modules.map((row) => row.slice());
const half = Math.ceil((qq.size * 7) / 46 / 2) + 1; // Kreuz + Rahmen, mit Reserve
const mid = Math.floor(qq.size / 2);
for (let y = mid - half; y <= mid + half; y++) for (let x = mid - half; x <= mid + half; x++) covered[y][x] = (x + y) % 2 === 0; // Kreuz zerstört die Module
const dc = decodeMatrix(covered);
assert.equal(dc.text, sample);
assert.ok(dc.corrected > 0, "Fehlerkorrektur hat gearbeitet");
// Zahlungs-Payload der Beispiele passt auch mit allen Feldern voll
const fat = Q.buildPayload({ iban: qrIban, creditor: { ...creditor, name: "N".repeat(70), street: "S".repeat(70) }, amount: 999999999.99, currency: "CHF", debtor: { ...debtor, name: "D".repeat(70), street: "T".repeat(70) }, refType: "QRR", reference: r60000, message: "M".repeat(140), billingInfo: "B".repeat(140) });
assert.ok(encode(fat).version <= 25);
assert.equal(decodeMatrix(encode(fat).modules).text, fat);

console.log("test-qrbill: OK");
