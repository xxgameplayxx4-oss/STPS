#!/usr/bin/env node
// Prüft Team-Kalender (Termine, Wiederholungen, Team-Trennung) und den Versand der Erinnerungen gegen den In-Memory-Store (ohne Netzwerk)
// – Aufruf: node scripts/test-calendar.mjs  (npm run test:calendar)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import * as CAL from "../netlify/functions/lib/calendar.mjs";
import { withSessionToken } from "./lib/session-token.mjs";

const iso = (s) => Date.parse(s);

// ---------------------------------------------------------------- Zeitzonen und Wiederholungen (rein)
{
  const Z = "Europe/Zurich";
  // Winterzeit UTC+1, Sommerzeit UTC+2
  assert.equal(CAL.zonedToUtc({ y: 2026, m: 1, d: 15, hh: 9, mm: 0 }, Z), iso("2026-01-15T08:00:00Z"));
  assert.equal(CAL.zonedToUtc({ y: 2026, m: 7, d: 15, hh: 9, mm: 0 }, Z), iso("2026-07-15T07:00:00Z"));
  // Umstellung 29.3.2026: 02:30 gibt es nicht und rückt vor
  assert.equal(CAL.zonedToUtc({ y: 2026, m: 3, d: 29, hh: 2, mm: 30 }, Z), iso("2026-03-29T01:30:00Z"));
  assert.deepEqual(CAL.zonedParts(iso("2026-10-25T01:30:00Z"), Z), { y: 2026, m: 10, d: 25, hh: 2, mm: 30, ss: 0 });
  assert.ok(CAL.validTimeZone("Asia/Ho_Chi_Minh") && !CAL.validTimeZone("Mars/Base") && !CAL.validTimeZone("x".repeat(80)));

  const ev = (o) => ({ id: "ev_000000000001", title: "T", allDay: false, tz: Z, participants: [], reminders: [], repeat: null, ...o });
  const range = (e, a, b, mode) => CAL.occurrences(e, iso(a), iso(b), mode ? { mode } : {});

  // einmalig
  const one = ev({ start: "2026-10-25T08:00:00.000Z", end: "2026-10-25T09:00:00.000Z" });
  assert.equal(range(one, "2026-10-25T00:00:00Z", "2026-10-26T00:00:00Z").length, 1);
  assert.equal(range(one, "2026-10-25T09:00:00Z", "2026-10-26T00:00:00Z").length, 0, "Ende ist exklusiv");
  assert.equal(range(one, "2026-10-24T00:00:00Z", "2026-10-25T08:00:00Z").length, 0, "Beginn ist exklusiv am Rand");

  // wöchentlich, jeden Mittwoch 09:00 Zürich: bleibt 09:00 über die Umstellung (UTC 08:00 → 07:00)
  const weekly = ev({ start: "2026-03-18T08:00:00.000Z", end: "2026-03-18T09:00:00.000Z", repeat: { freq: "weekly", interval: 1, until: null, count: 4 } });
  const w = range(weekly, "2026-03-01T00:00:00Z", "2026-12-31T00:00:00Z");
  assert.deepEqual(w.map((o) => o.start), ["2026-03-18T08:00:00.000Z", "2026-03-25T08:00:00.000Z", "2026-04-01T07:00:00.000Z", "2026-04-08T07:00:00.000Z"], "count=4, Wanduhrzeit bleibt");
  assert.equal(w[2].endMs - w[2].startMs, 3600000);
  // Zeitraum mitten in der Serie
  assert.deepEqual(range(weekly, "2026-03-30T00:00:00Z", "2026-04-02T00:00:00Z").map((o) => o.i), [2]);

  // täglich mit Intervall und Enddatum (until einschliesslich)
  const daily = ev({ start: "2026-05-01T10:00:00.000Z", end: "2026-05-01T10:30:00.000Z", repeat: { freq: "daily", interval: 2, until: "2026-05-07", count: null } });
  assert.deepEqual(range(daily, "2026-04-01T00:00:00Z", "2026-06-01T00:00:00Z").map((o) => o.start.slice(0, 10)), ["2026-05-01", "2026-05-03", "2026-05-05", "2026-05-07"]);

  // monatlich am 31.: kürzere Monate rücken auf den letzten Tag, ohne danach zu «driften»
  const monthly = ev({ allDay: true, start: "2026-01-31", end: "2026-01-31", repeat: { freq: "monthly", interval: 1, until: null, count: 4 } });
  assert.deepEqual(range(monthly, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z").map((o) => o.start), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);

  // jährlich am 29.2.
  const yearly = ev({ allDay: true, start: "2024-02-29", end: "2024-02-29", repeat: { freq: "yearly", interval: 1, until: null, count: null } });
  assert.deepEqual(range(yearly, "2024-01-01T00:00:00Z", "2029-01-01T00:00:00Z").map((o) => o.start), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  // weit in der Zukunft: springt direkt zum Zeitraum
  assert.equal(range(yearly, "2090-01-01T00:00:00Z", "2091-01-01T00:00:00Z").length, 1);

  // mehrtägig ganztägig: berührt jeden Tag; Ende einschliesslich
  const span = ev({ allDay: true, start: "2026-06-10", end: "2026-06-12" });
  const s0 = range(span, "2026-06-12T00:00:00Z", "2026-06-12T12:00:00Z");
  assert.equal(s0.length, 1);
  assert.equal(s0[0].end, "2026-06-12");
  assert.equal(range(span, "2026-06-13T00:00:00Z", "2026-06-14T00:00:00Z").length, 0, "Folgetag ist frei");

  // Erinnerungs-Bezugszeit: ganztägig 09:00 Ortszeit, sonst Beginn
  assert.equal(range(span, "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z")[0].baseMs, iso("2026-06-10T07:00:00Z"));
}

// ---------------------------------------------------------------- Umgebung: Konten, Teams
const store = createMemoryStore();
const baseEnv = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const vapid = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "c".repeat(43), VAPID_SUBJECT: "mailto:admin@example.org" };
const mailEnv = { RESEND_API_KEY: "re_test", MAIL_FROM: "CRM <crm@example.org>", APP_URL: "https://crm.example.org" };
let clock = Date.parse("2026-10-25T08:00:00Z");
let pushed = [];
let mails = [];
let pushFail = false;
const webpush = {
  async sendNotification(sub, payload) {
    if (pushFail) throw Object.assign(new Error("boom"), { statusCode: 500 });
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  },
};
const fetchMock = async (url, init) => { mails.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
const realError = console.error;
console.error = (...a) => { if (!String(a[0]).includes("Web-Push senden")) realError(...a); }; // erwartete Fehler des simulierten Push-Dienstes
let env = { ...baseEnv };
const deps = () => ({ env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: fetchMock, webpush });
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
  return { id: c.user.id, token: p.token };
};
const teamA = await mkTeam("Team Alpha");
const teamB = await mkTeam("Team Beta");
const anna = await mkUser(teamA, "anna", { email: "anna@example.org" });
const ben = await mkUser(teamA, "ben", { email: "ben@example.org" });
const cleo = await mkUser(teamA, "cleo"); // weder Push noch E-Mail
const dora = await mkUser(teamB, "dora", { email: "dora@example.org" });
const emory = await mkUser(teamB, "emory");

// Sitzungen laufen ab; bei grossen Sprüngen der Uhr neu anmelden
const people = { anna, ben, cleo, dora, emory };
const relog = async () => {
  for (const [name, u] of Object.entries(people)) u.token = ok(await api("POST", "/login", { body: { username: name, password: PW } })).token;
  sa = ok(await api("POST", "/login", { body: { username: "root", password: PW } })).token;
};

const H = 3600000;
const T0 = clock;
const at = (ms) => new Date(ms).toISOString();
const newEv = (extra = {}) => ({ title: "Kundentermin", start: at(T0 + 5 * H), end: at(T0 + 6 * H), ...extra });
const RANGE = { from: at(T0 - 24 * H), to: at(T0 + 60 * 24 * H) };

// ---------------------------------------------------------------- Anmeldung und CRUD
assert.equal((await api("GET", "/calendar", { query: RANGE })).status, 401);
assert.equal((await api("GET", "/calendar", { token: sa, query: RANGE })).status, 409, "Superadmin ohne Team");

const c1 = ok(await api("POST", "/calendar/events", { token: anna.token, body: newEv({ location: "  Büro <b>3</b> ", notes: "Zeile 1\r\n\r\n\r\n\r\nZeile 2", participants: [ben.id], reminders: [60, 0, 60] }) }), 201).event;
assert.match(c1.id, /^ev_[0-9a-f]{12}$/);
assert.equal(c1.location, "Büro b3/b", "Spitze Klammern entfernt");
assert.equal(c1.notes, "Zeile 1\n\nZeile 2");
assert.deepEqual(c1.reminders, [0, 60], "dedupliziert und sortiert");
assert.equal(c1.tz, "Europe/Zurich");
assert.equal(c1.rev, 1);
assert.equal(c1.createdBy.id, anna.id);
assert.equal(c1.allDay, false);

// Prüfungen
const bad = async (body, code, who = anna) => { const r = await api("POST", "/calendar/events", { token: who.token, body }); assert.equal(r.status, 400, JSON.stringify(r.body)); assert.equal(r.body.error, code, JSON.stringify(r.body)); };
await bad(newEv({ title: "   " }), "cal_title");
await bad(newEv({ start: "morgen" }), "cal_time");
await bad(newEv({ start: "2026-10-25T10:00:00" }), "cal_time"); // ohne Zone
await bad(newEv({ start: at(T0 + 6 * H), end: at(T0 + 5 * H) }), "cal_range");
await bad(newEv({ end: at(T0 + 40 * 24 * H) }), "cal_span");
await bad({ title: "x", allDay: true, start: "2026-02-30" }, "cal_time");
await bad({ title: "x", allDay: true, start: "2026-02-01", end: "2026-01-01" }, "cal_range");
await bad(newEv({ participants: [dora.id] }), "cal_participant"); // anderes Team
await bad(newEv({ participants: ["u_ffffffffffffffff"] }), "cal_participant");
await bad(newEv({ reminders: [7] }), "cal_reminder");
await bad(newEv({ tz: "Mars/Base" }), "cal_tz");
await bad(newEv({ repeat: { freq: "hourly" } }), "cal_repeat");
await bad(newEv({ repeat: { freq: "daily", count: 0 } }), "cal_repeat");
await bad(newEv({ repeat: { freq: "daily", interval: 99 } }), "cal_repeat");
await bad(newEv({ repeat: { freq: "daily", until: "2020-01-01" } }), "cal_until");
assert.equal((await api("POST", "/calendar/events", { token: anna.token, body: "x".repeat(20000) })).status, 413);

// Lesen: Zeitraum
let list = ok(await api("GET", "/calendar", { token: ben.token, query: RANGE }));
assert.equal(list.occurrences.length, 1);
assert.equal(list.occurrences[0].eventId, c1.id);
assert.equal(list.events[0].title, "Kundentermin");
assert.deepEqual(list.members.map((m) => m.id).sort(), [anna.id, ben.id, cleo.id].sort(), "nur Mitglieder des eigenen Teams");
assert.equal((await api("GET", "/calendar", { token: ben.token, query: { from: RANGE.to, to: RANGE.from } })).status, 400);
assert.equal((await api("GET", "/calendar", { token: ben.token, query: { from: at(T0), to: at(T0 + 500 * 24 * H) } })).status, 400, "Zeitraum begrenzt");
assert.equal((await api("GET", "/calendar", { token: ben.token })).status, 400);
assert.equal(ok(await api("GET", "/calendar", { token: ben.token, query: { from: at(T0 + 10 * H), to: at(T0 + 20 * H) } })).occurrences.length, 0);
assert.equal(ok(await api("GET", `/calendar/events/${c1.id}`, { token: ben.token })).event.id, c1.id);

// Ändern: rev
const upd = ok(await api("PUT", `/calendar/events/${c1.id}`, { token: ben.token, body: { ...newEv({ title: "Verschoben" }), rev: 1, participants: [] } })).event;
assert.equal(upd.title, "Verschoben");
assert.equal(upd.rev, 2);
assert.equal(upd.createdBy.id, anna.id, "Ersteller bleibt");
assert.equal(upd.updatedBy.id, ben.id);
const conflict = await api("PUT", `/calendar/events/${c1.id}`, { token: anna.token, body: { ...newEv(), rev: 1 } });
assert.equal(conflict.status, 409);
assert.equal(conflict.body.error, "cal_conflict");
assert.equal(conflict.body.event.title, "Verschoben");
assert.equal((await api("PUT", `/calendar/events/${c1.id}`, { token: anna.token, body: newEv() })).status, 400, "rev fehlt");
assert.equal((await api("PUT", "/calendar/events/ev_aaaaaaaaaaaa", { token: anna.token, body: { ...newEv(), rev: 1 } })).status, 404);
assert.equal((await api("GET", "/calendar/events/nope", { token: anna.token })).status, 404);

// ---------------------------------------------------------------- Team-Trennung
const bEv = ok(await api("POST", "/calendar/events", { token: dora.token, body: newEv({ title: "Beta intern", participants: [emory.id] }) }), 201).event;
list = ok(await api("GET", "/calendar", { token: dora.token, query: RANGE }));
assert.deepEqual(list.events.map((e) => e.title), ["Beta intern"], "Team Beta sieht nichts von Alpha");
assert.deepEqual(list.members.map((m) => m.id).sort(), [dora.id, emory.id].sort());
list = ok(await api("GET", "/calendar", { token: anna.token, query: RANGE }));
assert.deepEqual(list.events.map((e) => e.title), ["Verschoben"]);
for (const [m, p, b] of [["GET", `/calendar/events/${bEv.id}`], ["PUT", `/calendar/events/${bEv.id}`, { ...newEv(), rev: 1 }], ["DELETE", `/calendar/events/${bEv.id}`]]) {
  assert.equal((await api(m, p, { token: anna.token, body: b })).status, 404, `${m} fremder Termin`);
}
// Header X-CRM-Team gilt nur für den Superadmin
assert.equal(ok(await api("GET", "/calendar", { token: dora.token, team: teamA.id, query: RANGE })).events.length, 1);
assert.equal(ok(await api("GET", "/calendar", { token: dora.token, team: teamA.id, query: RANGE })).events[0].title, "Beta intern");
const viaSa = ok(await api("GET", "/calendar", { token: sa, team: teamA.id, query: RANGE }));
assert.deepEqual(viaSa.events.map((e) => e.title), ["Verschoben"], "Superadmin sieht das gewählte Team");
ok(await api("POST", "/calendar/events", { token: sa, team: teamB.id, body: newEv({ title: "Support-Termin" }) }), 201);
assert.equal(ok(await api("GET", "/calendar", { token: dora.token, query: RANGE })).events.length, 2);
assert.equal(ok(await api("GET", "/calendar", { token: anna.token, query: RANGE })).events.length, 1);
assert.ok([...store.m.keys()].filter((k) => k.includes("cal/")).every((k) => k.startsWith("t/")), "alle Kalender-Schlüssel liegen im Team-Namensraum");

// Löschen
ok(await api("DELETE", `/calendar/events/${bEv.id}`, { token: emory.token }));
assert.equal((await api("DELETE", `/calendar/events/${bEv.id}`, { token: emory.token })).status, 404);
assert.equal(ok(await api("GET", "/calendar", { token: dora.token, query: RANGE })).events.length, 1);

// Serie über die API
const series = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Montagsrunde", start: at(Date.parse("2026-11-02T08:00:00Z")), end: at(Date.parse("2026-11-02T09:00:00Z")), repeat: { freq: "weekly", interval: 1, until: null, count: 5 } } }), 201).event;
const sl = ok(await api("GET", "/calendar", { token: ben.token, query: { from: "2026-11-01T00:00:00Z", to: "2027-01-31T00:00:00Z" } }));
const so = sl.occurrences.filter((o) => o.eventId === series.id);
assert.equal(so.length, 5);
assert.deepEqual(so.map((o) => o.start), ["2026-11-02T08:00:00.000Z", "2026-11-09T08:00:00.000Z", "2026-11-16T08:00:00.000Z", "2026-11-23T08:00:00.000Z", "2026-11-30T08:00:00.000Z"]);
assert.equal(sl.events.filter((e) => e.id === series.id).length, 1, "Termin nur einmal geliefert");
ok(await api("DELETE", `/calendar/events/${series.id}`, { token: anna.token }));

// ---------------------------------------------------------------- Erinnerungen
env = { ...baseEnv, ...vapid, ...mailEnv };
const sub = (id) => ({ endpoint: `https://fcm.googleapis.com/send/${id}`, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });
ok(await api("POST", "/push/subscribe", { token: anna.token, body: { subscription: sub("anna1") } }));
ok(await api("POST", "/push/subscribe", { token: dora.token, body: { subscription: sub("dora1") } }));
// Ben: kein Push-Abo, aber E-Mail; Cleo: weder noch

const run = () => CAL.runReminders({ env, store, now: () => clock, fetch: fetchMock, webpush });
const reset = () => { pushed = []; mails = []; };

// leere Kalender, nichts fällig
clock = T0;
assert.deepEqual(await run(), { teams: 0, due: 0, sent: 0 });
// Ohne Versandweg fasst der Lauf nichts an
{
  const keys = store.m.size;
  env = { ...baseEnv };
  assert.deepEqual(await CAL.runReminders({ env, store, now: () => clock }), { teams: 0, due: 0, sent: 0 });
  assert.equal(store.m.size, keys);
  env = { ...baseEnv, ...vapid, ...mailEnv };
}

// Termin in 3 h für Anna + Ben; Erinnerungen 1 h und zum Beginn
const evA = ok(await api("POST", "/calendar/events", { token: cleo.token, body: { title: "Planung <Q4>", location: "Raum 3", start: at(T0 + 3 * H), end: at(T0 + 4 * H), participants: [anna.id, ben.id], reminders: [60, 0] } }), 201).event;
// Termin für das ganze Team (keine Teilnehmer) in 3 h, Erinnerung 30 Min.
const evAll = ok(await api("POST", "/calendar/events", { token: cleo.token, body: { title: "Teammeeting", start: at(T0 + 3 * H), end: at(T0 + 4 * H), reminders: [30] } }), 201).event;
// Anderes Team, gleiche Zeit
ok(await api("POST", "/calendar/events", { token: dora.token, body: { title: "Beta-Meeting", start: at(T0 + 3 * H), end: at(T0 + 4 * H), reminders: [60] } }), 201);

clock = T0 + 1 * H;
assert.equal((await run()).sent, 0, "noch nichts fällig");

// 1 h vorher: 2 h nach T0 → Planung (Anna per Push, Ben per Mail) und Beta-Meeting (Dora per Push; Emory ohne Weg)
clock = T0 + 2 * H;
let r = await run();
assert.equal(r.due, 2);
assert.equal(r.sent, 3);
assert.deepEqual(pushed.map((p) => p.endpoint).sort(), ["https://fcm.googleapis.com/send/anna1", "https://fcm.googleapis.com/send/dora1"]);
const pa = pushed.find((p) => p.endpoint.endsWith("anna1")).payload;
assert.equal(pa.t, "cal");
assert.equal(pa.title, "Planung Q4", "Titel bereinigt");
assert.match(pa.body, /^25\.10\.2026 \d\d:\d\d – \d\d:\d\d \(Europe\/Zurich\) · Raum 3$/);
assert.equal(pa.url, `/#/kalender/${evA.id}?o=${encodeURIComponent(evA.start)}`);
assert.equal(pa.tag, `cal-${evA.id}`);
assert.equal(pushed.find((p) => p.endpoint.endsWith("dora1")).payload.title, "Beta-Meeting");
assert.equal(mails.length, 1);
assert.deepEqual(mails[0].body.to, ["ben@example.org"], "Ben ohne Push-Abo: E-Mail-Ersatz");
assert.match(mails[0].body.subject, /^Erinnerung: Planung Q4 \(in 1 Std\.\) \/ Reminder \(in 1 h\)$/);
assert.match(mails[0].body.text, /25\.10\.2026 1\d:00 – 1\d:00 \(Europe\/Zurich\)/);
assert.match(mails[0].body.text, /https:\/\/crm\.example\.org\/#\/kalender\/ev_/);
assert.ok(!pushed.some((p) => p.payload.title === "Beta-Meeting" && !p.endpoint.endsWith("dora1")), "Team Beta: nur Beta-Mitglieder");
assert.ok(!mails.some((m) => m.body.to.includes("dora@example.org")), "Dora hat Push");

// Doppelversand ausgeschlossen: erneuter Lauf und späterer Lauf innerhalb des Fensters
reset();
assert.equal((await run()).sent, 0, "gleicher Lauf nochmals");
clock += 5 * 60000;
assert.equal((await run()).sent, 0, "nächster Lauf 5 Minuten später");
clock += 5 * 60000;
assert.equal((await run()).sent, 0);
assert.equal(pushed.length + mails.length, 0);
// Gleichzeitige Läufe: nur einer sendet
reset();
clock = T0 + 2.5 * H; // 30 Min. vor Beginn: Teammeeting (ganzes Team)
const [x, y] = await Promise.all([run(), run()]);
assert.equal(x.sent + y.sent, 2, "ganzes Team: Anna (Push) + Ben (Mail); Cleo hat keinen Weg");
assert.equal(pushed.length, 1);
assert.equal(mails.length, 1);
assert.equal(pushed[0].payload.title, "Teammeeting");
reset();
assert.equal((await run()).sent, 0);

// Zum Beginn (0 Min.): Planung nochmals, aber anderer Schlüssel
clock = T0 + 3 * H;
reset();
r = await run();
assert.equal(r.sent, 2, "Planung zum Beginn: Anna + Ben");
assert.match(mails[0].body.subject, /\(jetzt\) \/ Reminder \(now\)/);
reset();
assert.equal((await run()).sent, 0);

// Ausgefallene Läufe: bis 15 Minuten nach dem Zeitpunkt wird noch gesendet, danach nicht mehr
const evLate = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Spät", start: at(T0 + 10 * H), end: at(T0 + 11 * H), reminders: [0], participants: [anna.id] } }), 201).event;
reset();
clock = T0 + 10 * H + 14 * 60000;
assert.equal((await run()).sent, 1, "14 Minuten zu spät: noch gesendet");
const evTooLate = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Zu spät", start: at(T0 + 12 * H), end: at(T0 + 13 * H), reminders: [0], participants: [anna.id] } }), 201).event;
reset();
clock = T0 + 12 * H + 20 * 60000;
assert.equal((await run()).sent, 0, "20 Minuten zu spät: verfallen");
assert.ok(evLate && evTooLate);

// Termin, dessen Erinnerungszeit beim Anlegen schon verstrichen war: keine sofortige Erinnerung
clock = T0 + 20 * H;
const evPast = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Kurzfristig", start: at(clock + 40 * 60000), end: at(clock + 2 * H), reminders: [60], participants: [anna.id] } }), 201).event;
reset();
clock += 5 * 60000;
assert.equal((await run()).sent, 0, "Erinnerung 1 h vorher war beim Anlegen schon vorbei");
// Nachträgliches Verschieben setzt neu auf: neue Zeit, Erinnerung kommt
ok(await api("PUT", `/calendar/events/${evPast.id}`, { token: anna.token, body: { ...evPast, start: at(clock + 70 * 60000), end: at(clock + 2 * H), rev: 1 } }));
reset();
clock += 12 * 60000;
assert.equal((await run()).sent, 1);

// Serie: jede Woche Mittwoch 09:00 Zürich (über die Zeitumstellung vom 25.10.), Erinnerung 10 Minuten vorher
clock = Date.parse("2026-10-20T08:00:00Z");
const wk = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Mittwochs", start: "2026-10-21T07:00:00.000Z", end: "2026-10-21T08:00:00.000Z", reminders: [10], participants: [anna.id], repeat: { freq: "weekly", interval: 1, until: null, count: null } } }), 201).event;
const fired = [];
for (const when of ["2026-10-21T06:50:00Z", "2026-10-28T06:50:00Z" /* alte UTC-Zeit: zu früh */, "2026-10-28T07:50:00Z" /* 09:00 Winterzeit = 08:00 UTC */, "2026-11-04T07:50:00Z"]) {
  clock = Date.parse(when);
  reset();
  fired.push((await run()).sent);
  if (when.startsWith("2026-10-28T07")) {
    const sentDoc = (await store.read(`t/${teamA.id}/cal/sent`)).value.sent;
    assert.ok(`${wk.id}|2026-10-28T08:00:00.000Z|10` in sentDoc, "Vorkommen vom 28.10. um 08:00 UTC (= 09:00 Zürich) vermerkt");
  }
}
assert.deepEqual(fired, [1, 0, 1, 1]);
// Alte Vermerke werden entfernt (nach SENT_KEEP_MS), neue bleiben
clock = Date.parse("2026-11-20T08:00:00Z");
await relog();
const evPrune = ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Prune", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z", reminders: [60], participants: [anna.id] } }), 201).event;
clock = Date.parse("2026-11-20T08:00:00Z") + 1000;
{
  const evP = ok(await api("PUT", `/calendar/events/${evPrune.id}`, { token: anna.token, body: { ...evPrune, start: "2026-11-20T10:30:00.000Z", end: "2026-11-20T11:30:00.000Z", rev: 1 } })).event;
  assert.equal(evP.rev, 2);
  clock = Date.parse("2026-11-20T09:30:00Z");
  reset();
  assert.equal((await run()).sent, 1);
  const sentDoc = (await store.read(`t/${teamA.id}/cal/sent`)).value.sent;
  assert.ok(!Object.keys(sentDoc).some((k) => k.startsWith(wk.id)), "Vermerke der Serie vom Oktober sind entfernt");
  assert.ok(`${evP.id}|2026-11-20T10:30:00.000Z|60` in sentDoc);
}

