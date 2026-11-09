#!/usr/bin/env node
// Prüft Datei-API (/api/files), Chat-Anhänge und Zertifikats-Hinweise gegen den In-Memory-Store (ohne Netzwerk) – Aufruf: node scripts/test-files.mjs  (npm run test:files)
import assert from "node:assert/strict";
import { handleApi, createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { MAX_FILE_BYTES, sniffType, safeFilename, contentDisposition } from "../netlify/functions/lib/files.mjs";
import { dueAlerts, runCertAlerts, SENT_KEY } from "../netlify/functions/lib/cert-alerts.mjs";
import { addMonths, proposeDue, renewDoc, certAlerts, certSummary, activeDocs, archivedDocs } from "../js/certs.js";
import { withSessionToken } from "./lib/session-token.mjs";

const store = createMemoryStore();
const baseEnv = { CRM_SECRET: "x".repeat(32), CRM_PASSWORD: "Start-Passwort-123", CRM_ADMIN_USER: "root" };
const vapid = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "c".repeat(43), VAPID_SUBJECT: "mailto:admin@example.org" };
let clock = Date.parse("2026-11-07T08:00:00Z");
const pushed = [];
const mails = [];
const webpush = { async sendNotification(sub, payload) { pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); } };
const fetchMock = async (url, init) => { mails.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
let env = { ...baseEnv };
const deps = () => ({ env, store, now: () => clock, delay: async () => {}, scryptParams: { N: 1024 }, userCacheMs: 0, fetch: fetchMock, webpush });

async function rawApi(method, path, { token, team, body, query, bytes } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(team ? { "x-crm-team": team } : {}), ...(bytes ? { "content-type": "application/octet-stream" } : {}) };
  return handleApi({ method, path: "/api" + path, query: new URLSearchParams(query || {}), headers, bodyText: body === undefined ? "" : JSON.stringify(body), ...(bytes ? { bodyBuffer: bytes } : {}) }, deps());
}
// Sitzungs-Token kommt nur noch per Set-Cookie (nicht im Body): für Bearer-Aufrufe der Tests aus dem Cookie übernehmen
const api = async (method, path, opts) => { const r = await rawApi(method, path, opts); return /^\/(login|me\/password)$/.test(path) ? withSessionToken(r) : r; };
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("x".repeat(200))]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(32)]);

// ---- reine Hilfen
assert.equal(sniffType(PDF), "application/pdf");
assert.equal(sniffType(PNG), "image/png");
assert.equal(sniffType(JPG), "image/jpeg");
assert.equal(sniffType(WEBP), "image/webp");
assert.equal(sniffType(Buffer.from("<html><script>alert(1)</script></html>")), null, "HTML ist kein erlaubter Typ");
assert.equal(sniffType(Buffer.from("MZ\x90\x00this is an exe, not allowed")), null);
assert.equal(safeFilename("../../etc/pass\"wd\r\n.pdf", "application/pdf"), "passwd.pdf", "kein Pfad, keine Anführungszeichen/Zeilenumbrüche");
assert.equal(safeFilename("zertifikat.exe", "application/pdf"), "zertifikat.pdf", "Endung folgt dem erkannten Typ");
assert.equal(safeFilename("Foto.JPEG", "image/jpeg"), "Foto.jpeg");
assert.equal(safeFilename("", "image/png"), "datei.png");
assert.equal(safeFilename(".htaccess", "image/png"), "htaccess.png");
const cd = contentDisposition('Prüfbericht "ISO"\r\nX: 1.pdf');
assert.ok(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/.test(cd), cd);
assert.ok(!/[\r\n]/.test(cd));

