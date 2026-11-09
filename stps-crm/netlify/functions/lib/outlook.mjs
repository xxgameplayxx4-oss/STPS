// STPS CRM – Outlook-Kalender je Benutzer: Jeder Benutzer verbindet seinen EIGENEN Outlook-Kalender (delegierte Microsoft-Anmeldung, siehe
// outlook-graph.mjs). Termine aus Outlook erscheinen im Team-Kalender (Quelle «outlook», nur lesbar); optional werden im CRM angelegte Termine
// nach Outlook geschrieben (Richtung «both»). Strikt je Team: alles liegt im Namensraum des Teams (scopedStore), nie global.
//
// Speicherung im Blob-Store des Teams:
//   cal/ol/conn/<uid>     Verbindung: Konto, Richtung, Status, verschlüsseltes Refresh-Token (AES-256-GCM, Schlüssel aus CRM_SECRET), Sync-Status
//   cal/ol/delta/<uid>    Delta-Stand (deltaLink / nextLink, Zeitfenster, Generation)
//   cal/ol/ev/<uid>       aus Outlook importierte Termine dieses Benutzers
//   cal/ol/del/<uid>      in Outlook noch zu löschende Termine (Löschen im CRM, Outlook war nicht erreichbar)
//   cal/ol/lock/<uid>     Sperre gegen gleichzeitige Läufe
//   cal/ol/pending/<n>    laufende Anmeldung (PKCE-Verifier, einmalig, 10 Minuten)
//
// Schleifen-Schutz: Von uns geschriebene Outlook-Termine tragen die Kategorie «STPS CRM» und im CRM-Termin steht outlook.{userId,outlookId,etag}.
// Ein Delta-Eintrag mit unverändertem eTag wird ignoriert; Änderungen aus Outlook an einem verknüpften CRM-Termin werden direkt im Termin-Dokument
// übernommen (nie über die Route, daher kein Zurückschreiben). Bei Konflikten gewinnt der spätere Zeitstempel (lastModified).
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mutateDoc } from "./kv.mjs";
import { ApiFail, json, fail, parseBody, queryOf, logError } from "./http.mjs";
import { loadTeams, scopedStore } from "./teams.mjs";
import * as U from "./users.mjs";
import { GraphError } from "./graph.mjs";
import * as G from "./outlook-graph.mjs";

export const EVENTS_KEY = "cal/events"; // wie in calendar.mjs (hier nicht importiert: calendar.mjs importiert dieses Modul)
export const MARKER = "STPS CRM";
export const DEFAULT_TZ = "Europe/Zurich";
export const WINDOW_BACK_DAYS = 30;
export const WINDOW_AHEAD_DAYS = 365;
export const FULL_RESYNC_MS = 7 * 24 * 3600 * 1000;
export const MAX_IMPORTED = 3000;
export const MAX_PAGES = 200;
export const DEFAULT_BUDGET_MS = 20000;
export const DIRECTIONS = ["in", "both"];
const LOCK_MS = 2 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
const DAY = 86400000;
const HOUR = 3600000;
const UID_RE = /^u_[0-9a-f]{16}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const SELECT = "id,iCalUId,subject,start,end,isAllDay,isCancelled,location,bodyPreview,sensitivity,type,seriesMasterId,lastModifiedDateTime,webLink,categories";

const uidOf = (uid) => { if (!UID_RE.test(String(uid))) throw new Error("Ungültige Benutzer-ID"); return uid; };
export const connKey = (uid) => `cal/ol/conn/${uidOf(uid)}`;
const deltaKey = (uid) => `cal/ol/delta/${uidOf(uid)}`;
const evKey = (uid) => `cal/ol/ev/${uidOf(uid)}`;
const delKey = (uid) => `cal/ol/del/${uidOf(uid)}`;
const lockKey = (uid) => `cal/ol/lock/${uidOf(uid)}`;
const pendKey = (n) => { if (!NONCE_RE.test(n)) throw new Error("Ungültiger Wert"); return `cal/ol/pending/${n}`; };

const tnow = (deps) => (typeof deps.now === "function" ? deps.now() : deps.now ?? Date.now());
const envOf = (deps) => deps.rootEnv ?? deps.env;
const b64u = (b) => Buffer.from(b).toString("base64url");
const sha12 = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const enc = encodeURIComponent;

// ---------------------------------------------------------------- Verschlüsselung und Anmelde-Status

function derive(env, info) {
  const s = String(env?.CRM_SECRET ?? "");
  if (s.length < 16) throw new GraphError("CRM_SECRET fehlt", { kind: "config" });
  return Buffer.from(hkdfSync("sha256", s, "stps-crm/outlook", info, 32));
}

/** AES-256-GCM; aad bindet den Text an Team und Benutzer (ein kopierter Eintrag lässt sich nicht für einen anderen Benutzer verwenden). */
export function encryptToken(env, plain, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(env, "token-v1"), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return "v1." + b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}

export function decryptToken(env, value, aad) {
  const parts = String(value).split(".");
  if (parts.length !== 2 || parts[0] !== "v1") throw new GraphError("Gespeichertes Token ungültig", { kind: "revoked" });
  const buf = Buffer.from(parts[1], "base64url");
  try {
    const d = createDecipheriv("aes-256-gcm", derive(env, "token-v1"), buf.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof GraphError) throw e;
    throw new GraphError("Gespeichertes Token nicht lesbar (CRM_SECRET geändert?) – bitte Outlook erneut verbinden.", { kind: "revoked" });
  }
}

// ---------------------------------------------------------------- Einrichtung (Umgebung + Plattform-Einstellung)