// Zustellung scheitert: ohne E-Mail-Adresse wird der Vermerk zurückgenommen und der nächste Lauf versucht es erneut – danach nie doppelt
clock = Date.parse("2026-12-01T07:00:00Z");
await relog();
const finn = await mkUser(teamA, "finn"); // nur Push, keine E-Mail
people.finn = finn;
env = { ...baseEnv, ...vapid, ...mailEnv };
ok(await api("POST", "/push/subscribe", { token: finn.token, body: { subscription: sub("finn1") } }));
clock = Date.parse("2026-12-01T08:00:00Z");
ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Retry", start: "2026-12-01T09:00:00.000Z", end: "2026-12-01T10:00:00.000Z", reminders: [0], participants: [finn.id] } }), 201);
clock = Date.parse("2026-12-01T09:00:00Z");
reset();
pushFail = true;
assert.equal((await run()).sent, 0);
assert.equal(pushed.length, 0);
pushFail = false;
clock += 5 * 60000;
assert.equal((await run()).sent, 1, "zweiter Versuch gelingt");
assert.equal(pushed.length, 1);
assert.equal(pushed[0].endpoint, "https://fcm.googleapis.com/send/finn1");
clock += 5 * 60000;
assert.equal((await run()).sent, 0, "danach nicht nochmals");
assert.equal(pushed.length, 1);

