#!/usr/bin/env node
// Prüft Team-Chat, Push und E-Mail-Ersatz gegen den In-Memory-Store (ohne Netzwerk) – Aufruf: node scripts/test-chat.mjs  (npm run test:chat)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";

const store = createMemoryStore();
const baseEnv = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const vapid = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "c".repeat(43), VAPID_SUBJECT: "mailto:admin@example.org" };
let clock = Date.parse("2026-10-25T10:00:00Z");
const pushed = [];
const mails = [];
const webpush = {
  async sendNotification(sub, payload, opts) {
    if (sub.endpoint.includes("/gone/")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts });
  },
};
const fetchMock = async (url, init) => { mails.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return { ok: true, status: 200 }; };

let env = { ...baseEnv };
async function api(method, path, { token, team, body, query } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}) };
  const res = await handleApi(
    { method, path: "/api" + path, query: new URLSearchParams(query || {}), headers, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: fetchMock, webpush },
  );
  return res;
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

// ---- Konten: Superadmin, zwei Teams, je zwei Mitglieder
const su = ok(await api("POST", "/login", { body: { username: "root", password: baseEnv.CRM_PASSWORD } }));
const PW = "Ein-langes-Passwort-1";
let sa = ok(await api("POST", "/me/password", { token: su.token, body: { current: baseEnv.CRM_PASSWORD, new: PW } })).token;
const mkTeam = async (name) => ok(await api("POST", "/teams", { token: sa, body: { name } }), 201).team;
const mkUser = async (team, username, extra = {}) => {
  const c = ok(await api("POST", "/users", { token: sa, body: { username, displayName: username.toUpperCase(), role: "member", teamId: team.id, ...extra } }), 201);
  const l = ok(await api("POST", "/login", { body: { username, password: c.temporaryPassword } }));
  const p = ok(await api("POST", "/me/password", { token: l.token, body: { current: c.temporaryPassword, new: PW } }));
  return { id: c.user.id, token: p.token, user: c.user };
};
const teamA = await mkTeam("Team Alpha");
const teamB = await mkTeam("Team Beta");
const anna = await mkUser(teamA, "anna", { email: "Anna@Example.org" });
const ben = await mkUser(teamA, "ben", { email: "ben@example.org" });
const cleo = await mkUser(teamA, "cleo"); // ohne E-Mail
const dora = await mkUser(teamB, "dora");
assert.equal(anna.user.email, "anna@example.org", "E-Mail wird klein geschrieben");
assert.equal((await api("POST", "/users", { token: sa, body: { username: "bad", displayName: "Bad", role: "member", teamId: teamA.id, email: "kein-mail" } })).status, 400);

// ---- Chat: senden, lesen, Isolation
assert.equal((await api("GET", "/chat")).status, 401);
const sent = ok(await api("POST", "/chat", { token: anna.token, body: { text: "  Hallo <b>Team</b>\r\n\r\n\r\n\r\nZeile 2  ", cid: "c1" } }), 201);
assert.equal(sent.message.id, 1);
assert.equal(sent.message.text, "Hallo <b>Team</b>\n\nZeile 2", "reiner Text, nur Umbrüche normalisiert (Escapen macht der Browser)");
const dup = ok(await api("POST", "/chat", { token: anna.token, body: { text: "Hallo <b>Team</b>", cid: "c1" } }), 201);
assert.equal(dup.message.id, 1, "gleiche cid = keine Doppelung");
ok(await api("POST", "/chat", { token: ben.token, body: { text: "Antwort von Ben" } }), 201);
assert.equal((await api("POST", "/chat", { token: ben.token, body: { text: "   " } })).status, 400);
assert.equal((await api("POST", "/chat", { token: ben.token, body: { text: "x".repeat(2001) } })).status, 400);
assert.equal((await api("POST", "/chat", { token: ben.token, body: { text: "hi", uid: "u_fake", teamId: teamB.id } })).status, 201);

