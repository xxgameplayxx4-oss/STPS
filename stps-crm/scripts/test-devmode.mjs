#!/usr/bin/env node
// Entwicklungsmodus (kein CRM_PASSWORD) und Passwortpflicht (CRM_PASSWORD gesetzt) – Aufruf: node scripts/test-devmode.mjs  (npm run test:devmode)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { DEV_SECRET } from "../netlify/functions/lib/devmode.mjs";

const clock = Date.parse("2026-11-05T09:00:00Z");
const mk = (env, store) => async (method, path, { token, team, body } = {}) =>
  handleApi(
    { method, path: "/api" + path, query: new URLSearchParams(), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}) }, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0 },
  );
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.body)); return r.body; };

// ================= A) Entwicklungsmodus: kein CRM_PASSWORD, kein CRM_SECRET =================
{
  const store = createMemoryStore();
  const api = mk({ CRM_DEV_MODE: "on" }, store);
  const ping = ok(await api("GET", "/ping"));
  assert.equal(ping.dev, true);
  assert.equal(ping.configured, true, "ohne CRM_SECRET gilt der feste Entwicklungs-Schlüssel");

  // /api liefert die Sitzung ohne Anmeldung (Standard: Pascal, Team-Admin)
  const s = ok(await api("GET", "/dev/session"));
  assert.equal(s.user.username, "pascal");
  assert.equal(s.user.role, "admin");
  assert.equal(s.team.name, "SwissTech Precision Solutions");
  assert.deepEqual(s.devUsers.map((u) => u.key), ["admin", "pascal", "liz", "marco"]);
  assert.ok(s.token && !s.mustChangePassword);

  // Team und vier Konten wurden angelegt
  const users = ok(await api("GET", "/users", { token: s.token })).users;
  const by = Object.fromEntries(users.map((u) => [u.username, u]));
  assert.equal(by.pascal.role, "admin");
  assert.equal(by.liz.role, "member"); assert.equal(by.liz.management, true);
  assert.equal(by.marco.role, "member"); assert.equal(by.marco.management, true);
  assert.equal(by.admin, undefined, "der Superadmin bleibt für Team-Mitglieder unsichtbar");

  // Rollenwechsel
  const liz = ok(await api("POST", "/dev/session", { body: { as: "liz" } }));
  assert.equal(liz.user.role, "member");
  assert.equal(ok(await api("GET", "/me", { token: liz.token })).user.username, "liz");
  const admin = ok(await api("POST", "/dev/session", { body: { as: "admin" } }));
  assert.equal(admin.user.role, "superadmin");
  assert.equal(admin.enterTeamId, s.team.id, "der Superadmin betritt das Team");
  ok(await api("GET", "/db", { token: admin.token, team: admin.enterTeamId }));
  assert.equal((await api("POST", "/dev/session", { body: { as: "root" } })).status, 400);

  // ohne Token: läuft als Pascal (kein Login nötig); Daten lesen/schreiben möglich
  assert.equal(ok(await api("GET", "/me")).user.username, "pascal");
  ok(await api("GET", "/db"));
  // Ein ungültiges (z. B. vom Produktivbetrieb übrig gebliebenes) Token führt ebenfalls nicht zum Login
  assert.equal(ok(await api("GET", "/me", { token: "v2.x.y" })).user.username, "pascal");
  // Keine doppelte Anlage bei wiederholten Aufrufen
  assert.equal(ok(await api("GET", "/users", { token: s.token })).users.length, users.length);

  // Mit eigenem CRM_SECRET bleibt es dabei (kein Dev-Schlüssel)
  const own = mk({ CRM_DEV_MODE: "on", CRM_SECRET: "e".repeat(32) }, createMemoryStore());
  const t1 = ok(await own("GET", "/dev/session")).token;
  assert.equal(ok(await own("GET", "/me", { token: t1 })).user.username, "pascal");
  assert.notEqual(t1.split(".")[2], undefined);
  assert.ok(DEV_SECRET.length >= 16);
}