// Push scheitert, E-Mail-Adresse vorhanden: E-Mail-Ersatz
clock = Date.parse("2026-12-02T08:00:00Z");
ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Mail-Ersatz", start: "2026-12-02T09:00:00.000Z", end: "2026-12-02T10:00:00.000Z", reminders: [0], participants: [anna.id] } }), 201);
clock = Date.parse("2026-12-02T09:00:00Z");
reset();
pushFail = true;
assert.equal((await run()).sent, 1);
pushFail = false;
assert.deepEqual(mails.map((m) => m.body.to[0]), ["anna@example.org"]);
assert.equal(pushed.length, 0);

// Ganztägig: Erinnerung 1 Tag vorher um 09:00 Ortszeit des Vortags
clock = Date.parse("2026-12-10T08:00:00Z");
await relog();
ok(await api("POST", "/calendar/events", { token: anna.token, body: { title: "Messe", allDay: true, start: "2026-12-15", end: "2026-12-16", reminders: [1440], participants: [anna.id] } }), 201);
reset();
clock = Date.parse("2026-12-14T07:59:00Z");
assert.equal((await run()).sent, 0);
clock = Date.parse("2026-12-14T08:00:00Z"); // 09:00 Winterzeit
assert.equal((await run()).sent, 1);
assert.match(pushed[0].payload.body, /^15\.12\.2026 – 16\.12\.2026 \(ganztägig \/ all day\)/);