const lA = ok(await api("GET", "/chat", { token: cleo.token }));
assert.deepEqual(lA.messages.map((m) => m.id), [1, 2, 3]);
assert.equal(lA.unread, 3, "Cleo hat nichts gelesen");
assert.equal(lA.messages[2].uid, ben.id, "Autor kommt vom Konto, nicht vom Body");
assert.ok(!("cid" in lA.messages[0]));
const lAnna = ok(await api("GET", "/chat", { token: anna.token }));
assert.equal(lAnna.unread, 2, "eigene Nachricht zählt nicht als ungelesen");
const lB = ok(await api("GET", "/chat", { token: dora.token }));
assert.equal(lB.messages.length, 0, "Team Beta sieht nichts von Team Alpha");
assert.equal(lB.unread, 0);
// Teamwahl nur für den Superadmin: Header eines normalen Benutzers wird ignoriert
const sneaky = ok(await api("GET", "/chat", { token: dora.token, team: teamA.id }));
assert.equal(sneaky.messages.length, 0);
assert.equal((await api("GET", "/chat", { token: sa })).status, 409, "Superadmin ohne Team");
assert.equal(ok(await api("GET", "/chat", { token: sa, team: teamA.id })).messages.length, 3);
const saMsg = ok(await api("POST", "/chat", { token: sa, team: teamB.id, body: { text: "Support" } }), 201).message;
assert.equal(saMsg.sa, true);
assert.equal(ok(await api("GET", "/chat", { token: dora.token })).messages.length, 1);

// since / peek / before / mark-read
assert.deepEqual(ok(await api("GET", "/chat", { token: cleo.token, query: { since: "2" } })).messages.map((m) => m.id), [3]);
assert.equal(ok(await api("GET", "/chat", { token: cleo.token, query: { since: "3" } })).messages.length, 0);
const peek = ok(await api("GET", "/chat", { token: cleo.token, query: { peek: "1" } }));
assert.equal(peek.messages.length, 0);
assert.equal(peek.unread, 3);
assert.deepEqual(ok(await api("GET", "/chat", { token: cleo.token, query: { before: "3", limit: "1" } })).messages.map((m) => m.id), [2]);
const rd = ok(await api("POST", "/chat/read", { token: cleo.token, body: { upTo: 2 } }));
assert.equal(rd.readId, 2);
assert.equal(ok(await api("GET", "/chat", { token: cleo.token })).unread, 1);
ok(await api("POST", "/chat/read", { token: cleo.token, body: { upTo: 99 } }));
assert.equal(ok(await api("GET", "/chat", { token: cleo.token })).unread, 0, "upTo wird auf die letzte ID begrenzt");

// ---- Segmente und Obergrenze
for (let i = 0; i < 230; i++) ok(await api("POST", "/chat", { token: ben.token, body: { text: `msg ${i}` } }), 201), (clock += 4000);
const newest = ok(await api("GET", "/chat", { token: anna.token, query: { limit: "100" } }));
assert.equal(newest.messages.length, 100);
assert.equal(newest.messages.at(-1).id, 233);
assert.equal(newest.hasMore, true);
const ids = ok(await api("GET", "/chat", { token: anna.token, query: { before: String(newest.messages[0].id), limit: "100" } })).messages.map((m) => m.id);
assert.equal(ids.at(-1), newest.messages[0].id - 1, "lückenlos über Segmentgrenzen");
assert.equal(new Set(ids).size, ids.length);
const gap = ok(await api("GET", "/chat", { token: cleo.token, query: { since: "3", limit: "50" } }));
assert.equal(gap.gap, true);
assert.ok([...store.m.keys()].every((k) => !k.startsWith("chat/") || k.startsWith("t/")), "alle Chat-Schlüssel liegen im Team-Namensraum");