// ================= B) CRM_PASSWORD gesetzt: Verhalten wie zuvor, Anmeldung Pflicht =================
{
  const store = createMemoryStore();
  const env = { CRM_SECRET: "s".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
  const api = mk(env, store);
  const ping = ok(await api("GET", "/ping"));
  assert.equal(ping.dev, undefined, "kein dev-Flag");
  assert.equal((await api("GET", "/dev/session")).status, 404, "Dev-Sitzung nicht verfügbar");
  assert.equal((await api("POST", "/dev/session", { body: { as: "admin" } })).status, 404);
  for (const [m, p] of [["GET", "/me"], ["GET", "/db"], ["GET", "/users"], ["GET", "/teams"], ["PUT", "/db"]]) {
    assert.equal((await api(m, p)).status, 401, `${m} ${p} ohne Token → 401`);
  }
  assert.equal((await api("GET", "/me", { token: "v2.x.y" })).status, 401);
  // es wurden keine Beispielkonten angelegt
  assert.equal(store.m.has("users"), false);
  assert.equal(store.m.has("teams"), false);
  // falsches Passwort → 401, richtiges Erst-Passwort → Superadmin
  assert.equal((await api("POST", "/login", { body: { username: "root", password: "falsch" } })).status, 401);
  const login = ok(await api("POST", "/login", { body: { username: "root", password: env.CRM_PASSWORD } }));
  assert.equal(login.user.role, "superadmin");
  // Ein mit dem festen Entwicklungs-Schlüssel gebildetes Token wird nicht akzeptiert
  const { createSessionToken } = await import("../netlify/functions/lib/session.mjs");
  const forged = createSessionToken({ CRM_SECRET: DEV_SECRET, __CRM_DEV_ACTIVE: true }, { id: login.user.id, tokenVersion: 0 }, clock);
  assert.equal((await api("GET", "/me", { token: forged })).status, 401);
  // Ohne CRM_SECRET: weiterhin Konfigurationsfehler (kein Dev-Schlüssel)
  const noSecret = ok(await mk({ CRM_PASSWORD: "abc" }, createMemoryStore())("GET", "/ping"));
  assert.equal(noSecret.configured, false);
  assert.equal((await mk({ CRM_PASSWORD: "abc" }, createMemoryStore())("GET", "/me")).status, 500);
}

// ================= C) Ohne CRM_PASSWORD, aber mit echten Konten (nach der Erst-Anmeldung): Anmeldung bleibt Pflicht =================
{
  const store = createMemoryStore();
  const env1 = { CRM_SECRET: "s".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
  ok(await mk(env1, store)("POST", "/login", { body: { username: "root", password: env1.CRM_PASSWORD } }));
  const api = mk({ CRM_SECRET: env1.CRM_SECRET }, store); // CRM_PASSWORD wurde später entfernt
  assert.equal(ok(await api("GET", "/ping")).dev, undefined);
  assert.equal((await api("GET", "/me")).status, 401);
  assert.equal((await api("GET", "/dev/session")).status, 404);
  // ausdrücklich abgeschaltet
  const off = mk({ CRM_DEV_MODE: "off" }, createMemoryStore());
  assert.equal(ok(await off("GET", "/ping")).configured, false);
}

// ================= C2) Dev-Modus nur ausdrücklich lokal (CRM_DEV_MODE=on bzw. netlify dev), nie auf bereitgestellten Hosts =================
{
  const probe = async (env) => {
    const api = mk(env, createMemoryStore());
    const ping = ok(await api("GET", "/ping"));
    const sess = await api("GET", "/dev/session");
    const anon = await api("GET", "/me");
    return { dev: ping.dev === true, sess: sess.status, anon: anon.status, token: Boolean(sess.body?.token) };
  };
  const off = (r, why) => { assert.equal(r.dev, false, why); assert.equal(r.sess, 404, why); assert.notEqual(r.anon, 200, why); assert.equal(r.token, false, why); };
  // Standard (leere Umgebung, deployter Host ohne Passwort): KEIN Dev-Modus mehr, kein Auto-Login
  off(await probe({}), "leere Umgebung");
  off(await probe({ CRM_SECRET: "s".repeat(32) }), "mit Secret, ohne Passwort");
  off(await probe({ CONTEXT: "production" }), "Netlify CONTEXT");
  off(await probe({ NETLIFY: "true", CRM_DEV_MODE: "on" }), "Netlify-Build/-Host trotz CRM_DEV_MODE=on");
  off(await probe({ AWS_LAMBDA_FUNCTION_NAME: "api", CRM_DEV_MODE: "on" }), "Lambda-Laufzeit trotz CRM_DEV_MODE=on");
  off(await probe({ NODE_ENV: "production", CRM_DEV_MODE: "on" }), "NODE_ENV=production trotz on");
  off(await probe({ NETLIFY_DEV: "true", CRM_DEV_MODE: "off" }), "off gewinnt");
  off(await probe({ CRM_DEV_MODE: "on", CRM_PASSWORD: "x" }), "CRM_PASSWORD gesetzt");
  // Ausdrücklich lokal: aktiv
  for (const env of [{ CRM_DEV_MODE: "on" }, { NETLIFY_DEV: "true" }, { NETLIFY_DEV: "true", NETLIFY: "true", CONTEXT: "dev", SITE_ID: "x" }]) {
    const r = await probe(env);
    assert.equal(r.dev, true, JSON.stringify(env)); assert.equal(r.sess, 200); assert.equal(r.anon, 200);
  }
  // Der bekannte Dev-Schlüssel signiert/prüft ausserhalb des Dev-Modus nie (fail-closed), auch nicht als CRM_SECRET gesetzt
  const sess = await import("../netlify/functions/lib/session.mjs");
  assert.throws(() => sess.createSessionToken({ CRM_SECRET: DEV_SECRET }, { id: "u_1" }, clock), /CRM_SECRET/);
  assert.equal(sess.getSecret({ CRM_SECRET: DEV_SECRET }), null);
  const prodPing = ok(await mk({ CRM_SECRET: DEV_SECRET }, createMemoryStore())("GET", "/ping"));
  assert.equal(prodPing.configured, false, "ohne eigenes Secret: nicht konfiguriert (klare Fehlermeldung)");
  assert.match(prodPing.message, /CRM_SECRET/);
  assert.equal((await mk({}, createMemoryStore())("GET", "/db")).status, 500, "fail-closed: nicht konfiguriert");
  // Im Dev-Modus mit Dev-Schlüssel signierte Tokens gelten nicht mehr, sobald der Dev-Modus aus ist
  const devApi = mk({ CRM_DEV_MODE: "on" }, createMemoryStore());
  const devTok = ok(await devApi("GET", "/dev/session")).token;
  const prodApi = mk({ CRM_SECRET: "p".repeat(32) }, createMemoryStore());
  assert.equal((await prodApi("GET", "/me", { token: devTok })).status, 401);
}

// ================= D) SharePoint-Export läuft stündlich =================
{
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../netlify/functions/sharepoint-export.mjs", import.meta.url), "utf8");
  assert.match(src, /schedule:\s*"0 \* \* \* \*"/, "Cron stündlich");
  assert.ok(!/0 20 \* \* \*/.test(src));
}

console.log("test-devmode: OK");
