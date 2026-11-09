#!/usr/bin/env node
// Sitzungen: Login-Sperre je IP (kein Aussperren per Benutzername), HttpOnly-Cookie + CSRF-Header, Widerruf beim Abmelden, APP_URL in Produktion
// Aufruf: node scripts/test-session.mjs  (npm run test:session)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { csrfOk, cookieToken, sessionCookie } from "../netlify/functions/lib/http.mjs";
import { verifySessionToken } from "../netlify/functions/lib/session.mjs";
import { LOCK_MS, SOFT_MAX_MS, MAX_FAILS } from "../netlify/functions/lib/login-throttle.mjs";
import { outlookConfig } from "../netlify/functions/lib/outlook-graph.mjs";
import { REVOKE_KEY } from "../netlify/functions/lib/revocations.mjs";
import { tokenOf } from "./lib/session-token.mjs";

let clock = Date.parse("2026-11-05T09:00:00Z");
const env = { CRM_SECRET: "s".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const store = createMemoryStore();
const delays = [];
const call = (method, path, { token, cookie, ip, body, origin = "https://crm.example.org", e = env } = {}) =>
  handleApi(
    { method, path: "/api" + path, origin, query: new URLSearchParams(), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...(ip ? { "x-nf-client-connection-ip": ip } : {}) }, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env: e, store, now: () => clock, delay: async (ms) => { delays.push(ms); }, scryptParams: { N: 1024 }, userCacheMs: 0 },
  );
const login = (password, ip, username = "root") => call("POST", "/login", { ip, body: { username, password } });
const GOOD = env.CRM_PASSWORD;

// ---------- Erst-Anmeldung (legt den Superadmin an, Passwort bleibt GOOD bis zum Wechsel)
const first = await login(GOOD, "10.0.0.1");
assert.equal(first.status, 200);
const rootId = first.body.user.id;

// ---------- 2) Login-Sperre: je IP, nie je Benutzername
for (let i = 0; i < MAX_FAILS; i++) assert.equal((await login("falsch", "203.0.113.9")).status, 401);
assert.equal((await login("falsch", "203.0.113.9")).status, 429, "Angreifer-IP nach 5 Fehlversuchen gesperrt");
assert.equal((await login(GOOD, "203.0.113.9")).status, 429, "auch mit richtigem Passwort von dieser IP");
const real = await login(GOOD, "198.51.100.20");
assert.equal(real.status, 200, "der echte Benutzer kommt von einer anderen IP trotzdem hinein");
assert.ok(delays.some((d) => d > 0 && d <= SOFT_MAX_MS), "weiche Bremse: wachsende Wartezeit nach mehreren Fehlversuchen");
assert.ok(Math.max(...delays) <= SOFT_MAX_MS);
// Sperre läuft ab
clock += LOCK_MS + 1000;
assert.equal((await login(GOOD, "203.0.113.9")).status, 200, "nach Ablauf wieder möglich");
// Ohne bekannte IP: keine Sperre pro Benutzername – der echte Benutzer kommt immer hinein
for (let i = 0; i < 12; i++) await login("falsch", "");
assert.equal((await login(GOOD, "")).status, 200, "ohne IP nie ausgesperrt (nur Verzögerung)");
// IP-weit: viele Benutzernamen von einer IP
for (let i = 0; i < 30; i++) await login("x", "192.0.2.77", `user${i}`);
assert.equal((await login(GOOD, "192.0.2.77")).status, 429, "IP-weite Sperre");
// Falsches Passwort beim Passwortwechsel sperrt die Anmeldung nie
const t0 = tokenOf(real);
for (let i = 0; i < 6; i++) await call("POST", "/me/password", { token: t0, body: { current: "nope", new: "Neues-Passwort-123" } });
assert.equal((await login(GOOD, "198.51.100.21")).status, 200);

