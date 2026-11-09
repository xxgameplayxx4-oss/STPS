#!/usr/bin/env node
// Audit 2026-11-09: IPv6-/64-Sperre, Versuch vor Prüfung zählen + scrypt-Semaphore, Token nicht im Body für Browser, CRM_SECRET >= 32, TRUST_PROXY-Pflicht, Dev-Modus nur Loopback
// Aufruf: node scripts/test-audit-fixes.mjs
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { normalizeIp, throttleKeys, withScryptSlot, MAX_FAILS } from "../netlify/functions/lib/login-throttle.mjs";
import { getSecret, MIN_SECRET_LENGTH } from "../netlify/functions/lib/session.mjs";
import { trustProxyProblem } from "../netlify/functions/lib/http.mjs";
import { devEnvEnabled, isLoopbackHost } from "../netlify/functions/lib/devmode.mjs";
import { tokenOf } from "./lib/session-token.mjs";

// M1: IPv6 -> /64
assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
assert.equal(normalizeIp("2001:db8:1:2:1:1:1:1"), normalizeIp("2001:DB8:1:2:ffff:0:0:9"));
assert.equal(normalizeIp("2001:db8::1"), "2001:db8:0:0::/64");
assert.equal(normalizeIp("2001:db8:0:0:1::1"), "2001:db8:0:0::/64");
assert.notEqual(normalizeIp("2001:db8:1:2::1"), normalizeIp("2001:db8:1:3::1"));
assert.equal(normalizeIp("1.2.3.4"), "1.2.3.4");
assert.equal(normalizeIp("::ffff:1.2.3.4"), "::ffff:1.2.3.4");
assert.deepEqual(throttleKeys("a", "2001:db8:1:2::5").hard, throttleKeys("a", "2001:db8:1:2::99").hard);
assert.deepEqual(throttleKeys("a", "1.2.3.4").hard, ["ipu:1.2.3.4|a", "ip:1.2.3.4"]);

// L9: CRM_SECRET >= 32
assert.equal(MIN_SECRET_LENGTH, 32);
assert.equal(getSecret({ CRM_SECRET: "x".repeat(31) }), null);
assert.equal(getSecret({ CRM_SECRET: "x".repeat(32) }), "x".repeat(32));

// L6: TRUST_PROXY in Produktion Pflicht
assert.equal(trustProxyProblem({}), null, "Entwicklung: kein Zwang");
assert.ok(trustProxyProblem({ NODE_ENV: "production" }));
assert.ok(trustProxyProblem({ DB_DRIVER: "mysql" }));
assert.ok(trustProxyProblem({ NODE_ENV: "production", TRUST_PROXY: "maybe" }));
assert.equal(trustProxyProblem({ NODE_ENV: "production", TRUST_PROXY: "1" }), null);
assert.equal(trustProxyProblem({ DB_DRIVER: "mysql", TRUST_PROXY: "off" }), null);

// L5: Dev-Modus nur Loopback
assert.ok(isLoopbackHost("127.0.0.1") && isLoopbackHost("::1") && isLoopbackHost("localhost") && !isLoopbackHost("0.0.0.0") && !isLoopbackHost("192.168.1.5"));
const savedHost = process.env.HOST, savedNode = process.env.NODE_ENV;
delete process.env.HOST; delete process.env.NODE_ENV;
assert.equal(devEnvEnabled({ CRM_DEV_MODE: "on" }), true);
assert.equal(devEnvEnabled({ CRM_DEV_MODE: "on", HOST: "127.0.0.1" }), true);
assert.equal(devEnvEnabled({ CRM_DEV_MODE: "on", HOST: "0.0.0.0" }), false);
process.env.HOST = "0.0.0.0";
assert.equal(devEnvEnabled({ CRM_DEV_MODE: "on" }), false, "HOST aus process.env zählt");
if (savedHost === undefined) delete process.env.HOST; else process.env.HOST = savedHost;
if (savedNode !== undefined) process.env.NODE_ENV = savedNode;

// L1: Semaphore
{
  let release; const gate = new Promise((r) => { release = r; });
  const running = [1, 2].map(() => withScryptSlot(() => gate, 2));
  assert.equal(await withScryptSlot(async () => 1, 2), null, "voll: abgelehnt");
  release(); await Promise.all(running);
  assert.deepEqual(await withScryptSlot(async () => 7, 2), { value: 7 }, "danach wieder frei");
}

// Login: Versuche werden vor der Prüfung gezählt; Token nur ohne CSRF-Header im Body
const env = { CRM_SECRET: "s".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const store = createMemoryStore();
const clock = Date.parse("2026-11-09T09:00:00Z");
const call = (method, path, { ip, body, headers = {} } = {}) =>
  handleApi(
    { method, path: "/api" + path, origin: "https://crm.example.org", query: new URLSearchParams(), headers: { ...(ip ? { "x-nf-client-connection-ip": ip } : {}), ...headers }, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0 },
  );
const login = (password, ip, headers) => call("POST", "/login", { ip, headers, body: { username: "root", password } });

const script = await login(env.CRM_PASSWORD, "10.0.0.1");
assert.equal(script.status, 200);
assert.equal(script.body.token, undefined, "Token nie im Body (auch nicht für Skripte)");
assert.ok(tokenOf(script), "Token kommt per Set-Cookie");
const browser = await login(env.CRM_PASSWORD, "10.0.0.1", { "x-requested-with": "stps-crm" });
assert.equal(browser.status, 200);
assert.equal(browser.body.token, undefined, "Browser: Token nicht im Body (nur HttpOnly-Cookie)");
assert.ok(tokenOf(browser), "Browser: Token per Set-Cookie");
assert.ok(browser.body.user);

// Burst: gleichzeitige Fehlversuche von derselben IPv6-/64 (verschiedene Adressen) – höchstens MAX_FAILS werden geprüft, der Rest 429
const statuses = [];
for (let wave = 0; wave < 3; wave++) statuses.push(...(await Promise.all(Array.from({ length: 4 }, (_, i) => login("falsch", `2001:db8:9:9::${wave * 4 + i + 1}`)))).map((r) => r.status));
assert.equal(statuses.filter((s) => s === 401).length, MAX_FAILS, `genau ${MAX_FAILS} Prüfungen: ${statuses}`);
assert.ok(statuses.every((s) => s === 401 || s === 429), String(statuses));
// Semaphore über die API: mehr gleichzeitige Prüfungen als Plätze -> 429 «busy» (zählt nicht als Fehlversuch)
const busy = await Promise.all(Array.from({ length: 8 }, () => login("falsch", "203.0.113.50")));
assert.ok(busy.some((r) => r.status === 429 && r.body.error === "busy"), "scrypt-Semaphore greift");
assert.equal((await login(env.CRM_PASSWORD, "2001:db8:9:9::77")).status, 429, "auch das richtige Passwort aus derselben /64 ist gesperrt");

// Erfolg gibt den Versuch frei: viele erfolgreiche Anmeldungen sperren die IP nicht
for (let i = 0; i < MAX_FAILS + 3; i++) assert.equal((await login(env.CRM_PASSWORD, "198.51.100.20")).status, 200);
console.log("test-audit-fixes: OK");
