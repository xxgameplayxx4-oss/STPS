#!/usr/bin/env node
// Beispieldaten im Livebetrieb: hinzufügen (nichts überschrieben, keine Kollisionen, Zähler unverändert) → doppelt abgelehnt → entfernen (Originaldaten identisch) – npm run test:sample-live
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { buildSample, hasSample } from "../netlify/functions/lib/sample.mjs";
import { nextInvoiceNr } from "../js/billing.js";
import { csrfOk } from "../netlify/functions/lib/http.mjs";

const clock = Date.parse("2026-11-11T09:00:00Z");
const store = createMemoryStore();
const env = { CRM_DEV_MODE: "on" };
const call = async (method, path, { token, body } = {}) => {
  const [p, q] = path.split("?");
  return handleApi(
    { method, path: "/api" + p, query: new URLSearchParams(q || ""), headers: token ? { authorization: `Bearer ${token}` } : {}, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0 },
  );
};
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.body)); return r.body; };
const COLLS = ["customers", "suppliers", "rfqs", "deals", "activities", "tasks", "focus", "approvals", "articles", "invoices"];
const clone = (x) => JSON.parse(JSON.stringify(x));

const pascal = ok(await call("POST", "/dev/session", { body: { as: "pascal" } })).token;
const liz = ok(await call("POST", "/dev/session", { body: { as: "liz" } })).token;

// ---- «echte» Teamdaten: eigene Nummern, eigene Warengruppen/Bank, ein eigener Termin
const real = {
  schema: 1,
  meta: { createdAt: "2026-01-01T00:00:00.000Z", lastNr: { customers: 10002, suppliers: 20000, activities: 30000, deals: 40001, tasks: 50000, invoices: 60003 } },
  lists: {}, 
  settings: { billing: { warengruppen: [{ id: "wg_x", code: "X", name: "Eigene", von: 500001, bis: 500100, unterkategorien: [{ id: "uk_x", name: "Sub" }] }], banks: [{ id: "bk_real", bank: "Echtbank", iban: "CH9300762011623852957", waehrung: "CHF" }], invoiceStart: 60000, mwstSatz: 8.1 } },
  customers: [
    { id: "c-real-1", nr: 10000, firma: "Echt AG", owner: "Pascal", contacts: [], createdAt: "2026-02-01T08:00:00.000Z" },
    { id: "c-real-2", nr: 10001, firma: "Echt 2 GmbH", owner: "Liz", contacts: [], createdAt: "2026-02-02T08:00:00.000Z" },
    { id: "c-real-3", nr: 10002, firma: "Echt 3 SA", owner: "Pascal", contacts: [], createdAt: "2026-02-03T08:00:00.000Z" },
  ],
  suppliers: [{ id: "s-real-1", nr: 20000, firma: "Echt Lieferant", contacts: [], createdAt: "2026-02-01T08:00:00.000Z" }],
  rfqs: [], deals: [{ id: "d-real-1", nr: 40000, customerId: "c-real-1", produkt: "Echt", wert: 1000, phase: "Akquise", positions: [], createdAt: "2026-02-01T08:00:00.000Z" }],
  activities: [], tasks: [], focus: [], approvals: [],
  articles: [{ id: "a-real-1", nr: 500001, warengruppeId: "wg_x", bezeichnung: "Echtartikel", createdAt: "2026-02-01T08:00:00.000Z" }],
  invoices: [{ id: "i-real-1", nr: 60000, customerId: "c-real-1", status: "Gesendet", positions: [], waehrung: "CHF", bankId: "bk_real", createdAt: "2026-02-01T08:00:00.000Z" }],
};
ok(await call("PUT", "/db", { token: pascal, body: { baseVersion: 0, data: real } }));
const dbOf = async () => ok(await call("GET", "/db", { token: pascal }));
const before = await dbOf();
const realEvent = ok(await call("POST", "/calendar/events", { token: pascal, body: { title: "Echter Termin", start: "2026-11-12T08:00:00Z", end: "2026-11-12T09:00:00Z", reminders: [15] } }), 201).event;
const calEvents = async () => ok(await call("GET", "/calendar?from=2026-08-01T00:00:00Z&to=2027-08-01T00:00:00Z", { token: pascal })).events;
const orig = clone(before.data);