// ---- Tempolimit
clock += 120000;
let limited = 0;
for (let i = 0; i < 25; i++) if ((await api("POST", "/chat", { token: ben.token, body: { text: "spam" } })).status === 429) limited++;
assert.ok(limited >= 5, "Tempolimit greift");
clock += 120000;

// ---- Push
assert.equal(ok(await api("GET", "/push/config", { token: anna.token })).enabled, false, "ohne VAPID: Funktion verborgen");
env = { ...baseEnv, ...vapid };
const cfg = ok(await api("GET", "/push/config", { token: anna.token }));
assert.equal(cfg.enabled, true);
assert.equal(cfg.publicKey, vapid.VAPID_PUBLIC_KEY);
assert.equal(ok(await api("GET", "/push/config", { token: sa, team: teamA.id })).enabled, false, "Superadmin ist kein Mitglied");
const sub = (host, id) => ({ endpoint: `https://${host}/send/${id}`, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });
assert.equal((await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: { endpoint: "https://evil.example.org/x", keys: { p256dh: "p", auth: "a" } } } })).status, 400, "unbekannter Push-Dienst");
assert.equal((await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: { endpoint: "http://fcm.googleapis.com/x", keys: { p256dh: "p", auth: "a" } } } })).status, 400, "nur https");
ok(await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: sub("fcm.googleapis.com", "ben1") } }));
ok(await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: sub("updates.push.services.mozilla.com", "gone/ben2") } }));
ok(await api("POST", "/push/subscribe", { token: dora.token, body: { subscription: sub("fcm.googleapis.com", "dora1") } }));
pushed.length = 0; mails.length = 0;
env = { ...baseEnv, ...vapid, RESEND_API_KEY: "re_test", MAIL_FROM: "CRM <crm@example.org>", APP_URL: "https://crm.example.org/" };
ok(await api("POST", "/chat", { token: anna.token, body: { text: "Push-Test" } }), 201);
assert.deepEqual(pushed.map((p) => p.endpoint), ["https://fcm.googleapis.com/send/ben1"], "nur Ben (Team Alpha, nicht der Absender, nicht Dora)");
assert.equal(pushed[0].payload.title, "ANNA");
assert.equal(pushed[0].payload.body, "Push-Test");
assert.equal(pushed[0].opts.vapidDetails.subject, vapid.VAPID_SUBJECT);
assert.ok(!(await store.read(`t/${teamA.id}/push/${ben.id}`)).value.subs.some((s) => s.endpoint.includes("/gone/")), "410 entfernt das Abo");
// E-Mail: Cleo hat keine Adresse, Ben hat Push → keine Mail
assert.equal(mails.length, 0);
// Ben meldet sich ab → E-Mail-Ersatz (Anna selbst nicht, Cleo ohne Adresse nicht)
ok(await api("POST", "/push/unsubscribe", { token: ben.token, body: { endpoint: "https://fcm.googleapis.com/send/ben1" } }));
pushed.length = 0;
ok(await api("POST", "/chat", { token: anna.token, body: { text: "Mail-Test" } }), 201);
assert.equal(pushed.length, 0);
assert.equal(mails.length, 1);
assert.deepEqual(mails[0].body.to, ["ben@example.org"]);
assert.equal(mails[0].url, "https://api.resend.com/emails");
assert.equal(mails[0].auth, "Bearer re_test");
assert.match(mails[0].body.text, /https:\/\/crm\.example\.org\/#\/chat/);
// Drosselung: innerhalb von 30 Minuten keine zweite Mail
clock += 60000;
ok(await api("POST", "/chat", { token: anna.token, body: { text: "noch eine" } }), 201);
assert.equal(mails.length, 1, "höchstens eine Mail je 30 Minuten");
clock += 31 * 60000;
ok(await api("POST", "/chat", { token: anna.token, body: { text: "später" } }), 201);
assert.equal(mails.length, 2);
// ein Gerät = eine Person: Cleo übernimmt Dora-Endpunkt? (anderes Team: unberührt) – gleicher Endpunkt bei Anna und Ben im selben Team wandert zu Ben
env = { ...baseEnv, ...vapid };
ok(await api("POST", "/push/subscribe", { token: anna.token, body: { subscription: sub("fcm.googleapis.com", "shared") } }));
ok(await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: sub("fcm.googleapis.com", "shared") } }));
assert.equal((await store.read(`t/${teamA.id}/push/${anna.id}`)).value.subs.length, 0);
assert.equal((await store.read(`t/${teamA.id}/push/${ben.id}`)).value.subs.length, 1);