// ---- Browser-Logik der Dokumente (js/certs.js)
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
assert.equal(addMonths("2026-11-07", 36), "2029-11-07");
assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
assert.equal(addMonths("kaputt", 1), "");
assert.equal(proposeDue("2026-05-01", 6), "2026-11-01");
assert.equal(proposeDue("2026-05-01", ""), "", "ohne Intervall kein Vorschlag");
{
  const old = { id: "a", typ: "iso9001", name: "ISO 9001", gueltigBis: "2026-12-01", intervall: 12, link: "https://x.example/a" };
  const { archived, fresh } = renewDoc(old, { gueltigBis: "2027-12-01", ausgestelltAm: "2026-11-07" }, { today: "2026-11-07", id: "b" });
  assert.equal(archived.archiviert, true);
  assert.equal(archived.archiviertAm, "2026-11-07");
  assert.equal(archived.id, "a");
  assert.deepEqual({ id: fresh.id, typ: fresh.typ, name: fresh.name, intervall: fresh.intervall, erneuertVon: fresh.erneuertVon, archiviert: fresh.archiviert, link: fresh.link }, { id: "b", typ: "iso9001", name: "ISO 9001", intervall: 12, erneuertVon: "a", archiviert: undefined, link: "" });
  const s = { id: "s", firma: "S", dokumente: [fresh, archived, { id: "c", gueltigBis: "2026-11-20" }] };
  assert.equal(activeDocs(s).length, 2);
  assert.equal(archivedDocs(s).length, 1);
  assert.deepEqual(certSummary(s, "2026-11-07"), { expired: 0, soon: 1 }, "archivierte Dokumente zählen nicht");
  assert.deepEqual(certAlerts([s, { id: "t", firma: "T", dokumente: [{ id: "x", gueltigBis: "2026-11-01" }, { id: "y", gueltigBis: "2030-01-01" }] }], "2026-11-07").map((a) => [a.doc.id, a.state]), [["x", "expired"], ["c", "soon"]], "Warnliste: dringendste zuerst, ohne archivierte");
}

// ---- Konten: Superadmin, zwei Teams
const su = ok(await api("POST", "/login", { body: { username: "root", password: baseEnv.CRM_PASSWORD } }));
const PW = "Ein-langes-Passwort-1";
const sa = ok(await api("POST", "/me/password", { token: su.token, body: { current: baseEnv.CRM_PASSWORD, new: PW } })).token;
const mkTeam = async (name) => ok(await api("POST", "/teams", { token: sa, body: { name } }), 201).team;
const mkUser = async (team, username, extra = {}) => {
  const c = ok(await api("POST", "/users", { token: sa, body: { username, displayName: username.toUpperCase(), role: "member", teamId: team.id, ...extra } }), 201);
  const l = ok(await api("POST", "/login", { body: { username, password: c.temporaryPassword } }));
  const p = ok(await api("POST", "/me/password", { token: l.token, body: { current: c.temporaryPassword, new: PW } }));
  return { id: c.user.id, token: p.token, user: c.user };
};
const teamA = await mkTeam("Team Alpha");
const teamB = await mkTeam("Team Beta");
const adm = await mkUser(teamA, "adam", { role: "admin", email: "adam@example.org" });
const mgr = await mkUser(teamA, "mara", { management: true, email: "mara@example.org" });
const mem = await mkUser(teamA, "ben", { email: "ben@example.org" });
const mem2 = await mkUser(teamA, "cleo");
const dora = await mkUser(teamB, "dora", { role: "admin" });

// ---- Hochladen
assert.equal((await api("POST", "/files", { bytes: PDF })).status, 401, "ohne Anmeldung nichts");
assert.equal((await api("POST", "/files", { token: sa, bytes: PDF })).status, 409, "Superadmin ohne Team");
const up = ok(await api("POST", "/files", { token: mem.token, query: { name: "ISO 9001.pdf" }, bytes: PDF }), 201).file;
assert.match(up.id, /^f_[0-9a-f]{20}$/);
assert.deepEqual({ ...up, id: "x" }, { id: "x", name: "ISO 9001.pdf", type: "application/pdf", size: PDF.length, scope: "team" });
ok(await api("POST", "/files", { token: mem.token, query: { name: "a.png" }, bytes: PNG }), 201);
ok(await api("POST", "/files", { token: mem.token, query: { name: "a.jpg" }, bytes: JPG }), 201);
ok(await api("POST", "/files", { token: mem.token, query: { name: "a.webp" }, bytes: WEBP }), 201);
assert.equal((await api("POST", "/files", { token: mem.token, query: { name: "x.pdf" }, bytes: Buffer.from("<html>hello world, not a pdf</html>") })).status, 415, "Typ wird an den Bytes erkannt");
assert.equal((await api("POST", "/files", { token: mem.token, bytes: Buffer.alloc(0) })).status, 400);
const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(MAX_FILE_BYTES)]);
assert.equal((await api("POST", "/files", { token: mem.token, bytes: big })).status, 413, "über 10 MB");
const exactly = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(MAX_FILE_BYTES - 9)]);
ok(await api("POST", "/files", { token: mem.token, query: { name: "gross.pdf" }, bytes: exactly }), 201);
assert.equal((await api("POST", "/files", { token: mem.token, query: { scope: "geheim" }, bytes: PDF })).status, 400);