// ---- Rechte
assert.equal((await call("POST", "/sample/add", { token: liz })).status, 403);
assert.equal((await call("POST", "/sample/remove", { token: liz })).status, 403);
assert.equal((await call("GET", "/sample/add", { token: pascal })).status, 405);
assert.equal((await call("POST", "/sample/add")).status, 200 /* Entwicklungsmodus ohne Token = Pascal */);
ok(await call("POST", "/sample/remove", { token: pascal }));
assert.deepEqual((await dbOf()).data, orig, "Hinzufügen+Entfernen ohne Token-Test: unverändert");
assert.equal(csrfOk("POST", {}), false, "Schreibzugriff ohne X-Requested-With bleibt gesperrt (api.mjs)");
assert.equal(csrfOk("POST", { "x-requested-with": "stps-crm" }), true);

// ---- Hinzufügen
const v0 = (await dbOf()).version;
const added = ok(await call("POST", "/sample/add", { token: pascal }));
assert.equal(added.counts.customers, 14);
assert.ok(added.events > 0);
const after = await dbOf();
assert.ok(after.version > v0, "neue Version");
const d = after.data;
assert.deepEqual(d.meta, orig.meta, "Zähler (meta.lastNr) unverändert");
assert.deepEqual(d.settings, orig.settings, "Einstellungen unverändert");
assert.deepEqual(d.lists, orig.lists);
for (const c of COLLS) {
  const origIds = new Set(orig[c].map((r) => r.id));
  assert.deepEqual(d[c].filter((r) => origIds.has(r.id)).map((r) => ({ ...r })), orig[c].map((r) => ({ ...r })), `${c}: echte Datensätze identisch (Stempel inklusive)`);
  const smp = d[c].filter((r) => !origIds.has(r.id));
  assert.equal(smp.length, added.counts[c]);
  for (const r of smp) {
    assert.equal(r.sample, true, `${c}: Marker`);
    assert.ok(r.id.startsWith("bsp-"), `${c}: ID-Präfix`);
    assert.ok(JSON.stringify(r).includes("Beispieldaten"), `${c}: Hinweis «Beispieldaten»`);
  }
  const nrs = d[c].map((r) => r.nr).filter((n) => n !== null && n !== undefined);
  assert.equal(new Set(nrs).size, nrs.length, `${c}: Nummern eindeutig`);
  assert.equal(new Set(d[c].map((r) => r.id)).size, d[c].length, `${c}: IDs eindeutig`);
}
// Zähler/«nächste Nummer» wie im Browser: unverändert
const base = { customers: 10000, suppliers: 20000, activities: 30000, deals: 40000, tasks: 50000 };
for (const [c, b] of Object.entries(base)) {
  const nextBefore = Math.max(...orig[c].map((r) => r.nr || 0), orig.meta.lastNr[c], b - 1) + 1;
  const nextAfter = Math.max(...d[c].map((r) => r.nr || 0).filter((n) => n < b || d[c].find((r) => r.nr === n && !r.sample)), orig.meta.lastNr[c], b - 1) + 1;
  const withSample = Math.max(...d[c].map((r) => r.nr || 0), d.meta.lastNr[c], b - 1) + 1;
  assert.equal(withSample, nextBefore, `${c}: nächste Nummer mit Beispieldaten unverändert`);
  assert.equal(nextAfter, nextBefore);
}
assert.equal(nextInvoiceNr(d.invoices, 60000, d.meta.lastNr.invoices), nextInvoiceNr(orig.invoices, 60000, orig.meta.lastNr.invoices), "nächste Rechnungsnummer unverändert");
assert.ok(d.invoices.filter((i) => i.sample).every((i) => i.nr < 60000));
// Artikel: ausserhalb der Warengruppen-Bereiche (der echte Bereich 500001–500100 bleibt frei von Beispielen)
assert.ok(d.articles.filter((a) => a.sample).every((a) => a.nr === null || a.nr > 500100));
// Querverweise zeigen auf Beispiel-Datensätze (oder leer); Bankkonto/Warengruppe/Verantwortliche des Teams
const ids = { customers: new Set(d.customers.map((r) => r.id)), suppliers: new Set(d.suppliers.map((r) => r.id)), deals: new Set(d.deals.map((r) => r.id)) };
const contactIds = new Set([...d.customers, ...d.suppliers].flatMap((r) => (r.contacts || []).map((x) => x.id)));
for (const c of COLLS) for (const r of d[c].filter((x) => x.sample)) {
  if (r.customerId) assert.ok(ids.customers.has(r.customerId) && r.customerId.startsWith("bsp-"), `${c}.customerId`);
  if (r.supplierId) assert.ok(ids.suppliers.has(r.supplierId) && r.supplierId.startsWith("bsp-"), `${c}.supplierId`);
  if (r.dealId) assert.ok(ids.deals.has(r.dealId) && r.dealId.startsWith("bsp-"), `${c}.dealId`);
  if (r.contactId) assert.ok(contactIds.has(r.contactId) && r.contactId.startsWith("bsp-"), `${c}.contactId`);
}
assert.ok(d.invoices.filter((i) => i.sample).every((i) => i.bankId === (i.waehrung === "CHF" ? "bk_real" : "")), "Bankkonto des Teams (CHF), sonst leer");
assert.ok(d.articles.filter((a) => a.sample).every((a) => a.warengruppeId === ""), "unbekannte Warengruppen werden nicht übernommen");
assert.ok(d.customers.filter((c) => c.sample).every((c) => ["Pascal", "Liz", "Marco"].includes(c.owner)));
// Kalender: Beispieltermine ohne Erinnerungen, echter Termin unverändert
let evs = await calEvents();
const smpEv = evs.filter((e) => e.sample === true);
assert.equal(smpEv.length, added.events);
assert.ok(smpEv.every((e) => e.reminders.length === 0 && e.participants.length === 0 && e.notes.includes("Beispieldaten")));
assert.deepEqual(evs.find((e) => e.id === realEvent.id), realEvent);

