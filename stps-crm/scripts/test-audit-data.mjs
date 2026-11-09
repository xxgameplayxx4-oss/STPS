#!/usr/bin/env node
// Prüft Audit-Fixes: Einstellungen nur für Admins (PUT /api/db), /api/ping, Datei-Kontingent, Push-Host-Allowlist – Aufruf: node scripts/test-audit-data.mjs
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { cleanSubscription } from "../netlify/functions/lib/push.mjs";
import { withSessionToken } from "./lib/session-token.mjs";

const store = createMemoryStore();
const env = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
let clock = Date.parse("2026-11-07T08:00:00Z");
const deps = (e = env) => ({ env: e, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0 });
async function rawApi(method, path, { token, team, body, bytes, query, e } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}), ...(bytes ? { "content-type": "application/octet-stream" } : {}) };
  return handleApi({ method, path: "/api" + path, query: new URLSearchParams(query || {}), headers, bodyText: body === undefined ? "" : JSON.stringify(body), ...(bytes ? { bodyBuffer: bytes } : {}) }, deps(e));
}
// Sitzungs-Token kommt nur noch per Set-Cookie (nicht im Body): für Bearer-Aufrufe der Tests aus dem Cookie übernehmen
const api = async (method, path, opts) => { const r = await rawApi(method, path, opts); return /^\/(login|me\/password)$/.test(path) ? withSessionToken(r) : r; };
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

// ---- Setup: Superadmin, Team, Team-Admin, Mitglied
const PW = "Neues-Passwort-123456";
const su = ok(await api("POST", "/login", { body: { username: "root", password: env.CRM_PASSWORD } }));
const sa = ok(await api("POST", "/me/password", { token: su.token, body: { current: env.CRM_PASSWORD, new: PW } })).token;
const teamId = ok(await api("POST", "/teams", { token: sa, body: { name: "Testteam" } }), 201).team.id;
async function mkUser(username, role) {
  const c = ok(await api("POST", "/users", { token: sa, body: { username, displayName: username.toUpperCase(), role, teamId } }), 201);
  const l = ok(await api("POST", "/login", { body: { username, password: c.temporaryPassword } }));
  return ok(await api("POST", "/me/password", { token: l.token, body: { current: c.temporaryPassword, new: PW } })).token;
}
const admin = await mkUser("adm", "admin");
const member = await mkUser("mem", "member");

const cur = ok(await api("GET", "/db", { token: admin }));
const base = cur.data || { schema: 1, settings: { billing: { banks: [{ iban: "CH9300762011623852957" }], warengruppen: [] } } };
base.settings = { ...(base.settings || {}), billing: { ...(base.settings?.billing || {}), banks: [{ iban: "CH9300762011623852957" }], warengruppen: base.settings?.billing?.warengruppen ?? [] } };
let version = ok(await api("PUT", "/db", { token: admin, body: { baseVersion: cur.version, data: base } })).version;
const fresh = async (tok) => structuredClone(ok(await api("GET", "/db", { token: tok })).data);

// ---- M2
{
  const d = await fresh(member);
  d.settings.billing.banks = [{ iban: "CH0000000000000000000" }];
  const r = await api("PUT", "/db", { token: member, body: { baseVersion: version, data: d } });
  assert.equal(r.status, 403, "Mitglied darf Bankkonten nicht ändern");
  assert.equal(r.body.reason, "settings_admins_only");
}
{
  const d = await fresh(member);
  d.settings.company = { name: "Fremd AG" };
  assert.equal((await api("PUT", "/db", { token: member, body: { baseVersion: version, data: d } })).status, 403, "neue Firmendaten durch Mitglied");
}
{
  const d = await fresh(member);
  d.customers = [...(d.customers || [])]; // normale Änderung ohne Einstellungen
  d.lists = { ...(d.lists || {}), note: ["x"] };
  const r = ok(await api("PUT", "/db", { token: member, body: { baseVersion: version, data: d } }));
  version = r.version;
}
{
  const d = await fresh(admin);
  d.settings.billing.banks = [{ iban: "CH1111111111111111111" }];
  version = ok(await api("PUT", "/db", { token: admin, body: { baseVersion: version, data: d } })).version;
  const d2 = await fresh(sa === null ? admin : admin);
  assert.equal(d2.settings.billing.banks[0].iban, "CH1111111111111111111", "Admin darf Bankkonten ändern");
}
{
  const d = await fresh(member); // Mitglied sieht den neuen Stand und speichert ihn unverändert
  version = ok(await api("PUT", "/db", { token: member, body: { baseVersion: version, data: d } })).version;
}

// ---- I1
{
  const r = await api("GET", "/ping");
  assert.deepEqual(r.body, { ok: true }, "unauthentifiziert nur {ok:true}");
  const a = await api("GET", "/ping", { token: admin });
  assert.equal(a.body.ok, true);
  assert.equal(a.body.backend, "blobs", "mit Sitzung: Backend");
  assert.deepEqual((await api("GET", "/ping", { e: { CRM_SECRET: "" } })).body, { ok: true }, "auch ohne Konfiguration keine Details");
}

// ---- L7: Kontingent
{
  const PDF = (n) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(n, 0x78)]);
  const small = { FILES_QUOTA_MB: "1" };
  ok(await api("POST", "/files", { token: member, bytes: PDF(600 * 1024), query: { name: "a.pdf" }, e: { ...env, ...small } }), 201);
  const r = await api("POST", "/files", { token: member, bytes: PDF(600 * 1024), query: { name: "b.pdf" }, e: { ...env, ...small } });
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "files_quota");
}

// ---- L8: Push-Hosts
const sub = (endpoint) => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
for (const good of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
  assert.equal(cleanSubscription(sub(good)).endpoint, good, good);
}
for (const bad of ["https://evil.googleapis.com/x", "https://storage.googleapis.com/x", "https://www.apple.com/x", "https://mozilla.com/x", "https://foo.windows.com/x", "https://push.apple.com.evil.org/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://notify.windows.com/x"]) {
  assert.throws(() => cleanSubscription(sub(bad)), (e) => e.status === 400, bad);
}

console.log("test-audit-data: ok");
