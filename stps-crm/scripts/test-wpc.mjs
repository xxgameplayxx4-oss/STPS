#!/usr/bin/env node
// Prüft WP-C: Wechselkurse (js/fx.js), feste Wahrscheinlichkeit 20/40/60/80, Kategorien-Import (js/catimport.js)
// Aufruf: node scripts/test-wpc.mjs
import assert from "node:assert/strict";
import { normalizeFx, convert, roundFx, DEFAULT_FX } from "../js/fx.js";
import { normChance, CHANCES } from "../js/config.js";
import { parseCsv, parseMatrix, planMerge, applyMerge, templateCsv } from "../js/catimport.js";

// ---- Wechselkurse
const fx = normalizeFx({ EUR: "0,95", USD: 0.8, date: "2026-11-03" });
assert.deepEqual(fx, { EUR: 0.95, USD: 0.8, date: "2026-11-03" });
assert.deepEqual(normalizeFx(null), { EUR: DEFAULT_FX.EUR, USD: DEFAULT_FX.USD, date: "" });
assert.equal(normalizeFx({ EUR: -1, USD: "abc", date: "03.11.2026" }).EUR, DEFAULT_FX.EUR); // ungültig → Richtwert
assert.equal(normalizeFx({ date: "03.11.2026" }).date, "");
assert.equal(convert(1000, "CHF", "EUR", { EUR: 0.5, USD: 0.8 }), 2000);
assert.equal(convert(100, "EUR", "CHF", { EUR: 0.95, USD: 0.8 }), 95);
assert.ok(Math.abs(convert(100, "EUR", "USD", { EUR: 0.95, USD: 0.8 }) - 118.75) < 1e-9);
assert.equal(convert(50, "VND", "CHF", fx), null);
assert.equal(convert(50, "EUR", "EUR", fx), 50);
assert.equal(convert("", "EUR", "CHF", fx), null);
assert.equal(convert(10, undefined, "EUR", { EUR: 0.5, USD: 1 }), 20); // leer = CHF
assert.equal(roundFx(1234.567), 1235);
assert.equal(roundFx(12.345), 12.35);

// ---- Wahrscheinlichkeit nur 20/40/60/80 (Abschluss 100/0)
assert.deepEqual(CHANCES, [20, 40, 60, 80]);
for (const [v, e] of [[0, 20], [10, 20], [30, 40], [25, 20], [35, 40], [50, 60], [55, 60], [70, 80], [90, 80], [100, 80], [33.3, 40], ["60", 60], ["45", 40]]) assert.equal(normChance(v, "Akquise"), e, `${v}`);
assert.equal(normChance(17, "Abschluss Ja"), 100);
assert.equal(normChance("", "Abschluss Nein"), 0);
assert.equal(normChance("", "Akquise"), null);
assert.equal(normChance("abc", "Akquise"), null);
assert.equal(normChance(null, "Akquise"), null);

// ---- CSV
assert.deepEqual(parseCsv('a;b;c\r\n"x;1";"q""r";\n').rows, [["a", "b", "c"], ["x;1", 'q"r', ""]]);
assert.equal(parseCsv("a,b\n1,2").delimiter, ",");
assert.equal(parseCsv("a\tb\n1\t2").delimiter, "\t");
assert.deepEqual(parseCsv("﻿Hauptkategorie;Unterkategorie\nA;B").rows[0], ["Hauptkategorie", "Unterkategorie"]);

// Vorlage ist lesbar und vollständig
const tpl = parseMatrix(templateCsv());
assert.equal(tpl.errors.length, 0);
assert.deepEqual([...new Set(tpl.rows.map((r) => r.haupt))], ["Gewindestangen", "Rohrschellen", "Hänger/Abhängungen", "Schrauben/Bolzen"]);
assert.ok(tpl.rows.every((r) => r.unter && r.code));

// Fehler
assert.equal(parseMatrix("").errors[0].key, "cat.imp.err.empty");
assert.equal(parseMatrix("Foo;Bar\n1;2").errors[0].key, "cat.imp.err.noHeader");
const bad = parseMatrix("Hauptkategorie;Unterkategorie;Code\n;X;\nA;B;WAYTOOLONGCODE123");
assert.deepEqual(bad.errors.map((e) => e.key), ["cat.imp.err.noMain", "cat.imp.err.codeLong"]);
assert.equal(parseMatrix("hauptkategorie,unterkategorie\nA,B").rows[0].unter, "B"); // Komma, Gross-/Kleinschreibung
assert.equal(parseMatrix("Hauptkategorie\nA").rows[0].unter, ""); // ohne Unterkategorie-Spalte