// ---------- 3) Cookie
const r1 = await login(GOOD, "198.51.100.30");
assert.equal(r1.status, 200);
assert.equal(r1.body.token, undefined, "kein Token im Body");
const sc = r1.setCookie;
assert.equal(sc.length, 1);
assert.match(sc[0], /^__Host-stps_session=v2\.[\w.-]+; Max-Age=604800; Path=\/; HttpOnly; SameSite=Strict; Secure$/);
const cookieHdr = sc[0].split(";")[0];
assert.equal((await call("GET", "/me", { cookie: cookieHdr })).status, 200, "Cookie reicht zur Anmeldung");
assert.equal((await call("GET", "/me", { cookie: "foo=bar; " + cookieHdr + "; x=y" })).status, 200);
assert.equal((await call("GET", "/me")).status, 401);
assert.equal((await call("GET", "/me", { cookie: cookieHdr.replace("__Host-", "") })).status, 401, "Name ohne __Host- gilt bei https nicht");
assert.equal((await call("GET", "/me", { token: tokenOf(r1) })).status, 200, "Bearer bleibt für Skripte");
assert.equal((await call("GET", "/me", { token: "v2.x.y", cookie: cookieHdr })).status, 401, "ungültiger Bearer fällt nicht auf das Cookie zurück");
// localhost über http: kein Secure, einfacher Name
const lh = await call("POST", "/login", { origin: "http://localhost:8888", ip: "198.51.100.31", body: { username: "root", password: GOOD } });
assert.match(lh.setCookie[0], /^stps_session=v2\.[\w.-]+; Max-Age=604800; Path=\/; HttpOnly; SameSite=Strict$/);
assert.equal((await call("GET", "/me", { origin: "http://localhost:8888", cookie: lh.setCookie[0].split(";")[0] })).status, 200);
assert.equal((await call("GET", "/me", { origin: "http://localhost:8888", cookie: "__Host-" + lh.setCookie[0].split(";")[0] })).status, 401);
// http auf einem fremden Host: Secure (Cookie wird nie im Klartext gesendet)
assert.match(sessionCookie("t", { origin: "http://crm.example.org", maxAgeSec: 5 }), /; Secure$/);
assert.equal(cookieToken({ cookie: "stps_session=abc" }, { origin: "https://h" }), "", "Subdomain-Cookie ohne Präfix wird in Produktion ignoriert");

// CSRF-Regel
assert.equal(csrfOk("GET", {}), true);
assert.equal(csrfOk("POST", {}), false);
assert.equal(csrfOk("PUT", { cookie: "a=b" }), false);
assert.equal(csrfOk("DELETE", { "x-requested-with": "fetch" }), false);
assert.equal(csrfOk("POST", { "x-requested-with": "stps-crm" }), true);
assert.equal(csrfOk("POST", { authorization: "Bearer abc" }), true);
{
  const api = (await import("../netlify/functions/api.mjs")).default;
  const post = (headers) => api(new Request("http://localhost:8888/api/db", { method: "PUT", headers, body: "{}" }), {});
  const bad = await post({ cookie: cookieHdr });
  assert.equal(bad.status, 403); assert.equal((await bad.json()).error, "csrf");
  assert.equal((await post({ cookie: cookieHdr, "content-type": "text/plain" })).status, 403);
  assert.notEqual((await post({ cookie: cookieHdr, "x-requested-with": "stps-crm" })).status, 403, "mit Header wird die Anfrage verarbeitet");
  const lg = await api(new Request("http://localhost:8888/api/login", { method: "POST", body: "{}" }), {});
  assert.equal(lg.status, 403, "auch /login (Login-CSRF)");
}

