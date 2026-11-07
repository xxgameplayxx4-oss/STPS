#!/usr/bin/env node
// Automatische Wechselkurse (EZB via frankfurter.app): Antwort prüfen/umkehren, Speichern je Team, «manual» bleibt unangetastet,
// Fehler behalten die letzten Kurse, API-Endpunkt im Entwicklungsmodus, geplanter Lauf – ohne Netzwerk (Abruf simuliert).
// Aufruf: node scripts/test-fx-rates.mjs  (npm run test:fx)
import assert from "node:assert/strict";
import { parseRates, fetchRates, updateTeamFx, runFxUpdate, FX_URL, FX_SOURCE } from "../netlify/functions/lib/fx-rates.mjs";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { scopedStore, createTeam } from "../netlify/functions/lib/teams.mjs";
import { DB_KEY } from "../netlify/functions/lib/db.mjs";
import { normalizeFx, fxMode } from "../js/fx.js";

const good = { amount: 1, base: "CHF", date: "2026-11-06", rates: { EUR: 1.0753, USD: 1.2480 } };
const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });
const okFetch = async () => resp(200, good);
const clock = Date.parse("2026-11-07T16:30:00Z");

// ---- Antwort prüfen + umkehren (1 CHF = 1.0753 EUR  →  1 EUR = 0.9300 CHF)
assert.deepEqual(parseRates(good), { EUR: 0.93, USD: 0.8013, date: "2026-11-06" });
assert.equal(FX_URL, "https://api.frankfurter.app/latest?from=CHF&to=EUR,USD");
for (const [name, bad] of [
  ["null", null], ["Liste", []], ["fremde Basis", { ...good, base: "EUR" }], ["Datum fehlt", { ...good, date: undefined }], ["Datum kaputt", { ...good, date: "06.11.2026" }],
  ["rates fehlt", { ...good, rates: undefined }], ["USD fehlt", { ...good, rates: { EUR: 1.07 } }], ["Text statt Zahl", { ...good, rates: { EUR: "1.07", USD: 1.2 } }],
  ["null-Kurs", { ...good, rates: { EUR: 0, USD: 1.2 } }], ["unplausibel", { ...good, rates: { EUR: 1e-6, USD: 1.2 } }],
]) assert.throws(() => parseRates(bad), /Ungültige Kursantwort/, name);

// ---- Abruf: HTTP-Fehler, Netzwerkfehler
assert.deepEqual(await fetchRates({ fetch: okFetch }), { EUR: 0.93, USD: 0.8013, date: "2026-11-06" });
await assert.rejects(fetchRates({ fetch: async () => resp(503, {}) }), /HTTP 503/);
await assert.rejects(fetchRates({ fetch: async () => { throw new Error("offline"); } }), /offline/);

// ---- normalizeFx / fxMode (Bestand bleibt unverändert)
assert.deepEqual(normalizeFx({ EUR: 0.95, USD: 0.8, date: "2026-11-03" }), { EUR: 0.95, USD: 0.8, date: "2026-11-03" });
assert.equal(fxMode({ date: "2026-11-03" }), "manual", "bereits von Hand gepflegte Kurse bleiben manuell");
assert.equal(fxMode({ date: "" }), "auto");
assert.equal(fxMode({ date: "2026-11-03", mode: "auto" }), "auto");

// ---- Team-Speicher
const seedDb = (fx) => ({ version: 1, savedAt: "x", savedBy: "x", data: { schema: 1, customers: [], settings: { billing: { a: 1 }, ...(fx ? { fx } : {}) } } });
const fxOf = async (st) => (await st.read(DB_KEY)).value.data.settings.fx;
{
  const st = createMemoryStore();
  await st.write(DB_KEY, seedDb(null));
  const r = await updateTeamFx(st, { now: clock, fetch: okFetch });
  assert.equal(r.status, "ok");
  assert.deepEqual(await fxOf(st), { EUR: 0.93, USD: 0.8013, date: "2026-11-06", mode: "auto", source: FX_SOURCE, fetchedAt: "2026-11-07T16:30:00.000Z" });
  const doc = (await st.read(DB_KEY)).value;
  assert.equal(doc.version, 2); assert.deepEqual(doc.data.settings.billing, { a: 1 }, "andere Einstellungen bleiben");

  // Fehler: letzte Kurse bleiben, nur Vermerk
  const bad = await updateTeamFx(st, { now: clock + 1000, fetch: async () => resp(500, {}) });
  assert.equal(bad.status, "failed");
  const fx = await fxOf(st);
  assert.equal(fx.EUR, 0.93); assert.equal(fx.date, "2026-11-06"); assert.equal(fx.failedAt, "2026-11-07T16:30:01.000Z");
  // Erfolg räumt den Vermerk auf
  await updateTeamFx(st, { now: clock + 2000, fetch: okFetch });
  assert.equal((await fxOf(st)).failedAt, undefined);
}
{ // manuell: nie überschrieben, nicht einmal bei Fehler, kein Abruf
  const st = createMemoryStore();
  const manual = { EUR: 0.95, USD: 0.81, date: "2026-11-03", mode: "manual" };
  await st.write(DB_KEY, seedDb(manual));
  let calls = 0;
  assert.equal((await updateTeamFx(st, { now: clock, fetch: async () => { calls++; return resp(200, good); } })).status, "manual");
  assert.equal(calls, 0); assert.deepEqual(await fxOf(st), manual); assert.equal((await st.read(DB_KEY)).value.version, 1);
  // Altbestand ohne mode, aber mit Datum = manuell
  await st.write(DB_KEY, seedDb({ EUR: 0.95, USD: 0.81, date: "2026-11-03" }), {});
  assert.equal((await updateTeamFx(st, { now: clock, fetch: okFetch })).status, "manual");
  // ohne Datenbank: nichts zu tun
  assert.equal((await updateTeamFx(createMemoryStore(), { now: clock, fetch: okFetch })).status, "nodb");
}