// ---- doppeltes Laden wird abgelehnt
const dup = await call("POST", "/sample/add", { token: pascal });
assert.equal(dup.status, 409); assert.equal(dup.body.reason, "sample_exists");
assert.equal((await dbOf()).version, after.version, "kein Schreiben bei Ablehnung");
assert.ok(hasSample(d));

// ---- Entfernen: nur Beispieldaten, Rest identisch
const rm = ok(await call("POST", "/sample/remove", { token: pascal }));
assert.equal(rm.removed.customers, 14); assert.equal(rm.events, added.events); assert.equal(rm.orphaned, 0);
const gone = (await dbOf()).data;
assert.deepEqual(gone, orig, "Originaldaten nach Hinzufügen+Entfernen identisch");
evs = await calEvents();
assert.deepEqual(evs, [realEvent], "nur der echte Termin bleibt");
const rm2 = ok(await call("POST", "/sample/remove", { token: pascal }));
assert.equal(Object.values(rm2.removed).reduce((a, b) => a + b, 0), 0);

// ---- Wieder hinzufügen nach Entfernen; eigener Datensatz mit Verweis auf Beispiel bleibt (wird gezählt)
ok(await call("POST", "/sample/add", { token: pascal }));
const cur = await dbOf();
const smpCust = cur.data.customers.find((c) => c.sample);
cur.data.tasks.push({ id: "t-real", nr: 50000, aufgabe: "Eigene Aufgabe", customerId: smpCust.id, status: "Offen" });
ok(await call("PUT", "/db", { token: pascal, body: { baseVersion: cur.version, data: cur.data } }));
const rm3 = ok(await call("POST", "/sample/remove", { token: pascal }));
assert.equal(rm3.orphaned, 1);
assert.ok((await dbOf()).data.tasks.some((t) => t.id === "t-real"), "eigene Aufgabe bleibt");

// ---- Reine Funktion: leeres Team ohne Einstellungen
const raw = JSON.parse(fs.readFileSync(new URL("../sample/beispieldaten.json", import.meta.url), "utf8"));
const b = buildSample(raw, { schema: 1 }, {});
assert.equal(b.counts.invoices, raw.invoices.length);
assert.ok(b.recs.invoices.every((i) => i.nr >= 59000 && i.nr < 60000 && i.bankId === ""));
assert.ok(b.recs.customers.every((c) => c.nr >= 9000 && c.nr < 10000));
console.log("test-sample-live: OK");