// ---------- 6) Widerruf einzelner Sitzungen
const a = await login(GOOD, "198.51.100.40");
const b = await login(GOOD, "198.51.100.41");
const ca = a.setCookie[0].split(";")[0];
const claimsA = verifySessionToken(tokenOf(a), env, clock);
const claimsB = verifySessionToken(tokenOf(b), env, clock);
assert.match(claimsA.sid, /^[0-9a-f]{32}$/); assert.notEqual(claimsA.sid, claimsB.sid);
assert.equal((await call("GET", "/me", { token: tokenOf(a) })).status, 200);
const out = await call("POST", "/logout", { cookie: ca });
assert.equal(out.status, 200);
assert.equal(out.setCookie.length, 2);
assert.ok(out.setCookie.every((c) => /Max-Age=0/.test(c) && /HttpOnly/.test(c)));
assert.equal((await call("GET", "/me", { token: tokenOf(a) })).status, 401, "abgemeldetes Token (Bearer) ist widerrufen");
assert.equal((await call("GET", "/me", { cookie: ca })).status, 401, "…und als Cookie");
assert.equal((await call("GET", "/me", { token: tokenOf(b) })).status, 200, "andere Sitzung bleibt gültig");
const rec = (await store.read(REVOKE_KEY)).value.revoked;
assert.equal(rec[claimsA.sid], claimsA.exp, "Eintrag läuft mit dem Token ab");
// Abgelaufene Einträge werden beim nächsten Widerruf entfernt
clock += 8 * 24 * 3600 * 1000;
const c = await login(GOOD, "198.51.100.42");
await call("POST", "/logout", { token: tokenOf(c) });
const rec2 = (await store.read(REVOKE_KEY)).value.revoked;
assert.equal(Object.keys(rec2).length, 1); assert.ok(!(claimsA.sid in rec2));
// Token ohne Sitzungs-ID (ältere Version) wird nicht mehr angenommen
{
  const { createHmac } = await import("node:crypto");
  const b64u = (x) => Buffer.from(x).toString("base64url");
  const payload = b64u(JSON.stringify({ uid: rootId, tv: 0, exp: clock + 100000 }));
  const key = createHmac("sha256", env.CRM_SECRET).update("stps-crm/session/v2").digest();
  const legacy = `v2.${payload}.${b64u(createHmac("sha256", key).update(`v2.${payload}`).digest())}`;
  assert.equal(verifySessionToken(legacy, env, clock), null);
}
// "Überall abmelden" (Token-Version) funktioniert weiterhin: Passwortwechsel macht andere Tokens ungültig
{
  const d = await login(GOOD, "198.51.100.50");
  const chg = await call("POST", "/me/password", { token: tokenOf(d), body: { current: GOOD, new: "Ganz-Neues-Passwort-9" } });
  assert.equal(chg.status, 200); assert.ok(chg.setCookie?.length === 1);
  assert.equal((await call("GET", "/me", { token: tokenOf(d) })).status, 401);
  assert.equal((await call("GET", "/me", { token: tokenOf(chg) })).status, 200);
}

// ---------- 5) APP_URL in Produktion
{
  const base = { MS_CLIENT_ID: "a", MS_CLIENT_SECRET: "b", CRM_SECRET: "s".repeat(32) };
  const origin = "https://evil.example";
  assert.equal(outlookConfig(base, { origin }).redirectUri, "https://evil.example/api/outlook/callback", "lokal: aus der Anfrage");
  for (const extra of [{ NODE_ENV: "production" }, { NETLIFY: "true" }, { CONTEXT: "production" }, { DB_DRIVER: "mysql" }]) {
    const cfg = outlookConfig({ ...base, ...extra }, { origin });
    assert.equal(cfg.redirectUri, "", JSON.stringify(extra) + ": Host/Origin wird nie benutzt");
    assert.equal(cfg.appUrlRequired, true);
  }
  assert.equal(outlookConfig({ ...base, NODE_ENV: "production", APP_URL: "https://crm.example.ch/" }, { origin }).redirectUri, "https://crm.example.ch/api/outlook/callback");
  assert.equal(outlookConfig({ ...base, NETLIFY: "true", URL: "https://site.netlify.app" }, { origin }).redirectUri, "https://site.netlify.app/api/outlook/callback", "Netlify-URL");
  assert.equal(outlookConfig({ ...base, NETLIFY_DEV: "true", NETLIFY: "true", CONTEXT: "dev" }, { origin: "http://localhost:8888" }).redirectUri, "http://localhost:8888/api/outlook/callback", "netlify dev bleibt lokal");
}

console.log("test-session: OK");
