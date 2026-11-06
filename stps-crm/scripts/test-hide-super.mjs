#!/usr/bin/env node
// Prüft, dass der Superadmin für Team-Mitglieder unsichtbar ist (serverseitig gefilterte Antworten) – Aufruf: node scripts/test-hide-super.mjs  (npm run test:hide-super)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";

const store = createMemoryStore();
const baseEnv = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const vapid = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "c".repeat(43), VAPID_SUBJECT: "mailto:admin@example.org" };
let clock = Date.parse("2026-10-25T10:00:00Z");
const pushed = [];
const mails = [];
const webpush = { async sendNotification(sub, payload) { pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); } };
const fetchMock = async (url, init) => { mails.push({ body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
let env = { ...baseEnv };
async function api(method, path, { token, team, body, query } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}) };
  return handleApi(
    { method, path: "/api" + path, query: new URLSearchParams(query || {}), headers, bodyText: body === undefined ? "" : JSON.stringify(body) },
    { env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: fetchMock, webpush },
  );
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const dump = (x) => JSON.stringify(x);

// ---- Konten: Superadmin «Rootina Superadmin-Name», ein Team mit Admin + Mitglied
const su = ok(await api("POST", "/login", { body: { username: "root", password: baseEnv.CRM_PASSWORD } }));
const PW = "Ein-langes-Passwort-1";
const sa = ok(await api("POST", "/me/password", { token: su.token, body: { current: baseEnv.CRM_PASSWORD, new: PW } })).token;
const SA_ID = ok(await api("GET", "/me", { token: sa })).user.id;
const SA_NAME = ok(await api("GET", "/me", { token: sa })).user.displayName;
const team = ok(await api("POST", "/teams", { token: sa, body: { name: "Team Alpha" } }), 201).team;
const mkUser = async (username, role, extra = {}) => {
  const c = ok(await api("POST", "/users", { token: sa, body: { username, displayName: username.toUpperCase(), role, teamId: team.id, ...extra } }), 201);
  const l = ok(await api("POST", "/login", { body: { username, password: c.temporaryPassword } }));
  const p = ok(await api("POST", "/me/password", { token: l.token, body: { current: c.temporaryPassword, new: PW } }));
  return { id: c.user.id, token: p.token };
};
const anna = await mkUser("anna", "admin", { email: "anna@example.org" });
const ben = await mkUser("ben", "member", { email: "ben@example.org" });
const asSuper = { token: sa, team: team.id };

// ---- Anzeigename darf nicht wie ein Superadmin-Stempel lauten
assert.equal((await api("POST", "/users", { token: anna.token, body: { username: "evil", displayName: "Chef (Superadmin)", role: "member" } })).status, 400);

// ---- Eintritt ins Team: im Änderungsprotokoll nur für den Superadmin
ok(await api("POST", `/teams/${team.id}/enter`, { token: sa }));
assert.ok(ok(await api("GET", "/audit", { token: sa, team: team.id })).entries.some((e) => e.action === "enter"), "Superadmin sieht den Eintritt");
assert.ok(!ok(await api("GET", "/audit", { token: anna.token })).entries.some((e) => e.action === "enter"), "Mitglieder sehen den Eintritt nicht");

// ---- Anwesenheit
ok(await api("POST", "/presence", { ...asSuper, body: { route: "#/kunden", title: "Kunden" } }));
ok(await api("POST", "/presence", { token: ben.token, body: { route: "#/kunden", title: "Kunden" } }));
const presMember = ok(await api("GET", "/presence", { token: anna.token }));
assert.deepEqual(presMember.presence.map((p) => p.uid), [ben.id], "online: nur Ben");
assert.ok(!(SA_ID in presMember.lastSeen), "auch lastSeen ohne Superadmin");
assert.ok(!dump(presMember).includes(SA_ID));
const presSuper = ok(await api("GET", "/presence", asSuper));
assert.ok(presSuper.presence.some((p) => p.uid === SA_ID && p.superadmin), "der Superadmin sieht sich und alle anderen");
assert.ok(presSuper.presence.some((p) => p.uid === ben.id));

// ---- Team-Seite
const teamMember = ok(await api("GET", "/team", { token: ben.token }));
assert.deepEqual(teamMember.users.map((u) => u.id).sort(), [anna.id, ben.id].sort());
assert.deepEqual(teamMember.visitors, [], "keine Besucher");
assert.ok(!dump(teamMember).includes(SA_ID) && !dump(teamMember).includes(SA_NAME + " (Superadmin)"));
const teamSuper = ok(await api("GET", "/team", asSuper));
assert.equal(teamSuper.visitors.length, 1, "der Superadmin sieht seine Besucher-Karte");
assert.equal(ok(await api("GET", "/users", { token: anna.token })).users.some((u) => u.role === "superadmin"), false, "Benutzerliste ohne Superadmin");
assert.equal(ok(await api("GET", "/users", { token: anna.token, query: { teamId: "tm_000000000000" } })).users.some((u) => u.id === SA_ID), false);
assert.ok(!dump(teamMember.team.owners).includes(SA_NAME), "Verantwortliche ohne Superadmin");

// ---- Daten: Stempel und Änderungsprotokoll
const v1 = ok(await api("PUT", "/db", { ...asSuper, body: { baseVersion: 0, data: { schema: 1, customers: [{ id: "c1", firma: "Alpha AG" }] } } }));
const saStamp = `${SA_NAME} (Superadmin)`;
const dbSuper = ok(await api("GET", "/db", asSuper));
assert.equal(dbSuper.data.customers[0].createdBy, saStamp, "Superadmin sieht seinen Stempel");
assert.equal(dbSuper.savedBy, saStamp);
const dbMember = ok(await api("GET", "/db", { token: anna.token }));
assert.equal(dbMember.data.customers[0].createdBy, "System");
assert.equal(dbMember.data.customers[0].updatedBy, "System");
assert.equal(dbMember.savedBy, "System");
assert.ok(!dump(dbMember).includes("Superadmin"), "kein Hinweis auf den Superadmin in /db");
// Mitglied speichert den bereinigten Stand zurück und ändert einen anderen Datensatz: Stempel des Superadmins bleiben im Speicher erhalten
clock += 60000;
const putM = ok(await api("PUT", "/db", { token: anna.token, body: { baseVersion: v1.version, data: { ...dbMember.data, customers: [...dbMember.data.customers, { id: "c2", firma: "Beta GmbH" }] } } }));
assert.equal((await store.read(`t/${team.id}/db`)).value.data.customers[0].createdBy, saStamp, "gespeicherter Stempel unverändert");
assert.equal((await store.read(`t/${team.id}/db`)).value.data.customers[1].createdBy, "ANNA");
// Konflikt-Antwort ebenfalls bereinigt
const conflict = await api("PUT", "/db", { token: ben.token, body: { baseVersion: v1.version, data: { schema: 1, customers: [] } } });
assert.equal(conflict.status, 409);
assert.ok(!dump(conflict.body).includes("Superadmin"), "409 ohne Superadmin");
const backups = ok(await api("GET", "/backups", { token: anna.token })).backups;
assert.ok(backups.length > 0);
assert.ok(!dump(ok(await api("GET", `/backups/${backups[0].id}`, { token: anna.token }))).includes("Superadmin"), "Backup ohne Superadmin");
assert.ok(dump(ok(await api("GET", `/backups/${backups[0].id}`, asSuper))).includes("Superadmin"), "der Superadmin sieht sie");

// Protokoll
const auditSuper = ok(await api("GET", "/audit", asSuper)).entries;
assert.ok(auditSuper.some((e) => e.superadmin && e.displayName === SA_NAME && e.uid === SA_ID));
const auditMember = ok(await api("GET", "/audit", { token: ben.token })).entries;
const sysEntry = auditMember.find((e) => e.table === "customers" && e.recordId === "c1");
assert.ok(sysEntry, "Änderung des Superadmin ist im Protokoll (anonym)");
assert.equal(sysEntry.anon, true);
assert.equal(sysEntry.uid, "");
assert.equal(sysEntry.displayName, "");
assert.ok(!("superadmin" in sysEntry));
assert.ok(!dump(auditMember).includes(SA_ID) && !dump(auditMember).includes(SA_NAME));
assert.ok(auditMember.some((e) => e.uid === anna.id), "Einträge der Mitglieder bleiben");
assert.equal(ok(await api("GET", "/audit", { token: ben.token, query: { uid: SA_ID } })).entries.length, 0, "Filter auf die Kennung des Superadmins findet nichts");
assert.ok(ok(await api("GET", "/audit", { ...asSuper, query: { uid: SA_ID } })).entries.length > 0);

// ---- Darstellung (Logo/Farbe): Autor «System»
ok(await api("PUT", "/branding", { ...asSuper, body: { color: "#118833" } }));
assert.equal(ok(await api("GET", "/branding", { token: ben.token })).branding.updatedBy, "System");
assert.equal(ok(await api("GET", "/branding", asSuper)).branding.updatedBy, saStamp);

// ---- Chat
env = { ...baseEnv, ...vapid, RESEND_API_KEY: "re_test", MAIL_FROM: "CRM <crm@example.org>", APP_URL: "https://crm.example.org/" };
const sub = (id) => ({ endpoint: `https://fcm.googleapis.com/send/${id}`, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });
ok(await api("POST", "/push/subscribe", { token: ben.token, body: { subscription: sub("ben1") } }));
assert.equal((await api("POST", "/push/subscribe", { ...asSuper, body: { subscription: sub("sa1") } })).status, 404, "der Superadmin hat kein Push-Abo");
ok(await api("POST", "/chat", { token: anna.token, body: { text: "Hallo Team" } }), 201);
pushed.length = 0; mails.length = 0;
const saMsg = ok(await api("POST", "/chat", { ...asSuper, body: { text: "Support-Hinweis" } }), 201).message;
assert.equal(saMsg.name, SA_NAME, "der Superadmin sieht seinen Namen");
assert.equal(saMsg.sa, true);
assert.deepEqual(pushed.map((p) => p.endpoint), ["https://fcm.googleapis.com/send/ben1"], "Push nur an Mitglieder");
assert.equal(pushed[0].payload.title, "Administrator");
assert.ok(!dump(pushed).includes(SA_NAME));
const chatMember = ok(await api("GET", "/chat", { token: ben.token })).messages;
const seen = chatMember.find((m) => m.id === saMsg.id);
assert.equal(seen.name, "Administrator");
assert.equal(seen.uid, "");
assert.equal(seen.sa, true);
assert.ok(!dump(chatMember).includes(SA_NAME) && !dump(chatMember).includes(SA_ID));
assert.equal(ok(await api("GET", "/chat", { token: ben.token, query: { since: String(saMsg.id - 1) } })).messages[0].name, "Administrator", "auch bei since=");
assert.equal(ok(await api("GET", "/chat", asSuper)).messages.find((m) => m.id === saMsg.id).name, SA_NAME);
// E-Mail-Ersatz ohne Push-Abo: Betreff/Text nennen «Administrator»
ok(await api("POST", "/push/unsubscribe", { token: ben.token, body: { endpoint: sub("ben1").endpoint } }));
clock += 40 * 60000;
mails.length = 0;
ok(await api("POST", "/chat", { ...asSuper, body: { text: "Noch ein Hinweis" } }), 201);
assert.deepEqual(mails.map((m) => m.body.to[0]).sort(), ["anna@example.org", "ben@example.org"], "E-Mail nur an Mitglieder");
assert.ok(mails.every((m) => m.body.subject.includes("Administrator") && !dump(m.body).includes(SA_NAME)));

// ---- Kalender
const H = 3600000;
const newEv = (o = {}) => ({ title: "Besprechung", start: new Date(clock + 5 * H).toISOString(), end: new Date(clock + 6 * H).toISOString(), ...o });
const ev = ok(await api("POST", "/calendar/events", { ...asSuper, body: newEv() }), 201).event;
assert.equal(ev.createdBy.name, saStamp, "Superadmin sieht sich als Ersteller");
const range = { from: new Date(clock - 24 * H).toISOString(), to: new Date(clock + 7 * 24 * H).toISOString() };
const calMember = ok(await api("GET", "/calendar", { token: ben.token, query: range }));
assert.deepEqual(calMember.members.map((m) => m.id).sort(), [anna.id, ben.id].sort(), "Teilnehmerauswahl ohne Superadmin");
assert.equal(calMember.events.find((e) => e.id === ev.id).createdBy.name, "System");
assert.equal(calMember.events.find((e) => e.id === ev.id).updatedBy.id, "");
assert.ok(!dump(calMember).includes(SA_ID) && !dump(calMember).includes("Superadmin"));
assert.equal(ok(await api("GET", `/calendar/events/${ev.id}`, { token: ben.token })).event.createdBy.name, "System");
assert.equal(ok(await api("GET", `/calendar/events/${ev.id}`, asSuper)).event.createdBy.name, saStamp);
const upd = ok(await api("PUT", `/calendar/events/${ev.id}`, { token: ben.token, body: { ...newEv({ title: "Besprechung 2" }), rev: ev.rev } })).event;
assert.equal(upd.createdBy.name, "System");
assert.equal(upd.updatedBy.name, "BEN");
const stale = await api("PUT", `/calendar/events/${ev.id}`, { token: anna.token, body: { ...newEv(), rev: ev.rev } });
assert.equal(stale.status, 409);
assert.ok(!dump(stale.body).includes("Superadmin"));
const bad = await api("POST", "/calendar/events", { token: ben.token, body: newEv({ participants: [SA_ID] }) });
assert.equal(bad.status, 400, "der Superadmin lässt sich nicht als Teilnehmer wählen");
assert.equal(ok(await api("GET", "/calendar", { ...asSuper, query: range })).members.some((m) => m.id === SA_ID), false, "auch für ihn selbst keine Auswahl seiner Person");

console.log("Superadmin-Unsichtbarkeit: alle Prüfungen bestanden");