// Ein deaktiviertes Team bekommt keine Erinnerungen mehr
clock = Date.parse("2026-12-20T08:00:00Z");
await relog();
ok(await api("POST", "/calendar/events", { token: dora.token, body: { title: "Beta später", start: "2026-12-20T09:00:00.000Z", end: "2026-12-20T10:00:00.000Z", reminders: [0] } }), 201);
ok(await api("PATCH", `/teams/${teamB.id}`, { token: sa, body: { active: false } }));
clock = Date.parse("2026-12-20T09:00:00Z");
reset();
assert.deepEqual(await run(), { teams: 0, due: 0, sent: 0 });
assert.equal(pushed.length + mails.length, 0);

// ---- Feature-Schalter: CALENDAR_ENABLED explizit aus → Kalender/Outlook-Pfade 404, Erinnerungen und Abgleich tun nichts, Daten bleiben
{
  const before = JSON.stringify((await store.read(`t/${teamA.id}/cal/events`))?.value ?? null);
  for (const off of ["0", "off", "false", "no"]) {
    env = { ...baseEnv, CALENDAR_ENABLED: off };
    assert.equal((await api("GET", "/calendar", { token: anna.token, query: { from: "2026-01-01", to: "2026-12-31" } })).status, 404, "Kalender aus: GET /calendar 404");
    assert.equal((await api("POST", "/calendar/events", { token: anna.token, body: {} })).status, 404, "Kalender aus: POST 404");
    assert.equal((await api("GET", "/outlook/status", { token: anna.token })).status, 404, "Outlook aus: 404");
    assert.equal((await api("GET", "/outlook/callback")).status, 404, "Outlook-Rückleitung aus: 404");
    assert.deepEqual(await CAL.runReminders({ env, store, now: () => clock, fetch: fetchMock, webpush }), { teams: 0, due: 0, sent: 0 });
  }
  env = { ...baseEnv };
  assert.equal(JSON.stringify((await store.read(`t/${teamA.id}/cal/events`))?.value ?? null), before, "Termine unverändert");
}

console.log("Kalender-Tests: alle bestanden");
