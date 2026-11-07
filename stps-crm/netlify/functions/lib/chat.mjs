// STPS CRM – Team-Chat: je Team zwei Kanäle, strikt getrennt (der Store ist der Namensraum des Teams, siehe teams.mjs scopedStore):
//   «team» = ganzes Team (alle Mitglieder) · «mgmt» = Geschäftsleitung (nur Team-Admins und Benutzer mit Management-Kennzeichen;
//   die Prüfung geschieht hier auf dem Server bei JEDER Anfrage, nicht im Browser).
//
// Speicherung im Blob-Store des Teams (nie im globalen Namensraum); Kanal «mgmt» mit Präfix «chatm/» statt «chat/»:
//   chat/meta          { head }                       Nummer des aktuellen Segments (0 = noch keine Nachricht)
//   chat/seg-000001    { n, firstId, messages[] }     je Segment höchstens SEG_SIZE Nachrichten; IDs laufen lückenlos (firstId + Index)
//   chat/u-<uid>       { read, mailedAt, sent[] }     je Benutzer: zuletzt gelesene Nachricht, letzte E-Mail, letzte Sendezeiten (Tempolimit)
// Ältere Segmente als KEEP_SEGS werden gelöscht (Obergrenze). Nachrichten sind reiner Text (der Browser escaped beim Anzeigen).
//
//  GET  /api/chat?[channel=team|mgmt&]since=<id>|before=<id>&limit=<n>[&peek=1]   neueste Nachrichten / neuere als <id> / ältere als <id>; peek: nur Zähler
//  POST /api/chat {text, cid?, channel?, file?}                          senden (file = ID einer Datei aus POST /api/files mit passendem Bereich, siehe files.mjs) (danach Push/E-Mail an die anderen Mitglieder, siehe push.mjs)
//  POST /api/chat/read {upTo, channel?}                                  als gelesen markieren
//  GET  /api/push/config · POST /api/push/subscribe · POST /api/push/unsubscribe   siehe push.mjs
import { mutateDoc } from "./kv.mjs";
import { ApiFail, json, fail, queryOf, parseBody } from "./http.mjs";
import * as PUSH from "./push.mjs";
import { scrubChat } from "./hide-super.mjs";
import { canManage } from "./roles.mjs";
import * as FILES from "./files.mjs";

export const META_KEY = "chat/meta";
export const CHANNELS = ["team", "mgmt"];
export const DEFAULT_CHANNEL = "team";
export const SEG_SIZE = 100;
export const KEEP_SEGS = 50; // = höchstens 5000 Nachrichten je Team
export const MAX_TEXT = 2000;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
/** Tempolimit je Benutzer: höchstens so viele Nachrichten pro Minute */
export const RATE_PER_MIN = 20;
const CID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// canManage: Team-Admin, Management-Kennzeichen, Superadmin (Support im Team-Kontext) – gemeinsam mit den Dateien, siehe roles.mjs
export { canManage };

/** Kanäle, die dieses Konto sehen darf */
export const channelsFor = (user, isSuper = false) => (canManage(user, isSuper) ? ["team", "mgmt"] : ["team"]);

/** Kanal aus der Anfrage: unbekannt → 400; «mgmt» ohne Berechtigung → 403 (der Kanal gibt nichts preis) */
export function channelOf(raw, user, isSuper = false) {
  const ch = raw === undefined || raw === null || raw === "" ? DEFAULT_CHANNEL : String(raw);
  if (!CHANNELS.includes(ch)) throw fail(400, "bad_channel", "Unbekannter Chat-Kanal");
  if (!channelsFor(user, isSuper).includes(ch)) throw fail(403, "chat_forbidden", "Kein Zugriff auf diesen Chat-Kanal");
  return ch;
}

/** Schlüssel eines Kanals im Namensraum des Teams */
const keys = (ch) => {
  const p = ch === "mgmt" ? "chatm" : "chat";
  return { meta: `${p}/meta`, seg: (n) => `${p}/seg-${String(n).padStart(6, "0")}`, user: (uid) => `${p}/u-${uid}` };
};

// ---------------------------------------------------------------- Eingaben

/** Text bereinigen: nur Text (Steuerzeichen raus, Zeilenumbrüche bleiben), gekürzt auf MAX_TEXT. Wirft bei leer/zu lang. */
export function cleanMessage(v, { optional = false } = {}) {
  const s = String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "") // Steuerzeichen, Zeilentrenner und Richtungsumschalter
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!s && optional) return ""; // Nachricht nur mit Anhang
  if (!s) throw fail(400, "chat_empty", "Bitte eine Nachricht eingeben");
  if (s.length > MAX_TEXT) throw fail(400, "chat_too_long", `Die Nachricht ist zu lang (höchstens ${MAX_TEXT} Zeichen)`, { max: MAX_TEXT });
  return s;
}

const intParam = (q, name) => {
  const v = q.get(name);
  return v !== null && /^\d{1,12}$/.test(v) ? Number(v) : null;
};

// ---------------------------------------------------------------- Lesen