export const SETTING_KEY = "platform/outlook"; // Wurzel-Speicher (nicht je Team): vom Superadmin eingetragene App-ID
const rootOf = (deps) => deps.rootStore ?? deps.store;
const settingCache = new WeakMap(); // Wurzel-Speicher -> { at, v } (kurz, spart Lesezugriffe pro Kalender-Anfrage)

export async function loadSetting(root) {
  const hit = settingCache.get(root);
  if (hit && Date.now() - hit.at < 5000) return hit.v;
  let v = null;
  try {
    const d = (await root.read(SETTING_KEY))?.value;
    if (d && typeof d === "object") v = d;
  } catch { /* Speicher nicht lesbar: wie «nicht eingetragen» */ }
  settingCache.set(root, { at: Date.now(), v });
  return v;
}

const hdr = (req, n) => {
  const h = req?.headers;
  const v = !h ? "" : typeof h.get === "function" ? h.get(n) : h[n];
  return String(v ?? "").split(",")[0].trim();
};
/** Adresse, unter der der Browser die App erreicht (für die Rückleit-Adresse): von der Plattform gesetzt, sonst aus den Kopfzeilen. */
export function originOf(req) {
  if (typeof req?.origin === "string" && /^(https:\/\/[^\s/]+|http:\/\/localhost(:\d+)?)$/.test(req.origin)) return req.origin;
  const host = hdr(req, "x-forwarded-host") || hdr(req, "host");
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return "";
  return /^localhost(:\d+)?$/.test(host) ? `${hdr(req, "x-forwarded-proto") === "https" ? "https" : "http"}://${host}` : `https://${host}`;
}

/** Wirksame Einrichtung: Umgebung vor Plattform-Einstellung. `req` nur nötig, wenn die Rückleit-Adresse gebraucht wird (Anmelden). */
export async function cfgOf(deps, req) {
  return G.outlookConfig(envOf(deps), { setting: await loadSetting(rootOf(deps)), origin: originOf(req) });
}

const aadOf = (teamId, uid) => `${teamId}|${uid}`;

function signState(env, p) {
  const body = b64u(JSON.stringify(p));
  return `${body}.${createHmac("sha256", derive(env, "state-v1")).update(body).digest("base64url")}`;
}

