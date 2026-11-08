#!/usr/bin/env node
// Sicherheit: Dev-Modus in Produktion, Client-IP hinter Proxy, Login-Throttle-Eviction – Aufruf: node scripts/test-security.mjs  (npm run test:security)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { devEnvEnabled, isProductionEnv } from "../netlify/functions/lib/devmode.mjs";
import { clientIp } from "../netlify/functions/lib/http.mjs";
import { throttleKeys, recordFailure, checkLock, MAX_FAILS } from "../netlify/functions/lib/login-throttle.mjs";

// A) Dev-Modus
const saved = { NODE_ENV: process.env.NODE_ENV, CRM_ENV: process.env.CRM_ENV };
delete process.env.NODE_ENV; delete process.env.CRM_ENV;
assert.equal(devEnvEnabled({}), true, "lokal: Dev-Modus möglich");
for (const e of [{ NODE_ENV: "production" }, { CRM_ENV: "Production" }, { DB_DRIVER: "mysql" }, { DB_HOST: "db.example" }]) {
  assert.equal(isProductionEnv(e), true);
  assert.equal(devEnvEnabled(e), false, JSON.stringify(e));
}
process.env.NODE_ENV = "production";
assert.equal(devEnvEnabled({}), false, "process.env.NODE_ENV=production");
const api = (env) => handleApi({ method: "GET", path: "/api/dev/session", query: new URLSearchParams(), headers: {}, bodyText: "" }, { env, store: createMemoryStore(), delay: async () => {} });
let r = await api({});
assert.ok(r.status >= 400 && !r.body.token, "Produktion ohne Secret: kein Dev-Token");
r = await api({ CRM_SECRET: "x".repeat(32) });
assert.ok(r.status >= 400 && !r.body.token, "Produktion mit Secret: /dev/session nicht verfügbar");
if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.NODE_ENV;
if (saved.CRM_ENV !== undefined) process.env.CRM_ENV = saved.CRM_ENV;

// B) clientIp
const h = { "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.7, 10.0.0.1", "x-nf-client-connection-ip": "1.2.3.4" };
assert.equal(clientIp(h, {}), "1.2.3.4", "ohne TRUST_PROXY nur Netlify-Header");
assert.equal(clientIp({ "x-real-ip": "203.0.113.5" }, {}), "", "ohne TRUST_PROXY wird X-Real-IP ignoriert");
assert.equal(clientIp(h, { TRUST_PROXY: "1" }), "203.0.113.5", "TRUST_PROXY: X-Real-IP, Netlify-Header ignoriert");
assert.equal(clientIp({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }, { TRUST_PROXY: "1" }), "198.51.100.7");
assert.equal(clientIp({ "x-real-ip": "<script>" }, { TRUST_PROXY: "1" }), "");
assert.deepEqual(throttleKeys("anna", ""), ["u:anna"], "ohne IP nur pro Benutzername");
assert.deepEqual(throttleKeys("anna", "1.2.3.4"), ["u:anna", "ip:1.2.3.4"]);

// C) Throttle: Sperre überlebt Fluten
const store = createMemoryStore();
const now = Date.parse("2026-11-05T09:00:00Z");
for (let i = 0; i < MAX_FAILS; i++) await recordFailure(store, ["u:admin"], now);
assert.equal((await checkLock(store, ["u:admin"], now)).locked, true);
for (let i = 0; i < 2300; i++) await recordFailure(store, [`u:rnd${i}`], now + 1000);
assert.equal((await checkLock(store, ["u:admin"], now + 2000)).locked, true, "Sperre darf durch Fluten nicht verdrängt werden");
console.log("test-security: OK");