// ---- Zusammenführen: IDs bleiben, nichts geht verloren
let n = 0;
const newId = () => `${++n}`.padEnd(12, "x"); // wie uid(): die ersten 8 Zeichen unterscheiden sich
const tree = [
  { id: "wg_a", code: "A", name: "Rohrschellen", von: 100001, bis: 100100, unterkategorien: [{ id: "uk_old", name: "Schnellmontage" }] },
  { id: "wg_b", code: "B", name: "Sonstiges", von: 100101, bis: 100200 },
];
const snapshot = JSON.stringify(tree);
const rows = parseMatrix("Hauptkategorie;Unterkategorie;Code\nrohrschellen;schnellmontage;RS\nRohrschellen;Mit Gummi;RS\nGewindestangen;Verzinkt;A\nGewindestangen;Verzinkt;A\nGewindestangen;Edelstahl;GS\nHänger;;HA").rows;
const plan = planMerge(tree, rows);
assert.equal(plan.newMain, 2); // Gewindestangen, Hänger
assert.equal(plan.newSub, 3); // Mit Gummi, Verzinkt, Edelstahl
assert.equal(plan.existing, 1);
assert.equal(plan.dup, 1);
assert.deepEqual(plan.items.map((i) => i.sub), ["existing", "new", "new", "dup", "new", ""]);
assert.ok(plan.warnings.some((w) => w.key === "cat.imp.warn.codeKept"));
assert.ok(plan.warnings.some((w) => w.key === "cat.imp.warn.codeTaken")); // A ist vergeben
assert.ok(plan.warnings.some((w) => w.key === "cat.imp.warn.codeDiffers")); // Gewindestangen: A und GS
const merged = applyMerge(tree, rows, newId);
assert.equal(JSON.stringify(tree), snapshot, "Eingabe bleibt unverändert");
assert.equal(merged.length, 4);
assert.deepEqual(merged[0].unterkategorien.map((s) => s.name), ["Schnellmontage", "Mit Gummi"]);
assert.equal(merged[0].unterkategorien[0].id, "uk_old");
assert.ok(merged[0].unterkategorien[1].id.startsWith("uk_"));
assert.equal(merged[0].id, "wg_a"); assert.equal(merged[0].code, "A"); assert.equal(merged[1], tree[1]); // unberührt → dasselbe Objekt
assert.equal(merged[2].name, "Gewindestangen");
assert.notEqual(merged[2].code, "A"); // vergeben → freier Code
assert.equal(merged[2].von, 100201); assert.equal(merged[2].bis, 100300);
assert.deepEqual(merged[2].unterkategorien.map((s) => s.name), ["Verzinkt", "Edelstahl"]);
assert.equal(merged[3].name, "Hänger"); assert.equal(merged[3].code, "HA"); assert.equal(merged[3].von, 100301);
assert.equal(new Set(merged.flatMap((g) => [g.id, ...(g.unterkategorien || []).map((s) => s.id)])).size, merged.length + merged.reduce((s, g) => s + (g.unterkategorien || []).length, 0), "IDs eindeutig");
// zweiter Import derselben Datei ändert nichts mehr
const again = planMerge(merged, rows);
assert.equal(again.newMain + again.newSub, 0);
const merged2 = applyMerge(merged, rows, newId);
assert.equal(JSON.stringify(merged2), JSON.stringify(merged));
// Vorlage in leeren Baum
const fromTpl = applyMerge([], tpl.rows, newId);
assert.equal(fromTpl.length, 4);
assert.deepEqual(fromTpl.map((g) => g.code), ["GS", "RS", "HA", "SB"]);
assert.equal(fromTpl[0].von, 100001); assert.equal(fromTpl[1].von, 100101);
assert.equal(fromTpl.reduce((s, g) => s + g.unterkategorien.length, 0), 13);
console.log("test-wpc: OK");