function verifyState(env, s, now) {
  if (typeof s !== "string" || s.length > 600) return null;
  const [body, sig, extra] = s.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(createHmac("sha256", derive(env, "state-v1")).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!UID_RE.test(p.u) || !NONCE_RE.test(p.n) || typeof p.t !== "string" || typeof p.e !== "number" || p.e <= now) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Verbindung

const readConn = async (store, uid) => (await store.read(connKey(uid)))?.value ?? null;

async function patchConn(store, uid, patch) {
  await mutateDoc(store, connKey(uid), (doc) => (doc ? { ...doc, ...patch } : undefined));
}

/** Was der Benutzer über seine Verbindung sieht (nie das Token). */
export const publicConn = (c) =>
  c ? { account: c.account || null, direction: c.direction, status: c.status, connectedAt: c.connectedAt || null, lastSync: c.lastSync || null, lastOkAt: c.lastOkAt || null, error: c.error || null, count: c.count ?? 0 } : null;

const accessCache = new Map(); // "<team>|<uid>" -> { token, exp, enc }
export const clearOutlookCache = () => accessCache.clear();

async function markRevoked(store, uid, err, now) {
  await patchConn(store, uid, { status: "revoked", tokenEnc: undefined, error: { kind: "revoked", code: err.code || "", message: err.message, at: new Date(now).toISOString() } });
}

/** Zugriffstoken des Benutzers (aus dem Refresh-Token, kurz zwischengespeichert). Markiert die Verbindung als widerrufen, wenn Microsoft das Token ablehnt. */
async function getAccess(deps, store, uid) {
  const env = envOf(deps);
  const cfg = await cfgOf(deps);
  if (!cfg.configured) throw new GraphError(`Outlook ist nicht eingerichtet – es fehlen: ${cfg.missing.join(", ")}`, { kind: "config" });
  const conn = await readConn(store, uid);
  if (!conn || conn.status !== "connected" || !conn.tokenEnc) throw new GraphError("Outlook ist nicht verbunden – bitte erneut verbinden.", { kind: "revoked" });
  const now = tnow(deps);
  const ck = `${store.teamId}|${uid}`;
  const hit = accessCache.get(ck);
  if (hit && hit.enc === conn.tokenEnc && hit.exp - 2 * 60000 > now) return hit.token;
  try {
    const refresh = decryptToken(env, conn.tokenEnc, aadOf(store.teamId, uid));
    const tok = await G.refreshAccess(cfg, refresh, deps);
    let tokenEnc = conn.tokenEnc;
    if (tok.refreshToken && tok.refreshToken !== refresh) {
      tokenEnc = encryptToken(env, tok.refreshToken, aadOf(store.teamId, uid));
      await patchConn(store, uid, { tokenEnc });
    }
    accessCache.set(ck, { token: tok.accessToken, exp: now + tok.expiresIn * 1000, enc: tokenEnc });
    return tok.accessToken;
  } catch (err) {
    if (err instanceof GraphError && err.kind === "revoked") {
      accessCache.delete(ck);
      await markRevoked(store, uid, err, now);
    }
    throw err;
  }
}

// ---------------------------------------------------------------- Graph-Termin ⇄ CRM-Termin

const cleanLine = (v, max) => String(v ?? "").replace(/[\t\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNotes = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
const httpsOnly = (u) => (typeof u === "string" && /^https:\/\//i.test(u) && u.length < 2000 ? u : "");
const addDaysStr = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const graphMs = (o) => Date.parse(String(o?.dateTime ?? "").split(".")[0] + "Z"); // mit «Prefer: outlook.timezone="UTC"» angefordert

/** Zeiten eines Graph-Termins im CRM-Format: {allDay, start, end} (ganztägig: Datum, Ende einschliesslich) oder null */
function timesOf(item) {
  const s = graphMs(item.start), e = graphMs(item.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  if (item.isAllDay === true) {
    const day = (ms) => new Date(ms + 12 * HOUR).toISOString().slice(0, 10); // robust gegen Verschiebung um die Zeitzone
    const start = day(s);
    const endEx = day(e);
    return { allDay: true, start, end: endEx > start ? addDaysStr(endEx, -1) : start };
  }
  return { allDay: false, start: new Date(s).toISOString(), end: new Date(Math.max(e, s)).toISOString() };
}

/** Graph-Termin → importierter CRM-Termin */
export function toImported(item, uid, gen) {
  const times = item?.id ? timesOf(item) : null;
  if (!times) return null;
  const sens = String(item.sensitivity || "normal");
  return {
    id: "ev_" + sha12(`${uid}|${item.id}`), source: "outlook", ownerId: uid, outlookId: item.id, iCalUId: String(item.iCalUId || ""), etag: String(item["@odata.etag"] || ""),
    seriesMasterId: String(item.seriesMasterId || ""), title: cleanLine(item.subject, 120), ...times, tz: DEFAULT_TZ,
    location: cleanLine(item.location?.displayName, 200), notes: cleanNotes(item.bodyPreview), participants: [uid], reminders: [], repeat: null,
    private: sens === "private" || sens === "confidential", webLink: httpsOnly(item.webLink), rev: 1, gen,
    createdAt: item.lastModifiedDateTime || "", updatedAt: item.lastModifiedDateTime || "", createdBy: { id: uid, name: "Outlook" }, updatedBy: { id: uid, name: "Outlook" },
  };
}

const fmtWall = (ms, tz) => {
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long" }).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour === "24" ? "00" : o.hour}:${o.minute}:${o.second}`, dow: o.weekday.toLowerCase() };
};

/** CRM-Termin → Graph-Ereignis (Wanduhrzeit in der Zeitzone des Termins, damit Wiederholungen über die Sommerzeit gleich bleiben) */
export function graphEventBody(ev) {
  const tz = ev.tz || DEFAULT_TZ;
  let start, end, startDate, dow;
  if (ev.allDay) {
    start = `${ev.start}T00:00:00`;
    end = `${addDaysStr(ev.end, 1)}T00:00:00`;
    startDate = ev.start;
    dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(ev.start + "T00:00:00Z").getUTCDay()];
  } else {
    const s = fmtWall(Date.parse(ev.start), tz), e = fmtWall(Date.parse(ev.end), tz);
    start = `${s.date}T${s.time}`;
    end = `${e.date}T${e.time}`;
    startDate = s.date;
    dow = s.dow;
  }
  const body = {
    subject: ev.title, body: { contentType: "text", content: ev.notes || "" }, location: { displayName: ev.location || "" }, isAllDay: Boolean(ev.allDay),
    start: { dateTime: start, timeZone: tz }, end: { dateTime: end, timeZone: tz }, categories: [MARKER],
  };
  const r = ev.repeat;
  if (r) {
    const [, m, d] = startDate.split("-").map(Number);
    const pattern = { interval: r.interval || 1 };
    if (r.freq === "daily") pattern.type = "daily";
    else if (r.freq === "weekly") Object.assign(pattern, { type: "weekly", daysOfWeek: [dow], firstDayOfWeek: "monday" });
    else if (r.freq === "monthly") Object.assign(pattern, { type: "absoluteMonthly", dayOfMonth: d });
    else Object.assign(pattern, { type: "absoluteYearly", dayOfMonth: d, month: m });
    const range = r.until ? { type: "endDate", startDate, endDate: r.until } : r.count ? { type: "numbered", startDate, numberOfOccurrences: r.count } : { type: "noEnd", startDate };
    body.recurrence = { pattern, range };
  }
  return body;
}

const sameContent = (ev, p) => ev.title === p.title && ev.allDay === p.allDay && ev.start === p.start && ev.end === p.end && (ev.location || "") === (p.location || "");

// ---------------------------------------------------------------- Lesen für den Team-Kalender

const BUSY_VIEW = { title: "", location: "", notes: "", webLink: "" };

/** Ansicht eines importierten Termins für einen Betrachter: private Termine anderer Mitglieder nur als «Beschäftigt» (ohne Titel, Ort, Notizen, Link) */
function viewOf(e, viewerId) {
  const mine = e.ownerId === viewerId;
  const hide = e.private && !mine;
  const { gen, etag, seriesMasterId, outlookId, iCalUId, ...rest } = e;
  return { ...rest, ...(hide ? { ...BUSY_VIEW, busy: true } : {}), ...(mine ? {} : { webLink: "" }), mine };
}

/** Importierte Termine des Teams für den Betrachter (zusammengeführt: dieselbe Besprechung in mehreren Kalendern erscheint einmal mit allen Teilnehmern) */
export async function importedEvents(deps, store, viewerId) {
  const cfg = await cfgOf(deps);
  if (!cfg.configured) return [];
  const out = new Map();
  for (const key of await store.list("cal/ol/ev/")) {
    const doc = (await store.read(key))?.value;
    for (const e of Array.isArray(doc?.events) ? doc.events : []) {
      const v = viewOf(e, viewerId);
      const k = e.iCalUId ? `${e.iCalUId}|${e.start}|${e.end}` : e.id;
      const have = out.get(k);
      if (!have) { out.set(k, v); continue; }
      const best = have.busy && !v.busy ? v : have;
      out.set(k, { ...best, participants: [...new Set([...have.participants, ...v.participants])] });
    }
  }
  return [...out.values()];
}

/** Gibt es im Team eine Outlook-Verbindung (Filter «Outlook anzeigen» im Kalender)? */
export async function outlookEnabled(deps, store, viewerId) {
  if (!(await cfgOf(deps)).configured) return { enabled: false, mine: false };
  const keys = await store.list("cal/ol/conn/");
  return { enabled: keys.length > 0, mine: keys.includes(connKey(viewerId)) };
}

// ---------------------------------------------------------------- Sperre

async function claim(store, key, now) {
  let got = false;
  await mutateDoc(store, key, (doc) => {
    got = false;
    if (doc && now - doc.at < LOCK_MS) return undefined;
    got = true;
    return { at: now };
  });
  return got;
}
const release = (store, key) => store.remove(key).catch(() => {});

// ---------------------------------------------------------------- CRM → Outlook

const publicLinkOf = (r, userId, now) => ({ userId, outlookId: r.id, iCalUId: String(r.iCalUId || ""), etag: String(r["@odata.etag"] || ""), pushedAt: new Date(now).toISOString(), dirty: false });

async function pushWith(g, ev, userId, now) {
  const body = graphEventBody(ev);
  const link = ev.outlook;
  if (link?.outlookId && link.userId === userId) {
    const res = await g.call("PATCH", `/me/events/${enc(link.outlookId)}`, { body: { ...body, ...(ev.repeat ? {} : { recurrence: null }) }, okStatus: [404] });
    if (res.status !== 404) return publicLinkOf(await res.json(), userId, now);
  }
  const created = await g.json("POST", "/me/events", { body });
  if (!created?.id) throw new GraphError("Unerwartete Antwort von Microsoft Graph (Termin ohne ID)", { kind: "other" });
  return publicLinkOf(created, userId, now);
}

async function saveLink(store, id, link) {
  await mutateDoc(store, EVENTS_KEY, (doc) => {
    const list = Array.isArray(doc?.events) ? doc.events : [];
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return undefined;
    const out = [...list];
    out[i] = { ...list[i], outlook: link };
    return { events: out };
  });
}

async function loadConns(store) {
  const out = new Map();
  for (const key of await store.list("cal/ol/conn/")) {
    const c = (await store.read(key))?.value;
    if (c && UID_RE.test(c.userId)) out.set(c.userId, c);
  }
  return out;
}

/**
 * Nach dem Speichern eines CRM-Termins: in den Outlook-Kalender des Erstellers (sonst des ersten verbundenen Teilnehmers) schreiben, sofern dessen
 * Richtung «both» ist. Wirft nie; Fehler markieren den Termin als «dirty» (der nächste Lauf versucht es erneut).
 * @returns {Promise<{status:"pushed"|"skipped"|"error", link?:object, kind?:string}>}
 */
export async function afterSave(deps, store, ev) {
  try {
    if (!ev || ev.source === "outlook" || !(await cfgOf(deps)).configured) return { status: "skipped" };
    const conns = await loadConns(store);
    const ok = (uid) => conns.get(uid)?.status === "connected" && conns.get(uid)?.direction === "both";
    const candidates = ev.outlook?.userId ? [ev.outlook.userId] : [ev.createdBy?.id, ...(ev.participants || [])];
    const uid = candidates.find((u) => u && ok(u));
    if (!uid) return { status: "skipped" };
    try {
      const g = G.createUserGraph(await getAccess(deps, store, uid), deps);
      const link = await pushWith(g, ev, uid, tnow(deps));
      await saveLink(store, ev.id, link);
      return { status: "pushed", link };
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      logError("Outlook: Termin nach Outlook schreiben", err, { user: uid });
      const link = { ...(ev.outlook || {}), userId: uid, dirty: true, error: err.kind };
      await saveLink(store, ev.id, link);
      return { status: "error", kind: err.kind, link };
    }
  } catch (err) {
    logError("Outlook: Termin nach Outlook schreiben", err);
    return { status: "error", kind: "other" };
  }
}

/** Nach dem Löschen eines CRM-Termins: den verknüpften Outlook-Termin löschen (sonst für den nächsten Lauf vormerken). Wirft nie. */
export async function afterDelete(deps, store, ev) {
  const link = ev?.outlook;
  if (!link?.outlookId || !UID_RE.test(link.userId)) return { status: "skipped" };
  try {
    const g = G.createUserGraph(await getAccess(deps, store, link.userId), deps);
    await g.call("DELETE", `/me/events/${enc(link.outlookId)}`, { okStatus: [404] });
    return { status: "deleted" };
  } catch (err) {
    if (!(err instanceof GraphError)) logError("Outlook: Termin in Outlook löschen", err);
    await mutateDoc(store, delKey(link.userId), (doc) => ({ items: [...new Set([...(doc?.items || []), link.outlookId])].slice(-200) })).catch(() => {});
    return { status: "error", kind: err.kind || "other" };
  }
}

// ---------------------------------------------------------------- Outlook → CRM (Delta-Abgleich)

async function fetchPages(g, startUrl, { deadline, clock, select }) {
  const headers = { prefer: 'odata.maxpagesize=100, outlook.timezone="UTC"' };
  let url = startUrl;
  const items = [];
  let deltaLink = null, nextLink = null, pages = 0;
  while (url) {
    if (pages > 0 && (clock() >= deadline || pages >= MAX_PAGES)) { nextLink = url; break; }
    let res;
    try {
      res = await g.call("GET", url, { headers, ctx: "Kalender" });
    } catch (err) {
      // Manche Mandanten lehnen $select bei Delta-Abfragen ab: einmal ohne wiederholen
      if (pages === 0 && select && err instanceof GraphError && err.status === 400 && url.includes("$select=")) {
        url = url.replace(/&\$select=[^&]*/, "");
        select = false;
        continue;
      }
      throw err;
    }
    const body = await res.json().catch(() => null);
    if (Array.isArray(body?.value)) items.push(...body.value);
    url = body?.["@odata.nextLink"] || null;
    deltaLink = body?.["@odata.deltaLink"] || deltaLink;
    pages++;
  }
  return { items, deltaLink, nextLink };
}

const isGone = (err) => err instanceof GraphError && (err.kind === "gone" || /syncState|ResyncRequired/i.test(err.code || ""));

/**
 * Ein Benutzer: Outlook → CRM (Delta), dann (Richtung «both») offene Änderungen nach Outlook. Wirft nie.
 * @param deps { env, rootEnv?, fetch?, sleep?, now }  store: Namensraum des Teams
 * @param o     { deadline?: ms, force?: boolean }  deadline: Zeitpunkt, nach dem keine weitere Seite geladen wird (der nächste Lauf setzt fort)
 */
export async function syncUser(deps, store, uid, o = {}) {
  const clock = () => tnow(deps);
  const t0 = clock();
  const deadline = o.deadline ?? t0 + DEFAULT_BUDGET_MS;
  const at = () => new Date(clock()).toISOString();
  const conn = await readConn(store, uid);
  if (!conn || conn.status !== "connected") return { ok: false, skipped: "not_connected" };
  if (!(await claim(store, lockKey(uid), t0))) return { ok: true, skipped: "busy" };
  const res = { ok: true, added: 0, updated: 0, removed: 0, pushed: 0, partial: false };
  try {
    const g = G.createUserGraph(await getAccess(deps, store, uid), deps);
    let state = (await store.read(deltaKey(uid)))?.value || {};
    let full = o.force === true || !state.deltaLink || !state.fullAt || t0 - state.fullAt > FULL_RESYNC_MS;
    if (state.nextLink) full = state.mode === "full"; // Fortsetzung eines unterbrochenen Laufs
    let page;
    for (let attempt = 0; ; attempt++) {
      let startUrl, st = state;
      if (state.nextLink && attempt === 0) startUrl = state.nextLink;
      else if (full) {
        st = { ...state, nextLink: null, mode: "full", gen: (state.gen || 0) + 1, windowFrom: t0 - WINDOW_BACK_DAYS * DAY, windowTo: t0 + WINDOW_AHEAD_DAYS * DAY };
        startUrl = `/me/calendarView/delta?startDateTime=${enc(new Date(st.windowFrom).toISOString())}&endDateTime=${enc(new Date(st.windowTo).toISOString())}&$select=${SELECT}`;
      } else {
        st = { ...state, mode: "delta" };
        startUrl = state.deltaLink;
      }
      try {
        page = await fetchPages(g, startUrl, { deadline, clock, select: true });
        state = st;
        break;
      } catch (err) {
        if (isGone(err) && attempt === 0) { state = { ...state, deltaLink: null, nextLink: null }; full = true; continue; } // Delta-Stand abgelaufen: neu aufsetzen
        throw err;
      }
    }

    // ---- Auswerten
    const evDoc = (await store.read(evKey(uid)))?.value;
    const existing = new Set((Array.isArray(evDoc?.events) ? evDoc.events : []).map((e) => e.outlookId));
    const crmList = Array.isArray((await store.read(EVENTS_KEY))?.value?.events) ? (await store.read(EVENTS_KEY)).value.events : [];
    const linked = new Map(crmList.filter((e) => e.outlook?.userId === uid && e.outlook.outlookId).map((e) => [e.outlook.outlookId, e]));
    const upsert = new Map(), remove = new Set(), crmApply = new Map(), crmUnlink = new Set(), pushIds = new Set();
    const finished = !page.nextLink;
    for (const item of page.items) {
      if (!item?.id) continue;
      const lk = linked.get(item.id);
      if (item["@removed"] || item.isCancelled === true) {
        remove.add(item.id);
        if (lk) crmUnlink.add(lk.id);
        continue;
      }
      const fromCrm = Array.isArray(item.categories) && item.categories.includes(MARKER);
      if (lk || fromCrm || (item.seriesMasterId && linked.has(item.seriesMasterId))) {
        // Vom CRM geschriebener Termin: Echo ignorieren, echte Änderung aus Outlook nach «letzter Schreiber gewinnt» behandeln
        if (!lk || lk.repeat || String(item["@odata.etag"] || "") === lk.outlook.etag) continue;
        const times = timesOf(item);
        if (!times) continue;
        const patch = { title: cleanLine(item.subject, 120) || lk.title, ...times, location: cleanLine(item.location?.displayName, 200) };
        const outMs = Date.parse(item.lastModifiedDateTime || "") || 0, crmMs = Date.parse(lk.updatedAt || "") || 0;
        if (sameContent(lk, patch)) crmApply.set(lk.id, { etag: item["@odata.etag"] || "" });
        else if (outMs > crmMs) crmApply.set(lk.id, { etag: item["@odata.etag"] || "", patch, at: item.lastModifiedDateTime, crmMs });
        else if (conn.direction === "both") pushIds.add(lk.id);
        continue;
      }
      const ev = toImported(item, uid, state.gen || 0);
      if (ev) upsert.set(ev.outlookId, ev);
    }
    for (const id of upsert.keys()) existing.has(id) ? res.updated++ : res.added++;
    res.removed = [...remove].filter((id) => existing.has(id)).length;

    // ---- Importierte Termine speichern (zuerst die Termine, dann der Stand: bei einem Abbruch wird der Lauf wiederholt)
    let count = 0;
    const sweep = finished && state.mode === "full";
    await mutateDoc(store, evKey(uid), (doc) => {
      const keep = (Array.isArray(doc?.events) ? doc.events : []).filter((e) => !remove.has(e.outlookId) && !upsert.has(e.outlookId) && !(sweep && e.gen !== state.gen));
      const events = [...keep, ...upsert.values()].slice(0, MAX_IMPORTED);
      count = events.length;
      return { events };
    });
    if (crmApply.size || crmUnlink.size) {
      await mutateDoc(store, EVENTS_KEY, (doc) => {
        let changed = false;
        const events = (Array.isArray(doc?.events) ? doc.events : []).map((e) => {
          if (!e.outlook) return e;
          if (crmUnlink.has(e.id)) { changed = true; const { outlook, ...rest } = e; return rest; }
          const p = crmApply.get(e.id);
          if (!p) return e;
          changed = true;
          if (!p.patch) return { ...e, outlook: { ...e.outlook, etag: p.etag } }; // gleicher Inhalt: nur den eTag merken
          if ((Date.parse(e.updatedAt || "") || 0) > p.crmMs) return e; // inzwischen im CRM geändert: CRM gewinnt
          return { ...e, ...p.patch, rev: (e.rev || 1) + 1, updatedAt: p.at || at(), updatedBy: { id: null, name: "Outlook" }, outlook: { ...e.outlook, etag: p.etag, syncedAt: at(), dirty: false } };
        });
        return changed ? { events } : undefined;
      });
    }
    await store.write(deltaKey(uid), page.nextLink
      ? { ...state, nextLink: page.nextLink }
      : { gen: state.gen || 0, mode: state.mode, deltaLink: page.deltaLink || state.deltaLink || null, nextLink: null, windowFrom: state.windowFrom, windowTo: state.windowTo, fullAt: state.mode === "full" ? t0 : state.fullAt });
    res.partial = !finished;

    // ---- CRM → Outlook: offene Änderungen und Löschungen nachholen
    if (conn.direction === "both") {
      const fresh = Array.isArray((await store.read(EVENTS_KEY))?.value?.events) ? (await store.read(EVENTS_KEY)).value.events : [];
      for (const e of fresh) {
        if (!e.outlook || e.outlook.userId !== uid || (!e.outlook.dirty && !pushIds.has(e.id))) continue;
        try {
          await saveLink(store, e.id, await pushWith(g, e, uid, clock()));
          res.pushed++;
        } catch (err) {
          if (!(err instanceof GraphError)) throw err;
          await saveLink(store, e.id, { ...e.outlook, dirty: true, error: err.kind });
        }
      }
      const del = (await store.read(delKey(uid)))?.value?.items || [];
      const left = [];
      for (const id of del) {
        try { await g.call("DELETE", `/me/events/${enc(id)}`, { okStatus: [404] }); } catch (err) { if (err instanceof GraphError) left.push(id); else throw err; }
      }
      if (del.length) await store.write(delKey(uid), { items: left });
    }
    await patchConn(store, uid, { lastSync: at(), lastOkAt: at(), error: null, count });
    return res;
  } catch (err) {
    if (!(err instanceof GraphError)) { logError("Outlook-Abgleich", err, { user: uid }); }
    const e = err instanceof GraphError ? err : new GraphError("Interner Fehler beim Abgleich", { kind: "other" });
    if (e.kind !== "revoked") {
      await patchConn(store, uid, { lastSync: at(), error: { kind: e.kind, code: e.code || "", message: G.redactSecret(e.message, envOf(deps)), at: at() } }).catch(() => {});
    }
    return { ...res, ok: false, error: { kind: e.kind, message: e.message } };
  } finally {
    await release(store, lockKey(uid));
  }
}

/**
 * Geplanter Lauf: alle Teams, alle verbundenen Benutzer. Ohne Einrichtung wird nichts angefasst.
 * @param deps { env, store (Wurzel-Store), fetch?, now?, budgetMs? }
 */
export async function runSync(deps) {
  const out = { teams: 0, users: 0, ok: 0, failed: 0 };
  if (!(await cfgOf(deps)).configured) return { ...out, skipped: "not_configured" };
  const now = tnow(deps);
  const deadline = now + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  const teams = (await loadTeams(deps.store, { now, cacheMs: 0 })).filter((t) => t.active !== false);
  const users = await U.loadUsers(deps.store, { now, cacheMs: 0 });
  for (const team of teams) {
    const store = scopedStore(deps.store, team.id);
    let keys;
    try { keys = await store.list("cal/ol/conn/"); } catch (err) { logError("Outlook-Abgleich: Team", err, { team: team.id }); continue; }
    if (keys.length) out.teams++;
    for (const key of keys) {
      if (tnow(deps) >= deadline) return { ...out, partial: true };
      const uid = key.slice("cal/ol/conn/".length);
      const user = users.find((u) => u.id === uid);
      if (!UID_RE.test(uid) || !user || user.active === false || user.teamId !== team.id) continue;
      const r = await syncUser(deps, store, uid, { deadline });
      if (r.skipped) continue; // nicht verbunden (z. B. widerrufen) oder gerade in Arbeit
      out.users++;
      if (r.ok) out.ok++; else out.failed++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- Anmeldung (Verbinden) und Trennen

const SETTINGS = "einstellungen";

/** Rückleitung von Microsoft (ohne Sitzung: die Zuordnung zum Benutzer steckt im signierten «state» + einmaligem Eintrag im Team-Speicher). */
export async function callback(req, deps) {
  const env = envOf(deps);
  const cfg = await cfgOf(deps, req);
  if (!cfg.configured || !cfg.base) return json(400, { error: "not_configured", message: "Outlook ist nicht eingerichtet", reason: "outlook" });
  const back = (r) => ({ status: 302, redirect: `${cfg.base}/#/${SETTINGS}?outlook=${r}` });
  const now = tnow(deps);
  const q = queryOf(req);
  const st = verifyState(env, q.get("state"), now);
  if (!st) return back("error&r=state");
  const root = deps.store;
  const team = (await loadTeams(root, { now, cacheMs: 0 })).find((t) => t.id === st.t && t.active !== false);
  if (!team) return back("error&r=state");
  const store = scopedStore(root, team.id);
  const pend = (await store.read(pendKey(st.n)))?.value;
  await store.remove(pendKey(st.n)).catch(() => {});
  if (!pend || pend.uid !== st.u || pend.exp <= now) return back("error&r=state");
  const user = (await U.loadUsers(root, { now, cacheMs: 0 })).find((u) => u.id === st.u);
  if (!user || user.active === false || user.teamId !== team.id || user.role === "superadmin") return back("error&r=state");
  if (q.get("error")) return back(`error&r=${q.get("error") === "access_denied" ? "denied" : "microsoft"}`);
  const code = q.get("code");
  if (!code || code.length > 4000) return back("error&r=state");
  try {
    const tok = await G.exchangeCode({ ...cfg, redirectUri: pend.redir || cfg.redirectUri }, code, pend.verifier, deps); // dieselbe Rückleit-Adresse wie beim Anmelden
    if (!tok.refreshToken) return back("error&r=norefresh");
    const me = await G.createUserGraph(tok.accessToken, deps).json("GET", "/me?$select=displayName,mail,userPrincipalName");
    const address = cleanLine(me?.mail || me?.userPrincipalName, 160).toLowerCase();
    const prev = await readConn(store, user.id);
    const sameAccount = prev && prev.account?.address === address;
    const conn = {
      v: 1, userId: user.id, account: { name: cleanLine(me?.displayName, 120), address }, direction: DIRECTIONS.includes(prev?.direction) ? prev.direction : "in", status: "connected",
      tokenEnc: encryptToken(env, tok.refreshToken, aadOf(team.id, user.id)), connectedAt: new Date(now).toISOString(), lastSync: sameAccount ? prev.lastSync || null : null,
      lastOkAt: sameAccount ? prev.lastOkAt || null : null, error: null, count: sameAccount ? prev.count ?? 0 : 0,
    };
    if (prev && !sameAccount) await wipe(store, user.id); // anderes Konto: alte Termine und Delta-Stand verwerfen
    await store.write(connKey(user.id), conn);
    accessCache.delete(`${team.id}|${user.id}`);
    return back("connected");
  } catch (err) {
    if (err instanceof GraphError) return back(`error&r=${err.kind}`);
    logError("Outlook: Verbinden", err);
    return back("error&r=other");
  }
}

async function wipe(store, uid) {
  for (const k of [deltaKey(uid), evKey(uid), delKey(uid), lockKey(uid)]) await store.remove(k).catch(() => {});
  await mutateDoc(store, EVENTS_KEY, (doc) => {
    const list = Array.isArray(doc?.events) ? doc.events : [];
    if (!list.some((e) => e.outlook?.userId === uid)) return undefined;
    return { events: list.map((e) => { if (e.outlook?.userId !== uid) return e; const { outlook, ...rest } = e; return rest; }) };
  });
}

async function startConnect(deps, store, ctx, req) {
  const env = envOf(deps);
  const cfg = await cfgOf(deps, req);
  if (!cfg.configured) throw fail(400, "not_configured", "Outlook ist nicht eingerichtet", { reason: "outlook" });
  if (!cfg.redirectUri) throw fail(400, "not_configured", cfg.appUrlRequired ? "APP_URL ist nicht gesetzt – in Produktion ist die öffentliche Adresse (https://…) Pflicht, sie wird nicht aus der Anfrage abgeleitet" : "Die Adresse der App ist unbekannt (APP_URL setzen)", { reason: "outlook" });
  const now = tnow(deps);
  // abgelaufene, nie abgeschlossene Anmeldungen aufräumen
  for (const k of await store.list("cal/ol/pending/")) {
    const p = (await store.read(k))?.value;
    if (!p || p.exp <= now) await store.remove(k).catch(() => {});
  }
  const nonce = randomBytes(16).toString("hex");
  const { verifier, challenge } = G.pkcePair();
  await store.write(pendKey(nonce), { uid: ctx.user.id, verifier, redir: cfg.redirectUri, exp: now + PENDING_MS });
  const state = signState(env, { u: ctx.user.id, t: ctx.teamId, n: nonce, e: now + PENDING_MS });
  return G.authorizeUrl(cfg, { state, challenge, loginHint: ctx.user.email || undefined });
}

// ---------------------------------------------------------------- Routen /api/outlook/*

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFail) return json(e.status, { error: e.code, message: e.message, ...e.extra });
    throw e;
  }
}
const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });

/** Einrichtungsstand für den Superadmin (die App-ID ist kein Geheimnis; ein Secret wird nie ausgegeben) */
export async function adminStatus(deps, req) {
  const cfg = await cfgOf(deps, req);
  const setting = await loadSetting(rootOf(deps));
  return {
    configured: cfg.configured, member: false, missing: cfg.missing, source: cfg.source, publicClient: cfg.publicClient,
    clientId: cfg.clientId, tenant: cfg.tenant, redirectUri: cfg.redirectUri, editable: cfg.source !== "env",
    setting: setting ? { clientId: String(setting.clientId || ""), tenant: String(setting.tenant || "common") } : null, connection: null,
  };
}

async function statusBody(deps, store, ctx, req) {
  if (ctx.isSuper) return adminStatus(deps, req);
  const cfg = await cfgOf(deps);
  if (!cfg.configured) return { configured: false, member: true, connection: null }; // Mitglieder sehen keine Einrichtungsdetails
  return { configured: true, member: true, connection: publicConn(await readConn(store, ctx.user.id)) };
}

/**
 * Plattform-Einstellung der App-ID: nur der Superadmin, auch ohne gewähltes Team (vor der Team-Prüfung aufgerufen; deps.store = Wurzel-Speicher).
 * GET /outlook/status gehört für den Superadmin ebenfalls hierher. @returns Antwort oder null
 */
export function platformRoute(path, method, req, deps, ctx) {
  const isStatus = path === "/outlook/status" && ctx.isSuper;
  if (path !== "/outlook/platform" && !isStatus) return null;
  return guard(async () => {
    if (isStatus) return method === "GET" ? json(200, await adminStatus({ ...deps, rootStore: deps.store }, req)) : wrongMethod();
    if (!ctx.isSuper) throw fail(403, "forbidden", "Nur für den Plattform-Administrator", { reason: "platform_only" });
    const root = deps.store;
    const d = { ...deps, rootStore: root };
    if (method === "PUT") {
      const b = parseBody(req, 2048);
      const clientId = String(b.clientId ?? "").trim().toLowerCase();
      const tenant = String(b.tenant ?? "").trim() || "common";
      if (!G.CLIENT_ID_RE.test(clientId)) throw fail(400, "bad_request", "Die Anwendungs-ID (Client-ID) ist ungültig – sie sieht so aus: 12345678-abcd-1234-abcd-1234567890ab", { field: "clientId" });
      if (!G.TENANT_RE.test(tenant)) throw fail(400, "bad_request", "Ungültiger Mandant (z. B. common oder eine Mandanten-ID)", { field: "tenant" });
      if (G.outlookConfig(envOf(d)).source === "env") throw fail(409, "env_managed", "Die Client-ID ist in den Umgebungsvariablen gesetzt und hat Vorrang", { reason: "env" });
      await root.write(SETTING_KEY, { clientId, tenant, updatedAt: new Date(tnow(deps)).toISOString(), updatedBy: ctx.user.id });
      settingCache.delete(root);
      return json(200, await adminStatus(d, req));
    }
    if (method === "DELETE") {
      await root.remove(SETTING_KEY).catch(() => {});
      settingCache.delete(root);
      return json(200, await adminStatus(d, req));
    }
    return wrongMethod();
  });
}

/** @returns Antwort oder null, wenn der Pfad nicht zu Outlook gehört */
export function route(path, method, req, deps, ctx) {
  if (path !== "/outlook" && !path.startsWith("/outlook/")) return null;
  return guard(async () => {
    const { store } = deps;
    if (path === "/outlook/status") {
      if (method !== "GET") return wrongMethod();
      return json(200, await statusBody(deps, store, ctx, req));
    }
    // Alles Weitere betrifft den EIGENEN Kalender; das Superadmin-Konto ist kein Team-Mitglied und hat keinen
    if (ctx.isSuper) throw fail(403, "forbidden", "Der Plattform-Administrator hat keinen eigenen Kalender", { reason: "members_only" });
    const uid = ctx.user.id;
    if (path === "/outlook/connect") {
      if (method !== "GET") return wrongMethod();
      return json(200, { url: await startConnect(deps, store, ctx, req) });
    }
    if (path === "/outlook/settings") {
      if (method !== "PUT") return wrongMethod();
      const b = parseBody(req, 1024);
      if (!DIRECTIONS.includes(b.direction)) throw fail(400, "bad_request", "Ungültige Richtung");
      if (!(await readConn(store, uid))) throw fail(409, "outlook_not_connected", "Outlook ist nicht verbunden");
      await patchConn(store, uid, { direction: b.direction });
      return json(200, await statusBody(deps, store, ctx, req));
    }
    if (path === "/outlook/sync") {
      if (method !== "POST") return wrongMethod();
      const conn = await readConn(store, uid);
      if (!conn || conn.status !== "connected") throw fail(409, "outlook_not_connected", "Outlook ist nicht verbunden", { reason: conn?.status === "revoked" ? "revoked" : "not_connected" });
      // Der Zeitstempel einer Anfrage steht fest; für die Zeitbegrenzung des Abgleichs läuft die Uhr weiter
      const started = Date.now(), base = deps.now;
      const live = { ...deps, now: deps.clock ?? (typeof base === "function" ? base : () => base + (Date.now() - started)) }; // clock: Uhr für Tests
      const r = await syncUser(live, store, uid, { deadline: live.now() + (deps.syncBudgetMs ?? 8000) });
      return json(200, { ...(await statusBody(deps, store, ctx, req)), result: { ok: r.ok, added: r.added ?? 0, updated: r.updated ?? 0, removed: r.removed ?? 0, pushed: r.pushed ?? 0, partial: Boolean(r.partial), skipped: r.skipped || null } });
    }
    if (path === "/outlook/connection") {
      if (method !== "DELETE") return wrongMethod();
      accessCache.delete(`${store.teamId}|${uid}`);
      await store.remove(connKey(uid)).catch(() => {});
      await wipe(store, uid);
      return json(200, await statusBody(deps, store, ctx, req));
    }
    return json(404, { error: "not_found", message: "Nicht gefunden" });
  });
}
