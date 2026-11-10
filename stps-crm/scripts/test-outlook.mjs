#!/usr/bin/env node
// Prüft die Outlook-Kalender-Anbindung (je Benutzer, delegierte Anmeldung) gegen einen simulierten Microsoft-Dienst (Anmeldung + Graph) und den
// In-Memory-Store (ohne Netzwerk): Verbinden (PKCE/state), verschlüsseltes Token, Delta-Import, Änderung, Löschung, Serien, private Termine,
// CRM → Outlook, Schleifen-Schutz, widerrufenes Token, Team-Trennung, Zeitbudget – Aufruf: node scripts/test-outlook.mjs  (npm run test:outlook)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import * as OL from "../netlify/functions/lib/outlook.mjs";
import * as G from "../netlify/functions/lib/outlook-graph.mjs";
import { withSessionToken } from "./lib/session-token.mjs";

// ---------------------------------------------------------------- Simulierter Microsoft-Dienst
let clock = Date.parse("2026-10-25T08:00:00Z");
const iso = (ms = clock) => new Date(ms).toISOString();
const boxes = {}; // Benutzername -> { items: Map, log: [], n }
const box = (u) => (boxes[u] ??= { items: new Map(), log: [], n: 0 });
const sessions = new Map();
const refreshTokens = new Map(); // refresh token -> Benutzername
const challenges = {}; // code -> code_challenge (aus der Anmelde-Adresse)
const revoked = new Set();
const failWith = {}; // Benutzername -> { status, code, times?, method? }
let calls = [];
let tokenCalls = [];
let tick = 0; // Uhr pro Graph-Aufruf weiterstellen (Zeitbudget)
let pageSize = 2;
let seq = 0;

const R = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => body });
const wire = (it) => ({ ...it, start: { ...it.start }, end: { ...it.end } });
const mk = (id, subject, start, end, extra = {}) => ({
  id, iCalUId: "ical-" + id, subject, start: { dateTime: start + ".0000000", timeZone: "UTC" }, end: { dateTime: end + ".0000000", timeZone: "UTC" }, isAllDay: false, isCancelled: false,
  location: { displayName: "" }, bodyPreview: "", sensitivity: "normal", type: "singleInstance", categories: [], lastModifiedDateTime: iso(), webLink: "https://outlook.office.com/calendar/item/" + id, ...extra,
});
const outlook = (u) => ({
  put(item) { const b = box(u); item["@odata.etag"] = `W/"${++b.n}"`; item.lastModifiedDateTime = iso(); b.items.set(item.id, item); b.log.push({ id: item.id }); return item; },
  edit(id, patch) { const b = box(u); const it = { ...b.items.get(id), ...patch }; return this.put(it); },
  del(id) { const b = box(u); b.items.delete(id); b.log.push({ id, removed: true }); },
});