async function getHead(store, K) {
  const h = (await store.read(K.meta))?.value?.head;
  return Number.isInteger(h) && h > 0 ? h : 0;
}

const readSeg = async (store, K, n) => {
  const v = (await store.read(K.seg(n)))?.value;
  return v && Array.isArray(v.messages) && Number.isInteger(v.firstId) ? v : null;
};

const lastIdOf = (seg) => (seg ? seg.firstId + seg.messages.length - 1 : 0);

/**
 * Nachrichten mit after < id ≤ upTo, die neuesten `limit`, aufsteigend; more = es gibt ältere (im Bereich) als die gelieferten.
 * Geht Segment für Segment rückwärts; maxSegs begrenzt den Aufwand.
 */
async function collect(store, K, head, { after = 0, upTo = Infinity, limit, maxSegs = KEEP_SEGS, first = null }) {
  let out = [];
  for (let n = head, i = 0; n >= 1 && i < maxSegs && n > head - KEEP_SEGS; n--, i++) {
    const seg = n === head && first ? first : await readSeg(store, K, n);
    if (!seg) break;
    out = seg.messages.filter((m) => m.id > after && m.id <= upTo).concat(out);
    if (out.length > limit || seg.firstId <= after + 1) break;
  }
  return { messages: out.slice(-limit), more: out.length > limit };
}

/** Öffentliche Form einer Nachricht (ohne interne Felder wie cid) */
const view = (m) => ({ id: m.id, uid: m.uid, name: m.name, ...(m.sa ? { sa: true } : {}), at: m.at, text: m.text, ...(m.file ? { file: m.file } : {}) });
/** Für Nicht-Superadmins: Nachrichten des Superadmins erscheinen als «Administrator» (ohne seinen Namen und seine Kennung) */
const viewFor = (isSuper) => (isSuper ? view : (m) => scrubChat(view(m)));

async function userDoc(store, K, uid) {
  const d = (await store.read(K.user(uid)))?.value;
  return d && typeof d === "object" ? d : {};
}

/** Ungelesene Nachrichten anderer (höchstens 100; ohne Eintrag zählen nur Nachrichten seit der Kontoerstellung) */
async function unreadCount(store, K, head, headSeg, user, doc) {
  const lastId = lastIdOf(headSeg);
  const readId = Number.isInteger(doc.read) ? doc.read : 0;
  if (!head || readId >= lastId) return 0;
  const { messages } = await collect(store, K, head, { after: readId, limit: 100, maxSegs: 3, first: headSeg });
  const since = doc.read === undefined ? String(user.createdAt || "") : "";
  return messages.filter((m) => m.uid !== user.id && (!since || m.at >= since)).length;
}

export async function listChat(store, user, q, { isSuper = false, channel = DEFAULT_CHANNEL } = {}) {
  const show = viewFor(isSuper);
  const K = keys(channel);
  const head = await getHead(store, K);
  const headSeg = head ? await readSeg(store, K, head) : null;
  const lastId = lastIdOf(headSeg);
  const doc = await userDoc(store, K, user.id);
  const readId = Math.min(Number.isInteger(doc.read) ? doc.read : 0, lastId);
  const unread = await unreadCount(store, K, head, headSeg, user, doc);
  const base = { lastId, readId, unread };
  if (q.get("peek") === "1" || !head) return { ...base, messages: [], hasMore: false };

  const limit = Math.min(MAX_LIMIT, Math.max(1, intParam(q, "limit") ?? DEFAULT_LIMIT));
  const since = intParam(q, "since");
  const before = intParam(q, "before");
  let r;
  if (since !== null) {
    if (since >= lastId) return { ...base, messages: [], hasMore: false };
    r = await collect(store, K, head, { after: since, limit, first: headSeg });
    return { ...base, messages: r.messages.map(show), hasMore: r.more, gap: r.more }; // gap: mehr als `limit` neue – der Browser ersetzt seine Liste
  }
  r = await collect(store, K, head, { upTo: before !== null ? before - 1 : Infinity, limit, first: headSeg });
  return { ...base, messages: r.messages.map(show), hasMore: r.more };
}

// ---------------------------------------------------------------- Schreiben

async function bumpHead(store, K, n) {
  await mutateDoc(store, K.meta, (doc) => (Number.isInteger(doc?.head) && doc.head >= n ? undefined : { head: n }));
  if (n > KEEP_SEGS) await store.remove(K.seg(n - KEEP_SEGS)).catch(() => {});
}

/** Tempolimit: trägt die Sendezeit ein; wirft 429, wenn schon RATE_PER_MIN in der letzten Minute */
async function takeRate(store, K, uid, now) {
  await mutateDoc(store, K.user(uid), (doc) => {
    const recent = (Array.isArray(doc?.sent) ? doc.sent : []).filter((t) => Number.isFinite(t) && now - t < 60000);
    if (recent.length >= RATE_PER_MIN) throw fail(429, "chat_rate", "Zu viele Nachrichten – bitte einen Moment warten");
    return { ...(doc || {}), sent: [...recent, now].slice(-RATE_PER_MIN) };
  });
}