// ---- Kanal «Geschäftsleitung» (mgmt): nur Team-Admins und Benutzer mit Management-Kennzeichen, serverseitig erzwungen
{
  clock += 3600000;
  env = { ...baseEnv, ...vapid, RESEND_API_KEY: "re_test", MAIL_FROM: "CRM <crm@example.org>", APP_URL: "https://crm.example.org/" };
  const ada = await mkUser(teamA, "ada", { role: "admin", email: "ada@example.org" }); // Team-Admin
  const mia = await mkUser(teamA, "mia", { management: true, email: "mia@example.org" }); // Mitglied mit Management-Kennzeichen
  assert.equal(mia.user.management, true);
  assert.equal(ada.user.management, false);
  const MG = { channel: "mgmt" };

  // Gewöhnliches Mitglied: kein Zugriff (lesen, schreiben, peek, als gelesen markieren, unbekannter Kanal)
  ok(await api("POST", "/chat", { token: ada.token, body: { text: "Budget 2027 – nur GL", channel: "mgmt", cid: "m1" } }), 201);
  for (const who of [anna, ben, cleo, dora]) {
    assert.equal((await api("GET", "/chat", { token: who.token, query: MG })).status, 403, "Mitglied darf den GL-Kanal nicht lesen");
    assert.equal((await api("GET", "/chat", { token: who.token, query: { channel: "mgmt", peek: "1" } })).status, 403, "auch kein peek");
    assert.equal((await api("POST", "/chat", { token: who.token, body: { text: "ich darf nicht", channel: "mgmt" } })).status, 403, "und nicht schreiben");
    assert.equal((await api("POST", "/chat/read", { token: who.token, body: { upTo: 1, channel: "mgmt" } })).status, 403);
  }
  assert.equal((await api("GET", "/chat", { token: anna.token, query: { channel: "nope" } })).status, 400);
  assert.equal(ok(await api("GET", "/chat", { token: anna.token })).channels.join(), "team", "Mitglied kennt nur den Team-Kanal");
  // Gesamt-Kanal zeigt nie GL-Nachrichten
  const teamList = ok(await api("GET", "/chat", { token: anna.token, query: { limit: "100" } }));
  assert.ok(!teamList.messages.some((m) => /Budget 2027/.test(m.text)));
  assert.ok(![...store.m.entries()].some(([k, v]) => k.startsWith(`t/${teamA.id}/chat/`) && /Budget 2027/.test(JSON.stringify(v))), "GL-Text nie im Team-Kanal gespeichert");

  // Admin und Management-Mitglied lesen/schreiben; Unterhaltung getrennt vom Team-Kanal
  ok(await api("POST", "/chat", { token: mia.token, body: { text: "Antwort GL", channel: "mgmt" } }), 201);
  const gl = ok(await api("GET", "/chat", { token: ada.token, query: MG }));
  assert.deepEqual(gl.messages.map((m) => m.text), ["Budget 2027 – nur GL", "Antwort GL"]);
  assert.equal(gl.channels.join(), "team,mgmt");
  assert.equal(gl.unread, 1, "Ada hat die Antwort von Mia noch nicht gelesen");
  assert.equal(gl.messages[0].id, 1, "eigene Nummerierung je Kanal");
  assert.equal(ok(await api("GET", "/chat", { token: mia.token, query: MG })).messages.length, 2);
  ok(await api("POST", "/chat/read", { token: ada.token, body: { upTo: 2, channel: "mgmt" } }));
  assert.equal(ok(await api("GET", "/chat", { token: ada.token, query: { channel: "mgmt", peek: "1" } })).unread, 0);
  assert.equal(ok(await api("GET", "/chat", { token: dora.token })).messages.length, 1, "anderes Team: weiter nur eigener Team-Kanal");
  assert.equal((await api("GET", "/chat", { token: dora.token, team: teamA.id, query: MG })).status, 403, "Teamwahl-Header hilft nicht");
  assert.ok(ok(await api("GET", "/chat", { token: sa, team: teamA.id, query: MG })).messages.length >= 2, "Superadmin (Support) im Team-Kontext");

  // Benachrichtigungen des GL-Kanals gehen nur an Berechtigte
  ok(await api("POST", "/push/subscribe", { token: cleo.token, body: { subscription: sub("fcm.googleapis.com", "cleo1") } }));
  ok(await api("POST", "/push/subscribe", { token: mia.token, body: { subscription: sub("fcm.googleapis.com", "mia1") } }));
  pushed.length = 0; mails.length = 0;
  ok(await api("POST", "/chat", { token: ada.token, body: { text: "vertraulich", channel: "mgmt" } }), 201);
  assert.deepEqual(pushed.map((p) => p.endpoint), ["https://fcm.googleapis.com/send/mia1"], "nur Mia (Management), nicht Cleo/Ben/Anna");
  assert.ok(mails.every((m) => !m.body.to.some((a) => ["anna@example.org", "ben@example.org"].includes(a))), "keine Mail an gewöhnliche Mitglieder");

  // Management-Kennzeichen setzen/entziehen: nur Team-Admin (serverseitig); Mitglied kann es sich nicht selbst geben
  assert.equal((await api("PATCH", `/users/${anna.id}`, { token: anna.token, body: { management: true } })).status, 403, "Mitglied kann sich nicht befördern");
  assert.equal((await api("PATCH", `/users/${anna.id}`, { token: mia.token, body: { management: true } })).status, 403, "Management-Flag allein reicht nicht für Benutzerverwaltung");
  assert.equal((await api("PATCH", `/users/${anna.id}`, { token: ada.token, body: { management: "yes" } })).status, 400);
  assert.equal((await api("PATCH", `/users/${dora.id}`, { token: ada.token, body: { management: true } })).status, 404, "fremdes Team unsichtbar");
  const granted = ok(await api("PATCH", `/users/${anna.id}`, { token: ada.token, body: { management: true } }));
  assert.equal(granted.user.management, true);
  assert.equal(ok(await api("GET", "/chat", { token: anna.token, query: MG })).messages.length, 3, "Zugriff sofort nach Freigabe");
  const revoked = ok(await api("PATCH", `/users/${anna.id}`, { token: ada.token, body: { management: false } }));
  assert.equal(revoked.user.management, false);
  assert.equal((await api("GET", "/chat", { token: anna.token, query: MG })).status, 403, "Zugriff sofort wieder weg");
  // Abgestufter Admin verliert den Zugang
  ok(await api("PATCH", `/users/${ben.id}`, { token: ada.token, body: { role: "admin" } }));
  assert.equal(ok(await api("GET", "/chat", { token: ben.token, query: MG })).messages.length, 3);
  ok(await api("PATCH", `/users/${ben.id}`, { token: ada.token, body: { role: "member" } }));
  assert.equal((await api("GET", "/chat", { token: ben.token, query: MG })).status, 403);
  assert.ok((await store.read(`t/${teamA.id}/chatm/meta`)).value.head >= 1, "GL-Kanal liegt unter eigenem Präfix im Team-Namensraum");
}

console.log("Chat-Tests: alle bestanden");