function pageOf(list, offset, sid, deltaIdx) {
  const slice = list.slice(offset, offset + pageSize);
  const end = offset + pageSize >= list.length;
  return R(200, {
    value: slice,
    ...(end ? { "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=${deltaIdx}` } : { "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=${sid}-${offset + pageSize}` }),
  });
}

async function msFetch(url, init = {}) {
  url = String(url);
  const method = init.method || "GET";
  if (url.startsWith("https://login.microsoftonline.com/")) {
    const p = new URLSearchParams(init.body);
    tokenCalls.push({ url, params: Object.fromEntries(p) });
    assert.equal(p.get("client_secret"), "csecret-xyz");
    if (p.get("grant_type") === "authorization_code") {
      const code = p.get("code");
      if (!code.startsWith("code-")) return R(400, { error: "invalid_grant", error_description: "AADSTS70000: bad code" });
      const want = challenges[code];
      assert.ok(want, "Code ohne Anmelde-Adresse");
      assert.equal(createHash("sha256").update(p.get("code_verifier")).digest("base64url"), want, "PKCE-Verifier passt zur Challenge");
      assert.equal(p.get("redirect_uri"), "https://crm.example.org/api/outlook/callback");
      const name = code.slice(5);
      const rt = `RT-${name}-${++seq}`;
      refreshTokens.set(rt, name);
      return R(200, { access_token: `AT-${name}`, refresh_token: rt, expires_in: 3600 });
    }
    const name = refreshTokens.get(p.get("refresh_token"));
    if (!name || revoked.has(name)) return R(400, { error: "invalid_grant", error_description: "AADSTS70008: The refresh token has expired" });
    const rt = p.get("refresh_token");
    return R(200, { access_token: `AT-${name}`, expires_in: 3600, ...(rotate ? { refresh_token: (() => { const n = `RT-${name}-${++seq}`; refreshTokens.set(n, name); return n; })() } : {}) });
  }
  assert.ok(url.startsWith("https://graph.microsoft.com/v1.0/"), url);
  const name = /^Bearer AT-(\w+)$/.exec(init.headers?.authorization || "")?.[1];
  if (!name) return R(401, { error: { code: "InvalidAuthenticationToken" } });
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, url, body, user: name, headers: init.headers });
  assert.match(init.headers.prefer, /IdType="ImmutableId"/);
  clock += tick;
  const f = failWith[name];
  if (f && (!f.method || f.method === method) && (f.times === undefined || f.times-- > 0)) return R(f.status, { error: { code: f.code || "x" } });
  const b = box(name);
  const path = url.slice("https://graph.microsoft.com/v1.0".length);

  if (path.startsWith("/me?")) return R(200, { displayName: name.toUpperCase(), mail: `${name}@firma.example` });
  if (path.startsWith("/me/calendarView/delta")) {
    assert.match(init.headers.prefer, /outlook\.timezone="UTC"/);
    const q = new URL(url).searchParams;
    if (q.get("startDateTime")) { // erster Aufruf: Momentaufnahme im Zeitfenster
      const from = Date.parse(q.get("startDateTime")), to = Date.parse(q.get("endDateTime"));
      assert.ok(Math.abs(from - (clock - 30 * 86400000)) < 3600000 * 24 && Math.abs(to - (clock + 365 * 86400000)) < 3600000 * 24, "Zeitfenster −30/+365 Tage");
      const sid = String(++seq);
      sessions.set(sid, { list: [...b.items.values()].map(wire), deltaIdx: b.log.length });
      return pageOf(sessions.get(sid).list, 0, sid, b.log.length);
    }
    if (q.get("$skiptoken")) {
      const [sid, off] = q.get("$skiptoken").split("-");
      const s = sessions.get(sid);
      return pageOf(s.list, Number(off), sid, s.deltaIdx);
    }
    if (q.get("$deltatoken") !== null && q.get("$deltatoken") !== undefined) {
      if (b.gone) return R(410, { error: { code: "syncStateNotFound" } });
      const idx = Number(q.get("$deltatoken"));
      const last = new Map();
      for (const e of b.log.slice(idx)) last.set(e.id, e);
      const list = [...last.values()].map((e) => (b.items.has(e.id) ? wire(b.items.get(e.id)) : { id: e.id, "@removed": { reason: "deleted" } }));
      const sid = String(++seq);
      sessions.set(sid, { list, deltaIdx: b.log.length });
      return pageOf(list, 0, sid, b.log.length);
    }
  }
  if (path === "/me/events" && method === "POST") {
    const it = mk(`AAA${++seq}`, body.subject, "2000-01-01T00:00:00", "2000-01-01T00:00:00", { categories: body.categories, pushed: body });
    return R(201, outlook(name).put(it));
  }
  const m = /^\/me\/events\/([^/]+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (!b.items.has(id)) return R(404, { error: { code: "ErrorItemNotFound" } });
    if (method === "PATCH") return R(200, outlook(name).edit(id, { subject: body.subject, pushed: body }));
    if (method === "DELETE") { outlook(name).del(id); return R(204, null); }
  }
  throw new Error(`unerwartet: ${method} ${url}`);
}
let rotate = false;

// ---------------------------------------------------------------- Umgebung
const realError = console.error;
console.error = (...a) => { if (!/Outlook: Termin nach Outlook|Outlook: Termin in Outlook/.test(String(a[0]))) realError(...a); }; // erwartete Fehler des simulierten Dienstes
const store = createMemoryStore();
const baseEnv = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const outlookEnv = { OUTLOOK_CLIENT_ID: "cid-1234", OUTLOOK_CLIENT_SECRET: "csecret-xyz", MS_TENANT_ID: "tenant-1", APP_URL: "https://crm.example.org" };
let env = { ...baseEnv };
const deps = () => ({ env, store, now: () => clock, clock: () => clock, delay: async () => {}, sleep: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: msFetch });
async function rawApi(method, path, { token, team, body, query } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}) };
  return handleApi({ method, path: "/api" + path, query: new URLSearchParams(query || {}), headers, bodyText: body === undefined ? "" : JSON.stringify(body) }, deps());
}
// Sitzungs-Token kommt nur noch per Set-Cookie (nicht im Body): für Bearer-Aufrufe der Tests aus dem Cookie übernehmen
const api = async (method, path, opts) => { const r = await rawApi(method, path, opts); return /^\/(login|me\/password)$/.test(path) ? withSessionToken(r) : r; };
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

const su = ok(await api("POST", "/login", { body: { username: "root", password: baseEnv.CRM_PASSWORD } }));
const PW = "Ein-langes-Passwort-1";
let sa = ok(await api("POST", "/me/password", { token: su.token, body: { current: baseEnv.CRM_PASSWORD, new: PW } })).token;
const mkTeam = async (name) => ok(await api("POST", "/teams", { token: sa, body: { name } }), 201).team;
const mkUser = async (team, username, extra = {}) => {
  const c = ok(await api("POST", "/users", { token: sa, body: { username, displayName: username.toUpperCase(), role: "member", teamId: team.id, ...extra } }), 201);
  const l = ok(await api("POST", "/login", { body: { username, password: c.temporaryPassword } }));
  const p = ok(await api("POST", "/me/password", { token: l.token, body: { current: c.temporaryPassword, new: PW } }));
  return { id: c.user.id, token: p.token, name: username };
};
const teamA = await mkTeam("Team Alpha");
const teamB = await mkTeam("Team Beta");
const anna = await mkUser(teamA, "anna", { email: "anna@firma.example" });
const ben = await mkUser(teamA, "ben");
const cleo = await mkUser(teamA, "cleo");
const dora = await mkUser(teamB, "dora");
const people = { anna, ben, cleo, dora };
const relog = async () => {
  for (const [n, u] of Object.entries(people)) u.token = ok(await api("POST", "/login", { body: { username: n, password: PW } })).token;
  sa = ok(await api("POST", "/login", { body: { username: "root", password: PW } })).token;
};
const H = 3600000, DAY = 24 * H;
const RANGE = () => ({ from: iso(clock - 40 * DAY), to: iso(clock + 60 * DAY) });
const cal = async (u, q) => ok(await api("GET", "/calendar", { token: u.token, query: q || RANGE() }));
const imported = async (u) => (await cal(u)).events.filter((e) => e.source === "outlook");
const status = async (u) => ok(await api("GET", "/outlook/status", { token: u.token }));
const storeText = () => JSON.stringify([...store.m.entries()]);

// ---------------------------------------------------------------- 1. Ohne Einrichtung: Funktion verborgen
{
  const m = await status(anna);
  assert.deepEqual(m, { configured: false, member: true, connection: null }, "Mitglieder sehen keine Einrichtungsdetails");
  const s = ok(await api("GET", "/outlook/status", { token: sa, team: teamA.id }));
  assert.equal(s.configured, false);
  assert.deepEqual(s.missing, ["clientId"], "Superadmin sieht, was fehlt (nur die App-ID; keine Variablen nötig)");
  const c = await api("GET", "/outlook/connect", { token: anna.token });
  assert.equal(c.status, 400);
  assert.equal(c.body.error, "not_configured");
  assert.equal((await cal(anna)).outlook.enabled, false);
  // geplanter Lauf ohne Einrichtung fasst den Speicher nicht an
  const spy = { ...store, list: () => { throw new Error("Speicher angefasst"); }, read: async (k) => { if (k !== OL.SETTING_KEY) throw new Error("Speicher angefasst"); return null; } }; // nur die App-Einstellung wird gelesen
  assert.deepEqual(await OL.runSync({ env, store: spy, fetch: msFetch, now: () => clock }), { teams: 0, users: 0, ok: 0, failed: 0, skipped: "not_configured" });
  // nur Client-ID/-Secret der SharePoint-App (MS_*) genügen als Ersatz
  const cfg = G.outlookConfig({ ...baseEnv, MS_CLIENT_ID: "a", MS_CLIENT_SECRET: "b", MS_TENANT_ID: "t", URL: "https://x.netlify.app" });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.redirectUri, "https://x.netlify.app/api/outlook/callback");
  assert.equal(G.outlookConfig({ ...baseEnv, MS_CLIENT_ID: "a", MS_CLIENT_SECRET: "b", APP_URL: "http://evil.example" }).redirectUri, "", "nur https");
  assert.equal(G.outlookConfig({ ...baseEnv, MS_CLIENT_ID: "a", MS_CLIENT_SECRET: "b", APP_URL: "https://h" }).tenant, "organizations");
}

env = { ...baseEnv, ...outlookEnv };

// ---------------------------------------------------------------- 2. Verbinden: PKCE, state, Zuordnung zum Benutzer
async function startConnect(user, code) {
  const r = ok(await api("GET", "/outlook/connect", { token: user.token }));
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
  assert.equal(u.searchParams.get("client_id"), "cid-1234");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("redirect_uri"), "https://crm.example.org/api/outlook/callback");
  assert.equal(u.searchParams.get("scope"), "offline_access Calendars.ReadWrite User.Read");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("code_challenge").length >= 43);
  assert.ok(!r.url.includes("csecret"), "Secret nie in der Adresse");
  challenges[code] = u.searchParams.get("code_challenge");
  return u.searchParams.get("state");
}
const callback = (code, state) => api("GET", "/outlook/callback", { query: { code, state } });
const target = (r) => { assert.equal(r.status, 302, JSON.stringify(r)); return r.redirect; };

{
  assert.equal((await api("GET", "/outlook/connect", { token: sa })).status, 409, "Superadmin ohne Team");
  const inTeam = await api("GET", "/outlook/connect", { token: sa, team: teamA.id });
  assert.equal(inTeam.status, 403, "Superadmin hat keinen eigenen Kalender");
  assert.equal(inTeam.body.reason, "members_only");
  assert.equal((await api("GET", "/outlook/connect")).status, 401);
}
{
  const st = await startConnect(anna, "code-anna");
  assert.match(target(await callback("code-anna", "x" + st)), /outlook=error&r=state$/, "manipulierter state");
  assert.match(target(await callback("code-anna", st.split(".")[0] + ".AAAA")), /outlook=error&r=state$/, "falsche Signatur");
  assert.match(target(await callback("code-anna", "")), /outlook=error&r=state$/);
  // state eines anderen Benutzers lässt sich nicht verwenden: der einmalige Eintrag gehört zu Anna
  const stBen = await startConnect(ben, "code-ben");
  const forged = JSON.parse(Buffer.from(st.split(".")[0], "base64url"));
  assert.equal(forged.u, anna.id);
  assert.equal(forged.t, teamA.id);
  // Abbruch durch den Benutzer bei Microsoft
  const denied = await api("GET", "/outlook/callback", { query: { error: "access_denied", state: stBen } });
  assert.match(target(denied), /outlook=error&r=denied$/);
  // Der Eintrag war einmalig: derselbe state funktioniert danach nicht mehr
  assert.match(target(await callback("code-ben", stBen)), /outlook=error&r=state$/);

  tokenCalls = [];
  const done = target(await callback("code-anna", st));
  assert.equal(done, "https://crm.example.org/#/einstellungen?outlook=connected");
  assert.equal(tokenCalls.length, 1);
  assert.match(target(await callback("code-anna", st)), /outlook=error&r=state$/, "Wiederholung (Replay) wird abgewiesen");

  const s = await status(anna);
  assert.equal(s.connection.status, "connected");
  assert.equal(s.connection.account.address, "anna@firma.example");
  assert.equal(s.connection.direction, "in", "Standard: nur Outlook → CRM");
  assert.equal(JSON.stringify(s).includes("RT-"), false, "Token nie in der Antwort");
  assert.equal(storeText().includes("RT-anna"), false, "Refresh-Token liegt nur verschlüsselt im Speicher");
  assert.equal(storeText().includes("AT-anna"), false, "Zugriffstoken wird nicht gespeichert");
  const connKeys = [...store.m.keys()].filter((k) => k.includes("/cal/ol/conn/"));
  assert.deepEqual(connKeys, [`t/${teamA.id}/cal/ol/conn/${anna.id}`], "im Namensraum des Teams");
  assert.equal((await status(ben)).connection, null, "Ben ist nicht verbunden");
  assert.equal((await status(anna)).configured, true);
  assert.equal(ok(await api("GET", "/outlook/status", { token: sa, team: teamA.id })).member, false, "Superadmin sieht nur die Einrichtung");

  // Verschlüsselung: an Team und Benutzer gebunden, manipulierte Daten werden abgelehnt
  const blob = store.m.get(connKeys[0]).json;
  const tokenEnc = JSON.parse(blob).tokenEnc;
  assert.match(OL.decryptToken(env, tokenEnc, `${teamA.id}|${anna.id}`), /^RT-anna-/);
  assert.throws(() => OL.decryptToken(env, tokenEnc, `${teamA.id}|${ben.id}`), /nicht lesbar/);
  assert.throws(() => OL.decryptToken({ ...env, CRM_SECRET: "y".repeat(32) }, tokenEnc, `${teamA.id}|${anna.id}`), /nicht lesbar/);
  assert.throws(() => OL.decryptToken(env, tokenEnc.slice(0, -4) + "AAAA", `${teamA.id}|${anna.id}`), /nicht lesbar/);
  assert.notEqual(OL.encryptToken(env, "x", "a"), OL.encryptToken(env, "x", "a"), "zufälliger IV");
}

// ---------------------------------------------------------------- 3. Import (Delta) mit Seiten
const AB = outlook("anna");
{
  const mkA = (id, subject, s, e, x) => AB.put(mk(id, subject, s, e, x));
  mkA("m1", "Kundentermin <b>Müller</b>", "2026-10-27T08:00:00", "2026-10-27T09:00:00", { location: { displayName: "Büro 3" }, bodyPreview: "Agenda\r\n\r\n\r\n\r\nPunkt 1" });
  mkA("d1", "Messe", "2026-11-02T00:00:00", "2026-11-04T00:00:00", { isAllDay: true });
  mkA("p1", "Arzt", "2026-10-28T07:00:00", "2026-10-28T08:00:00", { sensitivity: "private", location: { displayName: "Praxis" }, bodyPreview: "Geheim" });
  mkA("s1", "Wöchentlich", "2026-10-26T13:00:00", "2026-10-26T14:00:00", { type: "occurrence", seriesMasterId: "master1" });
  mkA("s2", "Wöchentlich", "2026-11-02T13:00:00", "2026-11-02T14:00:00", { type: "occurrence", seriesMasterId: "master1" });
  mkA("old", "Zu alt wird nicht gefiltert (Fenster macht Outlook)", "2026-10-26T10:00:00", "2026-10-26T11:00:00", { isCancelled: true });
  mkA("ben-and-anna", "Planung", "2026-10-29T09:00:00", "2026-10-29T10:00:00", { iCalUId: "shared-uid" });
  calls = [];
  const r = ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(r.result.ok, true);
  assert.equal(r.result.added, 6, "alle Seiten gelesen (Seitengrösse 2); der abgesagte Termin zählt nicht");
  assert.equal(calls.filter((c) => c.url.includes("calendarView/delta")).length, 4, "4 Seiten");
  assert.ok(calls.every((c) => c.headers.authorization === "Bearer AT-anna"), "mit dem Token des Benutzers, nie mit einem Anwendungstoken");
  assert.equal(r.connection.count, 6);
  assert.ok(r.connection.lastSync && !r.connection.error);

  const evs = await imported(anna);
  assert.equal(evs.length, 6, "abgesagter Termin (isCancelled) wird nicht importiert");
  const m1 = evs.find((e) => e.title.startsWith("Kundentermin"));
  assert.equal(m1.title, "Kundentermin bMüller/b", "spitze Klammern entfernt");
  assert.equal(m1.start, "2026-10-27T08:00:00.000Z");
  assert.equal(m1.end, "2026-10-27T09:00:00.000Z");
  assert.deepEqual(m1.participants, [anna.id], "Teilnehmer = der verbundene Benutzer");
  assert.equal(m1.location, "Büro 3");
  assert.equal(m1.notes, "Agenda\n\nPunkt 1");
  assert.equal(m1.source, "outlook");
  assert.equal(m1.allDay, false);
  assert.deepEqual(m1.reminders, [], "keine CRM-Erinnerungen für importierte Termine");
  assert.match(m1.id, /^ev_[0-9a-f]{12}$/);
  assert.equal(m1.outlookId, undefined, "interne Felder werden nicht ausgeliefert");
  assert.equal(m1.webLink, "https://outlook.office.com/calendar/item/m1", "der Besitzer erhält den Link");
  const d1 = evs.find((e) => e.title === "Messe");
  assert.deepEqual([d1.allDay, d1.start, d1.end], [true, "2026-11-02", "2026-11-03"], "ganztägig: Ende einschliesslich");

  // Besucher (Ben) sieht den privaten Termin nur als «Beschäftigt»
  const benView = await imported(ben);
  const priv = benView.find((e) => e.busy);
  assert.ok(priv, "privater Termin vorhanden");
  assert.deepEqual([priv.title, priv.location, priv.notes, priv.webLink], ["", "", "", ""]);
  assert.equal(priv.start, "2026-10-28T07:00:00.000Z");
  assert.equal(JSON.stringify(benView).includes("Praxis") || JSON.stringify(benView).includes("Geheim") || JSON.stringify(benView).includes("Arzt"), false);
  assert.equal(benView.find((e) => e.title === "Messe").webLink, "", "Link nur für den Besitzer");
  const own = evs.find((e) => e.private);
  assert.equal(own.title, "Arzt", "der Besitzer sieht Details");
  assert.equal(own.busy, undefined);

  // Kalenderantwort
  const list = await cal(ben);
  assert.deepEqual(list.outlook, { enabled: true, mine: false });
  assert.equal((await cal(anna)).outlook.mine, true);
  assert.ok(list.occurrences.some((o) => o.eventId === m1.id));
  assert.equal(ok(await api("GET", `/calendar/events/${m1.id}`, { token: ben.token })).event.title, m1.title);

  // Nur lesbar
  const put = await api("PUT", `/calendar/events/${m1.id}`, { token: anna.token, body: { title: "x", start: m1.start, end: m1.end, rev: 1 } });
  assert.equal(put.status, 403);
  assert.equal(put.body.error, "cal_readonly");
  assert.equal((await api("DELETE", `/calendar/events/${m1.id}`, { token: anna.token })).status, 403);
  assert.equal((await imported(anna)).length, 6);

  // Doppelte Besprechung in zwei Kalendern erscheint einmal mit beiden Teilnehmern: Ben verbinden (Richtung in)
  const stB = await startConnect(ben, "code-ben");
  target(await callback("code-ben", stB));
  outlook("ben").put(mk("ben-copy", "Planung", "2026-10-29T09:00:00", "2026-10-29T10:00:00", { iCalUId: "shared-uid" }));
  ok(await api("POST", "/outlook/sync", { token: ben.token }));
  const merged = (await imported(cleo)).filter((e) => e.title === "Planung");
  assert.equal(merged.length, 1, "dieselbe Besprechung nur einmal");
  assert.deepEqual([...merged[0].participants].sort(), [anna.id, ben.id].sort());
}

// ---------------------------------------------------------------- 4. Änderung, Löschung, Absage, Serien
{
  clock += 30 * 60000;
  AB.edit("m1", { subject: "Kundentermin verschoben", start: { dateTime: "2026-10-27T10:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-27T11:30:00.0000000", timeZone: "UTC" } });
  AB.del("d1");
  AB.edit("s1", { isCancelled: true }); // einzelne Instanz einer Serie abgesagt
  AB.edit("s2", { subject: "Wöchentlich (Raum 2)" });
  calls = [];
  const r = ok(await api("POST", "/outlook/sync", { token: anna.token })).result;
  assert.deepEqual([r.added, r.updated, r.removed], [0, 2, 2]);
  assert.ok(!calls.some((c) => c.url.includes("startDateTime")), "Delta statt Vollabgleich");
  assert.ok(calls[0].url.includes("$deltatoken"));
  const evs = await imported(anna);
  assert.equal(evs.length, 4);
  const m1 = evs.find((e) => e.title === "Kundentermin verschoben");
  assert.deepEqual([m1.start, m1.end], ["2026-10-27T10:00:00.000Z", "2026-10-27T11:30:00.000Z"]);
  assert.ok(!evs.some((e) => e.title === "Messe"), "gelöschter Termin entfernt");
  assert.equal(evs.filter((e) => e.title.startsWith("Wöchentlich")).length, 1, "Serie: abgesagte Instanz entfernt, andere bleibt");
  assert.equal(evs.find((e) => e.title.startsWith("Wöchentlich")).title, "Wöchentlich (Raum 2)");
  // Ein weiterer Lauf ohne Änderungen
  const again = ok(await api("POST", "/outlook/sync", { token: anna.token })).result;
  assert.deepEqual([again.added, again.updated, again.removed], [0, 0, 0]);
  // Abgelaufener Delta-Stand (410): Vollabgleich; in Outlook inzwischen verschwundene Termine werden bereinigt
  box("anna").items.delete("p1");
  box("anna").gone = true;
  const g = ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(g.result.ok, true);
  box("anna").gone = false;
  const afterGone = await imported(anna);
  assert.ok(!afterGone.some((e) => e.private), "Vollabgleich entfernt, was in Outlook nicht mehr existiert");
  assert.equal(afterGone.length, 3);
}

// ---------------------------------------------------------------- 5. CRM → Outlook, Schleifen-Schutz, letzter Schreiber gewinnt
const ev1 = { title: "Angebot besprechen", start: iso(clock + 2 * DAY), end: iso(clock + 2 * DAY + H), location: "Zürich", notes: "Preise", participants: [], reminders: [10], tz: "Europe/Zurich" };
let crm;
{
  // Richtung «in»: nichts wird geschrieben
  calls = [];
  const a = ok(await api("POST", "/calendar/events", { token: anna.token, body: ev1 }), 201);
  assert.equal(a.outlook, "skipped");
  assert.equal(calls.length, 0);
  ok(await api("DELETE", `/calendar/events/${a.event.id}`, { token: anna.token }));

  assert.equal((await api("PUT", "/outlook/settings", { token: anna.token, body: { direction: "sideways" } })).status, 400);
  assert.equal((await api("PUT", "/outlook/settings", { token: cleo.token, body: { direction: "both" } })).status, 409, "Cleo ist nicht verbunden");
  assert.equal(ok(await api("PUT", "/outlook/settings", { token: anna.token, body: { direction: "both" } })).connection.direction, "both");
  assert.equal((await status(ben)).connection.direction, "in", "Einstellung gilt nur für den eigenen Benutzer");

  calls = [];
  const c = ok(await api("POST", "/calendar/events", { token: anna.token, body: ev1 }), 201);
  assert.equal(c.outlook, "pushed");
  crm = c.event;
  assert.equal(crm.outlook.userId, anna.id);
  const post = calls.find((x) => x.method === "POST" && x.url.endsWith("/me/events"));
  assert.ok(post, "POST /me/events im Kalender von Anna");
  assert.equal(post.user, "anna");
  assert.equal(post.body.subject, "Angebot besprechen");
  assert.deepEqual(post.body.categories, ["STPS CRM"], "Markierung gegen Schleifen");
  assert.equal(post.body.start.timeZone, "Europe/Zurich");
  assert.match(post.body.start.dateTime, /^2026-10-2\dT\d\d:\d\d:00$/);
  assert.equal(post.body.start.dateTime.slice(11, 13), String((Number(iso(clock + 2 * DAY).slice(11, 13)) + 1) % 24).padStart(2, "0"), "Wanduhrzeit Zürich (Winterzeit UTC+1 am 27.10.)");
  assert.equal(post.body.body.content, "Preise");
  assert.equal(post.body.location.displayName, "Zürich");
  assert.equal(post.body.recurrence, undefined);
  const stored = ok(await api("GET", `/calendar/events/${crm.id}`, { token: ben.token })).event;
  assert.equal(stored.outlook.outlookId, crm.outlook.outlookId);
  assert.equal(stored.rev, 1, "Verknüpfung erhöht die Version nicht");

  // Echo: der von uns geschriebene Termin erscheint im Delta, wird aber weder importiert noch zurückgeschrieben
  calls = [];
  const s1 = ok(await api("POST", "/outlook/sync", { token: anna.token })).result;
  assert.deepEqual([s1.added, s1.updated, s1.removed, s1.pushed], [0, 0, 0, 0]);
  assert.equal(calls.filter((x) => x.method !== "GET").length, 0, "kein Zurückschreiben");
  assert.equal((await imported(anna)).length, 3, "kein Duplikat durch Import des eigenen Termins");
  assert.equal(ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event.rev, 1);

  // Änderung im CRM → PATCH
  calls = [];
  const u = ok(await api("PUT", `/calendar/events/${crm.id}`, { token: anna.token, body: { ...ev1, title: "Angebot final", rev: 1 } }));
  assert.equal(u.outlook, "pushed");
  const patch = calls.find((x) => x.method === "PATCH");
  assert.ok(patch.url.endsWith(encodeURIComponent(crm.outlook.outlookId)));
  assert.equal(patch.body.subject, "Angebot final");
  assert.equal(patch.body.recurrence, null);
  assert.equal(calls.filter((x) => x.method === "POST").length, 0, "kein zweiter Termin in Outlook");
  calls = [];
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(calls.filter((x) => x.method !== "GET").length, 0, "Echo des PATCH wird ignoriert");

  // Änderung in Outlook (später als im CRM) → CRM übernimmt, ohne zurückzuschreiben
  clock += 10 * 60000;
  AB.edit(crm.outlook.outlookId, { subject: "Angebot (in Outlook geändert)", start: { dateTime: "2026-10-27T15:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-10-27T16:00:00.0000000", timeZone: "UTC" }, location: { displayName: "Bern" } });
  calls = [];
  const s2 = ok(await api("POST", "/outlook/sync", { token: anna.token })).result;
  assert.equal(calls.filter((x) => x.method !== "GET").length, 0, "importierte Änderung wird nicht zurückgespiegelt");
  assert.equal(s2.pushed, 0);
  const after = ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event;
  assert.equal(after.title, "Angebot (in Outlook geändert)");
  assert.equal(after.start, "2026-10-27T15:00:00.000Z");
  assert.equal(after.location, "Bern");
  assert.equal(after.notes, "Preise", "Notizen bleiben (Outlook liefert nur eine Vorschau)");
  assert.equal(after.rev, 3);
  assert.equal(after.updatedBy.name, "Outlook");
  assert.equal((await imported(anna)).length, 3, "weiterhin kein Duplikat");
  // Folgelauf bleibt ruhig
  calls = [];
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(calls.filter((x) => x.method !== "GET").length, 0);
  assert.equal(ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event.rev, 3);

  // Fehler beim Schreiben (503): Speichern gelingt, Termin wird als offen vermerkt; der nächste Lauf holt es nach
  failWith.anna = { status: 503, method: "PATCH", times: 3 };
  const bad = ok(await api("PUT", `/calendar/events/${crm.id}`, { token: anna.token, body: { ...ev1, title: "CRM neuer", rev: 3 } }));
  assert.equal(bad.outlook, "error");
  assert.equal(bad.event.title, "CRM neuer", "im CRM gespeichert");
  assert.equal(bad.event.outlook.dirty, true);
  delete failWith.anna;
  calls = [];
  const s3 = ok(await api("POST", "/outlook/sync", { token: anna.token })).result;
  assert.equal(s3.pushed, 1);
  assert.equal(calls.find((x) => x.method === "PATCH").body.subject, "CRM neuer");
  assert.equal(ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event.outlook.dirty, false);

  // Letzter Schreiber gewinnt: Outlook-Änderung ÄLTER als die CRM-Änderung → CRM wird (erneut) nach Outlook geschrieben
  failWith.anna = { status: 503, method: "PATCH", times: 3 };
  clock += 5 * 60000;
  AB.edit(crm.outlook.outlookId, { subject: "Outlook alt" }); // lastModified = clock
  clock += 5 * 60000;
  ok(await api("PUT", `/calendar/events/${crm.id}`, { token: anna.token, body: { ...ev1, title: "CRM gewinnt", rev: 4 } }));
  delete failWith.anna;
  calls = [];
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  const win = ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event;
  assert.equal(win.title, "CRM gewinnt");
  assert.equal(calls.find((x) => x.method === "PATCH").body.subject, "CRM gewinnt");

  // Wiederkehrender CRM-Termin → Serie in Outlook; Instanzen kommen nicht als Duplikate zurück
  calls = [];
  const rep = ok(await api("POST", "/calendar/events", { token: anna.token, body: { ...ev1, title: "Montags-Runde", repeat: { freq: "weekly", interval: 2, until: null, count: 5 } } }), 201);
  const rb = calls.find((x) => x.method === "POST").body;
  assert.equal(rb.recurrence.pattern.type, "weekly");
  assert.equal(rb.recurrence.pattern.interval, 2);
  assert.equal(rb.recurrence.pattern.daysOfWeek.length, 1);
  assert.deepEqual([rb.recurrence.range.type, rb.recurrence.range.numberOfOccurrences], ["numbered", 5]);
  const rid = rep.event.outlook.outlookId;
  outlook("anna").put(mk("inst1", "Montags-Runde", "2026-11-09T08:00:00", "2026-11-09T09:00:00", { type: "occurrence", seriesMasterId: rid, categories: ["STPS CRM"] }));
  const before = (await imported(anna)).length;
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal((await imported(anna)).length, before, "Instanzen der eigenen Serie werden nicht importiert");

  // Ersteller ohne Verbindung, aber verbundener Teilnehmer (Richtung «both») → Termin geht in dessen Kalender
  calls = [];
  const viaBen = ok(await api("POST", "/calendar/events", { token: cleo.token, body: { ...ev1, title: "Von Cleo", participants: [anna.id] } }), 201);
  assert.equal(viaBen.outlook, "pushed");
  assert.equal(calls.find((x) => x.method === "POST").user, "anna");
  // Ben (nur «in») als Ersteller: nichts wird geschrieben
  calls = [];
  const benEv = ok(await api("POST", "/calendar/events", { token: ben.token, body: { ...ev1, title: "Von Ben" } }), 201);
  assert.equal(benEv.outlook, "skipped");
  assert.equal(calls.length, 0);

  // Löschen im CRM → löscht in Outlook
  calls = [];
  const del = ok(await api("DELETE", `/calendar/events/${viaBen.event.id}`, { token: anna.token }));
  assert.equal(del.outlook, "deleted");
  assert.ok(calls.some((x) => x.method === "DELETE" && x.url.endsWith(encodeURIComponent(viaBen.event.outlook.outlookId))));
  // Löschen, während Outlook nicht erreichbar ist → vorgemerkt und nachgeholt
  failWith.anna = { status: 503, method: "DELETE", times: 3 };
  const del2 = ok(await api("DELETE", `/calendar/events/${rep.event.id}`, { token: anna.token }));
  assert.equal(del2.outlook, "error");
  delete failWith.anna;
  calls = [];
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.ok(calls.some((x) => x.method === "DELETE" && x.url.endsWith(encodeURIComponent(rid))), "vorgemerkte Löschung nachgeholt");
  assert.ok(!box("anna").items.has(rid));

  // In Outlook gelöscht → Verknüpfung entfällt, der CRM-Termin bleibt
  AB.del(crm.outlook.outlookId);
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  const kept = ok(await api("GET", `/calendar/events/${crm.id}`, { token: anna.token })).event;
  assert.equal(kept.title, "CRM gewinnt");
  assert.equal(kept.outlook, undefined);
  assert.ok(!(await imported(anna)).some((e) => e.title === "CRM gewinnt"));
}

// ---------------------------------------------------------------- 6. Team-Trennung
{
  const stD = await startConnect(dora, "code-dora");
  target(await callback("code-dora", stD));
  outlook("dora").put(mk("dm1", "Beta-Geheimtermin", "2026-10-27T08:00:00", "2026-10-27T09:00:00"));
  ok(await api("POST", "/outlook/sync", { token: dora.token }));
  assert.deepEqual((await imported(dora)).map((e) => e.title), ["Beta-Geheimtermin"]);
  for (const u of [anna, ben, cleo]) assert.equal(JSON.stringify(await cal(u)).includes("Beta-Geheimtermin"), false, "Team Alpha sieht nichts von Team Beta");
  assert.equal(JSON.stringify(await cal(dora)).includes("Kundentermin"), false, "Team Beta sieht nichts von Team Alpha");
  assert.equal((await cal(dora)).events.every((e) => e.participants.every((p) => p === dora.id)), true);
  const keys = [...store.m.keys()].filter((k) => k.includes("/cal/ol/"));
  assert.ok(keys.filter((k) => k.includes(dora.id)).every((k) => k.startsWith(`t/${teamB.id}/`)));
  assert.ok(keys.filter((k) => k.includes(anna.id) || k.includes(ben.id)).every((k) => k.startsWith(`t/${teamA.id}/`)));
  // Status eines anderen Benutzers ist nicht abrufbar; der Sync läuft nur für den eigenen Benutzer
  assert.equal((await status(dora)).connection.account.address, "dora@firma.example");
  // Gleiche Benutzer-Kennung in einem fremden Team: der state von Anna lässt sich nicht in Team B einlösen
  const stA = await startConnect(anna, "code-anna");
  const payload = JSON.parse(Buffer.from(stA.split(".")[0], "base64url"));
  assert.equal(payload.t, teamA.id);
  // Geplanter Lauf: beide Teams, jedes in seinem Namensraum
  AB.put(mk("m9", "Neu aus Outlook", "2026-10-30T08:00:00", "2026-10-30T09:00:00"));
  outlook("dora").put(mk("dm2", "Beta neu", "2026-10-30T10:00:00", "2026-10-30T11:00:00"));
  clock += 15 * 60000;
  const run = await OL.runSync({ env, store, fetch: msFetch, sleep: async () => {}, now: () => clock });
  assert.deepEqual([run.teams, run.users, run.ok, run.failed], [2, 3, 3, 0]);
  assert.ok((await imported(anna)).some((e) => e.title === "Neu aus Outlook"));
  assert.ok((await imported(dora)).some((e) => e.title === "Beta neu"));
  assert.equal((await imported(anna)).some((e) => e.title === "Beta neu"), false);
  // Deaktivierter Benutzer wird übersprungen
  ok(await api("PATCH", `/users/${ben.id}`, { token: sa, body: { active: false } }));
  const run2 = await OL.runSync({ env, store, fetch: msFetch, sleep: async () => {}, now: () => clock });
  assert.equal(run2.users, 2);
  ok(await api("PATCH", `/users/${ben.id}`, { token: sa, body: { active: true } }));
  await relog();
}

// ---------------------------------------------------------------- 7. Fehler: fehlende Berechtigung, Zeitbudget
{
  failWith.anna = { status: 403, code: "ErrorAccessDenied" };
  const r = ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(r.result.ok, false);
  assert.equal(r.connection.error.kind, "permission");
  assert.match(r.connection.error.message, /Calendars\.ReadWrite/);
  assert.equal(r.connection.status, "connected", "bleibt verbunden; der Fehler wird angezeigt");
  delete failWith.anna;
  const okAgain = ok(await api("POST", "/outlook/sync", { token: anna.token }));
  assert.equal(okAgain.connection.error, null, "Fehler verschwindet nach erfolgreichem Lauf");

  // Zeitbudget: viele Seiten, jeder Graph-Aufruf kostet 6 s; pro Lauf höchstens 20 s → Fortsetzung im nächsten Lauf
  for (let i = 0; i < 12; i++) outlook("dora").put(mk(`bulk${i}`, `Bulk ${i}`, `2026-11-1${i % 10}T08:00:00`, `2026-11-1${i % 10}T09:00:00`));
  box("dora").gone = true; // Vollabgleich erzwingen
  tick = 6000;
  const r1 = await OL.runSync({ env, store, fetch: msFetch, sleep: async () => {}, now: () => clock, budgetMs: 20000 });
  assert.equal(r1.partial, undefined);
  box("dora").gone = false;
  let rounds = 0, last;
  do {
    last = ok(await api("POST", "/outlook/sync", { token: dora.token })).result;
    rounds++;
  } while (last.partial && rounds < 10);
  tick = 0;
  assert.ok(rounds >= 1);
  ok(await api("POST", "/outlook/sync", { token: dora.token }));
  const titles = (await imported(dora)).map((e) => e.title);
  assert.equal(titles.filter((t) => t.startsWith("Bulk")).length, 12, "alle Termine nach Fortsetzung vorhanden");
  assert.ok(titles.includes("Beta neu") && titles.includes("Beta-Geheimtermin"), "bestehende Termine wurden nicht vorzeitig gelöscht");
}
{
  // Unterbrochener Vollabgleich: erst nach Abschluss wird bereinigt
  tick = 6000;
  pageSize = 1;
  box("dora").gone = true;
  const first = ok(await api("POST", "/outlook/sync", { token: dora.token })).result;
  tick = 0;
  assert.equal(first.partial, true, "Zeitbudget erreicht");
  assert.ok((await imported(dora)).length >= 12, "unvollständiger Lauf löscht nichts");
  box("dora").gone = false;
  let n = 0, res;
  do { res = ok(await api("POST", "/outlook/sync", { token: dora.token })).result; n++; } while (res.partial && n < 20);
  pageSize = 2;
  assert.equal(res.partial, false);
  assert.equal((await imported(dora)).filter((e) => e.title.startsWith("Bulk")).length, 12);
}

// ---------------------------------------------------------------- 8. Widerrufenes Token, erneut verbinden, Token-Rotation
{
  rotate = true;
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  const rts = [...refreshTokens.keys()].filter((k) => k.startsWith("RT-anna-"));
  const cur = OL.decryptToken(env, JSON.parse(store.m.get(`t/${teamA.id}/cal/ol/conn/${anna.id}`).json).tokenEnc, `${teamA.id}|${anna.id}`);
  OL.clearOutlookCache();
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
  const rotated = OL.decryptToken(env, JSON.parse(store.m.get(`t/${teamA.id}/cal/ol/conn/${anna.id}`).json).tokenEnc, `${teamA.id}|${anna.id}`);
  assert.notEqual(rotated, cur, "rotiertes Refresh-Token wird gespeichert");
  assert.ok(rts.length >= 1);
  rotate = false;

  revoked.add("anna");
  OL.clearOutlookCache();
  const r = await api("POST", "/outlook/sync", { token: anna.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.ok, false);
  const s = await status(anna);
  assert.equal(s.connection.status, "revoked");
  assert.equal(s.connection.error.kind, "revoked");
  assert.equal(JSON.parse(store.m.get(`t/${teamA.id}/cal/ol/conn/${anna.id}`).json).tokenEnc, undefined, "unbrauchbares Token wird gelöscht");
  const again = await api("POST", "/outlook/sync", { token: anna.token });
  assert.equal(again.status, 409);
  assert.equal(again.body.reason, "revoked");
  const sched = await OL.runSync({ env, store, fetch: msFetch, sleep: async () => {}, now: () => clock });
  assert.equal(sched.users, 2, "widerrufene Verbindung wird im geplanten Lauf übersprungen (Anna fällt weg)");
  assert.equal((await imported(anna)).length > 0, true, "importierte Termine bleiben bis zum Trennen sichtbar");

  // Erneut verbinden (gleiches Konto): Termine und Einstellungen bleiben, Status wieder verbunden
  revoked.delete("anna");
  const st = await startConnect(anna, "code-anna");
  target(await callback("code-anna", st));
  const s2 = await status(anna);
  assert.equal(s2.connection.status, "connected");
  assert.equal(s2.connection.error, null);
  assert.equal(s2.connection.direction, "both", "Richtung bleibt");
  ok(await api("POST", "/outlook/sync", { token: anna.token }));
}

// ---------------------------------------------------------------- 9. Trennen
{
  const link = ok(await api("POST", "/calendar/events", { token: anna.token, body: { ...ev1, title: "Verknüpft" } }), 201);
  assert.equal(link.outlook, "pushed");
  assert.ok((await imported(anna)).length > 0);
  const d = ok(await api("DELETE", "/outlook/connection", { token: anna.token }));
  assert.equal(d.connection, null);
  assert.equal((await imported(anna)).filter((e) => e.participants.includes(anna.id)).length, 0, "importierte Termine entfernt");
  assert.equal((await imported(ben)).filter((e) => e.participants.includes(anna.id)).length, 0);
  const keep = ok(await api("GET", `/calendar/events/${link.event.id}`, { token: anna.token })).event;
  assert.equal(keep.title, "Verknüpft", "CRM-Termine bleiben");
  assert.equal(keep.outlook, undefined, "Verknüpfung gelöst");
  assert.deepEqual([...store.m.keys()].filter((k) => k.includes(anna.id)), [], "nichts von Anna bleibt im Speicher");
  assert.equal(ok(await api("POST", "/calendar/events", { token: anna.token, body: ev1 }), 201).outlook, "skipped");
  const sync = await api("POST", "/outlook/sync", { token: anna.token });
  assert.equal(sync.status, 409);
  assert.equal((await cal(ben)).outlook.enabled, true, "Ben bleibt verbunden");
  // Ohne Einrichtung verschwinden die importierten Termine wieder aus der Ansicht
  const saved = env;
  env = { ...baseEnv };
  assert.equal((await imported(dora)).length, 0);
  assert.equal((await cal(dora)).outlook.enabled, false);
  env = saved;
}

console.log("Outlook-Kalender: alle Prüfungen bestanden");
