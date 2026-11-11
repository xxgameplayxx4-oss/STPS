#!/usr/bin/env node
// Sendungen: Verspätung, Status aus Ereignissen, Kennzahlen, Beispieldaten – npm run test:shipments
import assert from "node:assert/strict";
import fs from "node:fs";
import { isDelayed, delayDays, shipDisplayStatus, stateFromEvents, deliveredOn, shipmentKpis, hasShipment, trackingHref, daysBetween, sortedEvents } from "../js/logistics.js";

const today = "2026-11-07";
// Verspätet = ETA verstrichen und nicht zugestellt
assert.equal(isDelayed({ lieferungErwartet: "2026-11-06", versandStatus: "Unterwegs" }, today), true);
assert.equal(isDelayed({ lieferungErwartet: "2026-11-07", versandStatus: "Unterwegs" }, today), false, "ETA heute ist noch nicht verspätet");
assert.equal(isDelayed({ lieferungErwartet: "2026-10-01", versandStatus: "Zugestellt" }, today), false);
assert.equal(isDelayed({ versandStatus: "Unterwegs" }, today), false, "ohne ETA nie verspätet");
assert.equal(delayDays({ lieferungErwartet: "2026-10-30", versandStatus: "Unterwegs" }, today), 8);
assert.equal(delayDays({ lieferungErwartet: "2026-11-30", versandStatus: "Unterwegs" }, today), 0);
assert.equal(daysBetween("2026-10-30", "2026-11-07"), 8);
assert.equal(shipDisplayStatus({ lieferungErwartet: "2026-10-30", versandStatus: "Unterwegs" }, today), "Verzögert");
assert.equal(shipDisplayStatus({ lieferungErwartet: "2026-10-30", versandStatus: "Zugestellt" }, today), "Zugestellt");

// Status und Standort aus dem neuesten Ereignis
const events = [
  { id: "b", date: "2026-11-02", status: "Abgefahren", location: "Hai Phong" },
  { id: "a", date: "2026-11-01", status: "Gebucht", location: "Hanoi" },
  { id: "c", date: "2026-11-02", status: "Abgeholt", location: "Werk" },
];
assert.deepEqual(sortedEvents({ events }).map((e) => e.id), ["a", "c", "b"], "Datum, dann Meilenstein-Reihenfolge");
assert.deepEqual(stateFromEvents({ events }), { status: "Unterwegs", location: "Hai Phong", milestone: "Abgefahren" });
assert.equal(stateFromEvents({ events: [events[1]] }).status, "Offen");
assert.equal(stateFromEvents({}).status, "");
const delivered = { versandStatus: "Zugestellt", lieferungErwartet: "2026-11-01", events: [{ id: "z", date: "2026-11-03", status: "Zugestellt", location: "CH" }] };
assert.equal(deliveredOn(delivered), "2026-11-03");
assert.equal(deliveredOn({ versandStatus: "Unterwegs" }), "");

// Kennzahlen
const rows = [
  { versandAm: "2026-10-01", versandStatus: "Unterwegs", lieferungErwartet: "2026-11-09" },
  { versandAm: "2026-10-01", versandStatus: "Unterwegs", lieferungErwartet: "2026-11-20" },
  { versandAm: "2026-10-01", versandStatus: "Unterwegs", lieferungErwartet: "2026-10-30" },
  { ...delivered },
  { versandStatus: "Offen", containerNr: "ABCU1234567", lieferungErwartet: "2026-12-20" },
];
assert.deepEqual(shipmentKpis(rows, today), { inTransit: 3, arriving7: 1, delayed: 1, deliveredMonth: 1 });
assert.equal(hasShipment({ containerNr: "ABCU1234567" }), true);
assert.equal(hasShipment({ produkt: "x" }), false);
assert.match(trackingHref({ spediteur: "MSC", containerNr: "MSCU7412358" }), /MSCU7412358$/);

// Beispieldaten: 11 Sendungen, zwei verspätet, eine in diesem Monat zugestellt
const raw = JSON.parse(fs.readFileSync(new URL("../sample/beispieldaten.json", import.meta.url), "utf8"));
const ships = raw.rfqs.filter(hasShipment);
assert.equal(ships.length, 11);
assert.deepEqual(shipmentKpis(ships, today), { inTransit: 8, arriving7: 4, delayed: 2, deliveredMonth: 1 });
assert.ok(ships.every((s) => /^[A-Z]{4}\d{7}$/.test(s.containerNr || "AAAA0000000") && Array.isArray(s.events) && s.events.length));
console.log("test-shipments: OK");
