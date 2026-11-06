#!/usr/bin/env node
// Prüft die Listenlogik von «Aufgaben & Aktivitäten» (js/tasklog.js): gemeinsame Sicht auf tasks + activities, Reiter, Typfilter,
// Kalender-Fristen, alte Adressen – Aufruf: node scripts/test-tasklog.mjs  (npm run test:tasklog)
import assert from "node:assert/strict";
import * as TL from "../js/tasklog.js";

const tasks = [
  { id: "t1", nr: 50000, aufgabe: "Offerte nachfassen", faellig: "2026-10-20", status: "Offen", owner: "Pascal", customerId: "c1", prioritaet: "A", kommentar: "per Telefon" },
  { id: "t2", nr: 50001, aufgabe: "Muster senden", faellig: "2026-11-02", status: "In Arbeit", owner: "Liz", supplierId: "s1" },
  { id: "t3", nr: 50002, aufgabe: "Vertrag prüfen", faellig: "2026-10-01", erledigtAm: "2026-10-03", status: "Erledigt", owner: "Marco" },
  { id: "t4", nr: 50003, aufgabe: "Blockierte Aufgabe", faellig: "2026-12-01", status: "Blockiert", owner: "Marco" },
];
const activities = [
  { id: "a1", nr: 30000, datum: "2026-10-10", typ: "Telefon", customerId: "c1", owner: "Pascal", notiz: "Erstgespräch", naechsterSchritt: "Angebot senden", faellig: "2026-10-30", status: "Offen" },
  { id: "a2", nr: 30001, datum: "2026-09-01", typ: "E-Mail", customerId: "c1", owner: "Pascal", notiz: "Dokumente erhalten", status: "Erledigt" },
  { id: "a3", nr: 30002, datum: "2026-08-01", typ: "Eigener Typ", supplierId: "s1", owner: "Liz", notiz: "Besuch", status: "Erledigt" },
];
const db = { tasks, activities };
const all = TL.unify(db);

// Einheitliche Zeilen: beide Sammlungen, Schlüssel eindeutig und rückwärts auflösbar, Datensätze unverändert (keine Kopie/Migration)
assert.equal(all.length, 7);
assert.equal(new Set(all.map((i) => i.id)).size, 7);
assert.deepEqual(TL.parseKey(all[0].id), { coll: "tasks", id: "t1" });
assert.deepEqual(TL.parseKey("activities:a1"), { coll: "activities", id: "a1" });
assert.equal(TL.parseKey("customers:x"), null);
assert.equal(TL.parseKey("nokey"), null);
assert.equal(all[0].rec, tasks[0]);
const byId = Object.fromEntries(all.map((i) => [i.recId, i]));
assert.equal(byId.t1.kind, "todo");
assert.equal(byId.t1.typ, TL.TODO);
assert.equal(byId.a1.kind, "activity");
assert.equal(byId.a1.title, "Angebot senden", "Aktivität: nächster Schritt als Titel");
assert.equal(byId.a1.detail, "Erstgespräch");
assert.equal(byId.a2.title, "Dokumente erhalten", "ohne nächsten Schritt: Notiz als Titel");
assert.equal(byId.t3.date, "2026-10-03", "erledigte Aufgabe: erledigt am");
assert.equal(byId.t1.date, "2026-10-20", "offene Aufgabe: Fälligkeit");

// Reiter
const ids = (arr) => arr.map((i) => i.recId).sort();
assert.deepEqual(ids(all.filter((i) => TL.inTab(i, "open"))), ["a1", "t1", "t2", "t4"], "Offen: alles ausser «Erledigt» (auch In Arbeit/Blockiert)");
assert.deepEqual(ids(all.filter((i) => TL.inTab(i, "done"))), ["a2", "a3", "t3"]);
assert.equal(all.filter((i) => TL.inTab(i, "history")).length, 7, "Verlauf: alles");
assert.deepEqual(TL.tabCounts(all), { open: 4, done: 3, history: 7 });
assert.equal(TL.inTab(byId.t1, "unbekannt"), true);

// Typfilter
assert.deepEqual(ids(all.filter((i) => TL.matchesType(i, TL.TODO))), ["t1", "t2", "t3", "t4"]);
assert.deepEqual(ids(all.filter((i) => TL.matchesType(i, "Telefon"))), ["a1"]);
assert.equal(all.filter((i) => TL.matchesType(i, "")).length, 7);
assert.deepEqual(TL.typeOptions(["Telefon", "E-Mail"], all), [TL.TODO, "Telefon", "E-Mail", "Eigener Typ"], "To-do + Liste + Typen aus den Daten");

// Kalender und Menü-Badge
assert.deepEqual(ids(TL.dueIn(all, "2026-10-25", "2026-11-30")), ["a1", "t2"], "nur offene mit Frist im Zeitraum");
assert.deepEqual(ids(TL.dueIn(all, "2026-10-01", "2026-10-31")), ["a1", "t1"], "erledigte (t3) nicht");
assert.equal(TL.overdueCount(all, "2026-10-25"), 1, "nur t1 ist überfällig");
assert.equal(TL.overdueCount(all, "2026-12-31"), 4);

// Adressen
assert.equal(TL.href(), "#/aufgaben-aktivitaeten");
assert.equal(TL.href({ tab: "open", typ: TL.TODO }), "#/aufgaben-aktivitaeten?tab=open&typ=__todo");
assert.deepEqual(TL.LEGACY_ROUTES, { aufgaben: "open", aktivitaeten: "history" });
assert.deepEqual(TL.TAB_SORT.open, { key: "due", dir: "asc" });

// leere Daten
assert.deepEqual(TL.unify({}), []);
assert.deepEqual(TL.tabCounts([]), { open: 0, done: 0, history: 0 });

console.log("OK – Aufgaben & Aktivitäten: Listenlogik");