// ---- Geplanter Lauf über alle Teams: ein Abruf, nur «auto» wird aktualisiert
{
  const root = createMemoryStore();
  const a = await createTeam(root, "Auto AG", { now: clock });
  const b = await createTeam(root, "Manuell AG", { now: clock });
  await scopedStore(root, a.id).write(DB_KEY, seedDb({ EUR: 0.9, USD: 0.8, date: "2026-10-01", mode: "auto" }));
  const manual = { EUR: 0.95, USD: 0.81, date: "2026-11-03", mode: "manual" };
  await scopedStore(root, b.id).write(DB_KEY, seedDb(manual));
  let calls = 0;
  const r = await runFxUpdate({ store: root, now: () => clock, fetch: async () => { calls++; return resp(200, good); } });
  assert.deepEqual(r, { teams: 2, updated: 1, skipped: 1, failed: 0 }); assert.equal(calls, 1);
  assert.equal((await fxOf(scopedStore(root, a.id))).EUR, 0.93);
  assert.deepEqual(await fxOf(scopedStore(root, b.id)), manual);
  const f = await runFxUpdate({ store: root, now: () => clock + 5000, fetch: async () => { throw new Error("down"); } });
  assert.deepEqual(f, { teams: 2, updated: 0, skipped: 1, failed: 1 });
  assert.equal((await fxOf(scopedStore(root, a.id))).EUR, 0.93, "letzte Kurse bleiben");
}

// ---- API (Entwicklungsmodus, ohne Passwort)
{
  const store = createMemoryStore();
  let fetchImpl = okFetch;
  const api = async (method, path, { token, body } = {}) =>
    handleApi({ method, path: "/api" + path, query: new URLSearchParams(), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) }, bodyText: body === undefined ? "" : JSON.stringify(body) },
      { env: {}, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: (...a) => fetchImpl(...a) });
  const s = (await api("GET", "/dev/session")).body;
  const put = async (token, fx) => {
    const cur = (await api("GET", "/db", { token })).body;
    return api("PUT", "/db", { token, body: { baseVersion: cur.version, data: { ...(cur.data || { schema: 1 }), settings: { fx } } } });
  };
  assert.equal((await put(s.token, { EUR: 0.9, USD: 0.8, date: "", mode: "auto" })).status, 200);
  assert.equal((await api("POST", "/fx/refresh", { token: s.token })).status, 200);
  const db = (await api("GET", "/db", { token: s.token })).body.data;
  assert.equal(db.settings.fx.EUR, 0.93); assert.equal(db.settings.fx.source, FX_SOURCE);
  assert.equal((await api("GET", "/fx/refresh", { token: s.token })).status, 405);
  fetchImpl = async () => resp(500, {});
  const failed = await api("POST", "/fx/refresh", { token: s.token });
  assert.equal(failed.status, 200); assert.equal(failed.body.ok, false); assert.equal(failed.body.status, "failed");
  assert.equal((await api("GET", "/db", { token: s.token })).body.data.settings.fx.EUR, 0.93, "letzte Kurse bleiben");
  // Mitglied darf nicht
  const liz = (await api("POST", "/dev/session", { body: { as: "liz" } })).body;
  assert.equal((await api("POST", "/fx/refresh", { token: liz.token })).status, 403);
  // manuell → 409
  await put(s.token, { EUR: 0.95, USD: 0.81, date: "2026-11-03", mode: "manual" });
  fetchImpl = okFetch;
  const man = await api("POST", "/fx/refresh", { token: s.token });
  assert.equal(man.status, 200); assert.equal(man.body.status, "manual");
}
console.log("Wechselkurse (automatisch): alle Prüfungen bestanden");