/** Hängt die Nachricht atomar an das aktuelle Segment (bei vollem Segment ein neues). Gleiche cid desselben Benutzers: keine Doppelung. */
export async function appendMessage(store, msg, channel = DEFAULT_CHANNEL) {
  const K = keys(channel);
  let head = (await getHead(store, K)) || 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    let saved = null;
    let full = false;
    let created = false;
    await mutateDoc(store, K.seg(head), async (seg) => {
      saved = null; full = false; created = false;
      if (!seg) {
        let firstId = 1;
        if (head > 1) {
          const prev = await readSeg(store, K, head - 1);
          if (prev) firstId = prev.firstId + prev.messages.length;
        }
        seg = { n: head, firstId, messages: [] };
        created = true;
      }
      if (msg.cid) {
        const dup = seg.messages.slice(-30).find((m) => m.uid === msg.uid && m.cid === msg.cid);
        if (dup) { saved = dup; return undefined; }
      }
      if (seg.messages.length >= SEG_SIZE) { full = true; return undefined; }
      saved = { id: seg.firstId + seg.messages.length, ...msg };
      return { ...seg, messages: [...seg.messages, saved] };
    });
    if (full) {
      head++;
      await bumpHead(store, K, head);
      continue;
    }
    if (created) await bumpHead(store, K, head);
    return saved;
  }
  throw new Error("Nachricht konnte nicht gespeichert werden (Segmente belegt)");
}

export async function markRead(store, user, upTo, channel = DEFAULT_CHANNEL) {
  const K = keys(channel);
  const head = await getHead(store, K);
  const lastId = lastIdOf(head ? await readSeg(store, K, head) : null);
  const target = Math.min(upTo, lastId);
  await mutateDoc(store, K.user(user.id), (doc) => (Number.isInteger(doc?.read) && doc.read >= target ? undefined : { ...(doc || {}), read: target }));
  return { readId: target, unread: 0 };
}

// ---------------------------------------------------------------- Routen

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFail) return json(e.status, { error: e.code, message: e.message, ...e.extra });
    throw e;
  }
}
const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });

/**
 * @param deps { env, store (Namensraum des Teams), rootStore (globale Dokumente: users), now, fetch?, webpush? }
 * @returns Antwort, oder null wenn der Pfad nicht zum Chat gehört
 */
export function route(path, method, req, deps, ctx) {
  if (path !== "/chat" && path !== "/chat/read" && !path.startsWith("/push/")) return null;
  return guard(async () => {
    const { store } = deps;
    const user = ctx.user;
    if (path.startsWith("/push/")) return PUSH.routes(path, method, req, deps, ctx);

    if (path === "/chat") {
      if (method === "GET") {
        const q = queryOf(req);
        const channel = channelOf(q.get("channel"), user, ctx.isSuper);
        return json(200, { ...(await listChat(store, user, q, { isSuper: ctx.isSuper, channel })), channel, channels: channelsFor(user, ctx.isSuper), now: new Date(deps.now).toISOString() });
      }
      if (method !== "POST") return wrongMethod();
      const body = parseBody(req, 8 * 1024);
      const channel = channelOf(body.channel, user, ctx.isSuper);
      // Anhang (optional): Datei-ID aus POST /api/files – Angaben (Name, Typ, Grösse) stammen vom Server; die Datei muss vom Absender sein und zum Kanal passen
      const fileId = typeof body.file === "string" && body.file ? body.file : null;
      const text = cleanMessage(body.text, { optional: Boolean(fileId) });
      const file = fileId ? await FILES.attachmentFor(store, fileId, { uid: user.id, scope: channel }) : null;
      const cid = typeof body.cid === "string" && CID_RE.test(body.cid) ? body.cid : undefined;
      await takeRate(store, keys(channel), user.id, deps.now);
      const message = await appendMessage(store, {
        uid: user.id, name: user.displayName, ...(ctx.isSuper ? { sa: true } : {}), at: new Date(deps.now).toISOString(), text, ...(file ? { file } : {}), ...(cid ? { cid } : {}),
      }, channel);
      // Eigene Nachricht gilt als gelesen
      await markRead(store, user, message.id, channel).catch(() => {});
      // Push/E-Mail an die anderen Mitglieder – darf das Senden nie scheitern lassen
      try {
        const pushed = scrubChat(view(message));
        await PUSH.notifyTeam(deps, ctx, pushed.text || !pushed.file ? pushed : { ...pushed, text: `Datei / File: ${pushed.file.name}` }, channel === "mgmt" ? { channel, only: (m) => canManage(m) } : {}); // Empfänger sind Mitglieder: Absender «Administrator»
      } catch (err) {
        console.error("[stps-crm] Benachrichtigung fehlgeschlagen:", err?.message || err);
      }
      return json(201, { message: view(message), lastId: message.id });
    }

    // POST /chat/read
    if (method !== "POST") return wrongMethod();
    const body = parseBody(req, 1024);
    if (!Number.isInteger(body.upTo) || body.upTo < 0) throw fail(400, "bad_request", "Ungültige Anfrage");
    return json(200, await markRead(store, user, body.upTo, channelOf(body.channel, user, ctx.isSuper)));
  });
}