// ---- Herunterladen
const dl = await api("GET", `/files/${up.id}`, { token: mem2.token });
assert.equal(dl.status, 200);
assert.deepEqual(dl.binary, PDF);
assert.equal(dl.contentType, "application/pdf");
assert.equal(dl.filename, "ISO 9001.pdf");
assert.equal(ok(await api("GET", `/files/${up.id}`, { token: mem.token, query: { meta: "1" } })).file.name, "ISO 9001.pdf");
assert.equal((await api("GET", `/files/${up.id}`)).status, 401);
assert.equal((await api("GET", "/files/f_00000000000000000000", { token: mem.token })).status, 404);
assert.equal((await api("GET", "/files/..%2F..%2Fdb", { token: mem.token })).status, 404);

// ---- Team-Trennung: Team Beta kommt weder lesend noch löschend an Dateien von Team Alpha
assert.equal((await api("GET", `/files/${up.id}`, { token: dora.token })).status, 404, "fremdes Team: nicht gefunden");
assert.equal((await api("GET", `/files/${up.id}`, { token: dora.token, team: teamA.id })).status, 404, "Team-Header wirkt nur für den Superadmin");
assert.equal((await api("DELETE", `/files/${up.id}`, { token: dora.token })).status, 404);
assert.ok(store.bins.has(`t/${teamA.id}/fbin/${up.id}`), "Datei liegt im Namensraum von Team Alpha");
assert.ok([...store.bins.keys()].every((k) => k.startsWith("t/")), "keine Datei ausserhalb eines Team-Namensraums");
assert.equal((await api("GET", `/files/${up.id}`, { token: sa })).status, 409, "Superadmin ohne betretenes Team");
assert.equal((await api("GET", `/files/${up.id}`, { token: sa, team: teamA.id })).status, 200, "Superadmin im betretenen Team (Support)");
const upB = ok(await api("POST", "/files", { token: dora.token, query: { name: "b.pdf" }, bytes: PDF }), 201).file;
assert.equal((await api("GET", `/files/${upB.id}`, { token: mem.token })).status, 404, "umgekehrt ebenso");

// ---- Bereich «Geschäftsleitung»
assert.equal((await api("POST", "/files", { token: mem.token, query: { scope: "mgmt", name: "gl.pdf" }, bytes: PDF })).status, 403, "Mitglied darf nichts in den GL-Bereich laden");
const gl = ok(await api("POST", "/files", { token: mgr.token, query: { scope: "mgmt", name: "gl.pdf" }, bytes: PDF }), 201).file;
assert.equal(gl.scope, "mgmt");
assert.equal((await api("GET", `/files/${gl.id}`, { token: mem.token })).status, 403, "Mitglied: GL-Datei nicht herunterladbar");
assert.equal((await api("GET", `/files/${gl.id}`, { token: mem.token, query: { meta: "1" } })).status, 403);
assert.equal((await api("DELETE", `/files/${gl.id}`, { token: mem.token })).status, 403);
assert.equal((await api("GET", `/files/${gl.id}`, { token: adm.token })).status, 200, "Team-Admin darf");
assert.equal((await api("GET", `/files/${gl.id}`, { token: mgr.token })).status, 200, "Management-Kennzeichen darf");
assert.equal((await api("GET", `/files/${gl.id}`, { token: dora.token })).status, 404);

// ---- Löschen: Hochladender oder Admin
assert.equal((await api("DELETE", `/files/${up.id}`, { token: mem2.token })).status, 403, "fremde Datei: nur Hochladender oder Admin");
ok(await api("DELETE", `/files/${up.id}`, { token: adm.token }));
assert.equal((await api("GET", `/files/${up.id}`, { token: mem.token })).status, 404);
assert.ok(!store.bins.has(`t/${teamA.id}/fbin/${up.id}`));

// ---- Chat-Anhänge
const f1 = ok(await api("POST", "/files", { token: mem.token, query: { name: "Skizze.png" }, bytes: PNG }), 201).file;
const m1 = ok(await api("POST", "/chat", { token: mem.token, body: { text: "", file: f1.id } }), 201).message;
assert.deepEqual(m1.file, { id: f1.id, name: "Skizze.png", type: "image/png", size: PNG.length, scope: "team" });
assert.equal(m1.text, "");
assert.deepEqual(ok(await api("GET", "/chat", { token: mem2.token })).messages[0].file, m1.file, "andere sehen den Anhang");
assert.equal((await api("POST", "/chat", { token: mem.token, body: { text: "" } })).status, 400, "ohne Text und ohne Datei bleibt es leer");
assert.equal((await api("POST", "/chat", { token: mem2.token, body: { text: "mein", file: f1.id } })).status, 400, "fremde Datei nicht anhängbar");
assert.equal((await api("POST", "/chat", { token: mem.token, body: { text: "x", file: "f_unbekannt" } })).status, 400);
assert.equal((await api("POST", "/chat", { token: mem.token, body: { text: "x", file: f1.id, channel: "mgmt" } })).status, 403, "Mitglied: Kanal GL gesperrt");
assert.equal((await api("POST", "/chat", { token: mgr.token, body: { text: "x", file: gl.id } })).status, 400, "GL-Datei gehört nicht in den Kanal «Ganzes Team»");
const f2 = ok(await api("POST", "/files", { token: mgr.token, query: { name: "t.pdf" }, bytes: PDF }), 201).file;
assert.equal((await api("POST", "/chat", { token: mgr.token, body: { text: "x", file: f2.id, channel: "mgmt" } })).status, 400, "Team-Datei gehört nicht in den Kanal «Geschäftsleitung»");
const gm = ok(await api("POST", "/chat", { token: mgr.token, body: { text: "Vertrag", file: gl.id, channel: "mgmt" } }), 201).message;
assert.equal(gm.file.id, gl.id);
assert.equal((await api("GET", "/chat", { token: mem.token, query: { channel: "mgmt" } })).status, 403, "Mitglied sieht den GL-Kanal nicht");
assert.equal((await api("GET", `/files/${gl.id}`, { token: mem.token })).status, 403, "Mitglied kommt auch mit bekannter ID nicht an die GL-Datei");
assert.equal((await api("GET", `/files/${gl.id}`, { token: adm.token })).status, 200);
assert.equal(ok(await api("GET", "/chat", { token: adm.token, query: { channel: "mgmt" } })).messages[0].file.name, "gl.pdf");
assert.ok(JSON.stringify(ok(await api("GET", "/chat", { token: mem.token }))).indexOf(gl.id) < 0, "GL-Datei taucht im Teamkanal nirgends auf");

// ---- Zertifikats-Hinweise: Fälligkeit je Stufe
const TODAY = "2026-11-07";
const day = (n) => new Date(Date.parse(TODAY + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const mkDoc = (id, n, extra = {}) => ({ id, name: "ISO " + id, typ: "iso9001", gueltigBis: day(n), ...extra });
const db0 = { schema: 1, suppliers: [{ id: "s1", firma: "Alpha GmbH", dokumente: [mkDoc("d61", 61), mkDoc("d60", 60), mkDoc("d45", 45), mkDoc("d30", 30), mkDoc("d8", 8), mkDoc("d7", 7), mkDoc("d1", 1), mkDoc("d0", 0), mkDoc("dm5", -5), mkDoc("arch", -9, { archiviert: true }), { id: "nodate", name: "Katalog" }, mkDoc("d20", 20)] }, { id: "s2", firma: "Beta", dokumente: "kaputt" }] };
const lv = Object.fromEntries(dueAlerts(db0, TODAY).map((a) => [a.docId, a.level]));
assert.deepEqual(lv, { d60: 60, d45: 60, d30: 30, d20: 30, d8: 30, d7: 7, d1: 7, d0: 0, dm5: 0 }, "kleinste erreichte Stufe; archivierte/undatierte/zu ferne Dokumente nie");

// ---- Doppelversand ausgeschlossen
const putDb = async (data) => { // direkt in den Speicher des Teams (die Sitzungen laufen bei den Zeitsprüngen unten ab)
  const cur = await store.read(`t/${teamA.id}/db`);
  await store.write(`t/${teamA.id}/db`, { version: (cur?.value.version ?? 0) + 1, data, savedAt: new Date(clock).toISOString(), savedBy: "test" });
};
await putDb({ schema: 1, suppliers: [{ id: "s1", firma: "Alpha GmbH", dokumente: [mkDoc("d45", 45), mkDoc("d7", 7), mkDoc("dm5", -5), mkDoc("far", 200), mkDoc("arch", -9, { archiviert: true })] }] });
const run = () => runCertAlerts({ env, store, now: () => clock, fetch: fetchMock, webpush });
// 1) ohne Versandweg: nichts, auch kein Vermerk
env = { ...baseEnv };
assert.deepEqual(await run(), { teams: 0, due: 0, sent: 0 });
assert.equal(await store.read(`t/${teamA.id}/${SENT_KEY}`), null, "ohne Versandweg kein Vermerk");
// 2) mit Push-Abo des Admins und E-Mail für Management/Mitglied
env = { ...baseEnv, ...vapid, RESEND_API_KEY: "re_x", MAIL_FROM: "CRM <crm@example.org>" };
ok(await api("POST", "/push/subscribe", { token: adm.token, body: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } } } }));
const r1 = await run();
assert.equal(r1.teams, 1);
assert.equal(r1.due, 3, "d45 (60), d7 (7), dm5 (abgelaufen)");
assert.equal(pushed.length, 1, "Push an den Admin (ein Sammelhinweis)");
assert.equal(pushed[0].payload.t, "cert");
assert.match(pushed[0].payload.title, /1 abgelaufen/);
assert.deepEqual(mails.map((m) => m.to[0]).sort(), ["mara@example.org"], "Management ohne Push-Abo bekommt eine Mail; Mitglieder (ben) und Team Beta nicht");
assert.match(mails[0].text, /Alpha GmbH: ISO d45/);
assert.match(mails[0].text, /abgelaufen am/);
const sent1 = (await store.read(`t/${teamA.id}/${SENT_KEY}`)).value.sent;
assert.deepEqual(Object.keys(sent1).sort(), [`d45|${day(45)}|60`, `d7|${day(7)}|7`, `dm5|${day(-5)}|0`].sort());
// 3) gleicher Tag, zweiter Lauf: nichts mehr
pushed.length = 0; mails.length = 0;
assert.equal((await run()).due, 0);
// 4) Folgetag, gleiche Stufen: nicht erneut
clock += 86400000;
assert.equal((await run()).due, 0, "gleiche Stufe an Folgetagen: nicht erneut");
// Stufenwechsel (d45 -> 30 Tage, d7 -> abgelaufen) bei zwei gleichzeitigen Läufen: genau eine Zustellung je Person
clock = Date.parse("2026-11-07T08:00:00Z") + 15 * 86400000;
const [ra, rb] = await Promise.all([run(), run()]);
assert.equal(pushed.length, 1, "parallele Läufe: genau eine Push-Zustellung");
assert.equal(mails.length, 1, "und genau eine Mail");
assert.equal(ra.due + rb.due >= 2, true);
const sent2 = Object.keys((await store.read(`t/${teamA.id}/${SENT_KEY}`)).value.sent);
assert.ok(sent2.includes(`d45|${day(45)}|30`) && sent2.includes(`d7|${day(7)}|0`), sent2.join());
pushed.length = 0; mails.length = 0;
assert.equal((await run()).due, 0);
// 5) Erneuerung: neues Datum löst neu aus, die archivierte Zeile nie; veraltete Vermerke werden entfernt
const cur = (await store.read(`t/${teamA.id}/db`)).value;
await putDb({ ...cur.data, suppliers: [{ id: "s1", firma: "Alpha GmbH", dokumente: [{ ...mkDoc("dm5", -5), archiviert: true }, mkDoc("dm5b", 365), mkDoc("d45", 45), mkDoc("d7", 7, { archiviert: true })] }] });
assert.equal((await run()).due, 0, "neue Gültigkeit 365 Tage: noch kein Hinweis; Archiv ohne Hinweis");
const sent3 = Object.keys((await store.read(`t/${teamA.id}/${SENT_KEY}`)).value.sent);
assert.deepEqual(sent3.sort(), [`d45|${day(45)}|30`, `d45|${day(45)}|60`].sort(), "Vermerke archivierter/entfernter Dokumente aufgeräumt");
// 6) Zustellung scheitert für alle: Vermerk wird zurückgenommen (nächster Lauf versucht es erneut)
const failFetch = async () => ({ ok: false, status: 500 });
const failPush = { async sendNotification() { throw Object.assign(new Error("boom"), { statusCode: 500 }); } };
await putDb({ ...cur.data, suppliers: [{ id: "s1", firma: "Alpha GmbH", dokumente: [mkDoc("z", -1)] }] });
const origErr = console.error; console.error = () => {}; // erwartete Fehlermeldungen nicht ausgeben
const bad = await runCertAlerts({ env, store, now: () => clock, fetch: failFetch, webpush: failPush });
console.error = origErr;
assert.equal(bad.sent, 0);
assert.equal(Object.keys((await store.read(`t/${teamA.id}/${SENT_KEY}`)).value.sent).length, 0, "Vermerk zurückgenommen");
const again = await run();
assert.equal(again.due, 1);
assert.ok(again.sent >= 1, "zweiter Versuch liefert");

console.log("test-files: OK");
