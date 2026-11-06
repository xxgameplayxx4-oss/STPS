// STPS CRM – Anwesenheit («woran arbeitet wer»): Heartbeats der Clients im Blob «presence» des Teams, je Benutzer ein Eintrag.
import { mutateDoc } from "./kv.mjs";

export const PRESENCE_KEY = "presence";
export const ONLINE_MS = 2 * 60 * 1000;
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const DEDUPE_MS = 5000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROUTE_RE = /^#\/[A-Za-z0-9_\-\/%.~]{0,150}(\?[A-Za-z0-9_\-=&%.~]{0,100})?$/;

const SPEC_KEY_RE = /^pres\.[A-Za-z]{1,30}$/;
const WORD_RE = /^[a-z]{2,20}$/;
const cleanStr = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Sprachunabhängiger Titel: { key: "pres.…", params: { kind, nr, name, page } } – jeder Client setzt ihn in seiner eigenen Sprache zusammen.
 * Nur bekannte Platzhalter, kurze Werte; kind/page sind Wörter (Tabellen-/Seitenname).
 */
export function cleanSpec(s) {
  if (!s || typeof s !== "object" || typeof s.key !== "string" || !SPEC_KEY_RE.test(s.key)) return null;
  const params = {};
  const src = s.params && typeof s.params === "object" ? s.params : {};
  for (const k of ["kind", "page"]) if (typeof src[k] === "string" && WORD_RE.test(src[k])) params[k] = src[k];
  for (const k of ["nr", "name"]) if (typeof src[k] === "string" || typeof src[k] === "number") params[k] = cleanStr(src[k], k === "nr" ? 12 : 120);
  return { key: s.key, params };
}

/** Eingaben des Clients prüfen und kürzen (Route, Titel, Datensatz-IDs, Bearbeitungsstatus). */
export function cleanPresence(b) {
  const route = typeof b.route === "string" && ROUTE_RE.test(b.route) ? b.route : "";
  const title = String(b.title ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  const recordId = typeof b.recordId === "string" && ID_RE.test(b.recordId) ? b.recordId : "";
  const relatedIds = Array.isArray(b.relatedIds) ? b.relatedIds.filter((x) => typeof x === "string" && ID_RE.test(x)).slice(0, 4) : [];
  const spec = cleanSpec(b.spec);
  return { route, title, recordId, relatedIds, editing: b.editing === true, ...(spec ? { spec } : {}) };
}

export async function heartbeat(store, uid, body, nowMs) {
  const entry = { ...cleanPresence(body), at: new Date(nowMs).toISOString() };
  await mutateDoc(store, PRESENCE_KEY, (doc) => {
    const cur = doc?.users && typeof doc.users === "object" && !Array.isArray(doc.users) ? doc.users : {};
    const prev = cur[uid];
    if (prev && nowMs - Date.parse(prev.at) < DEDUPE_MS && JSON.stringify({ ...prev, at: 0 }) === JSON.stringify({ ...entry, at: 0 })) return undefined;
    const users = {};
    for (const [k, v] of Object.entries(cur)) if (v && typeof v === "object" && nowMs - Date.parse(v.at) < KEEP_MS) users[k] = v;
    users[uid] = entry;
    return { users };
  });
}

/**
 * @param members  Benutzer, die im Team angezeigt werden dürfen (aktive Mitglieder + ggf. der eingetretene Superadmin)
 * @returns {{now:string, presence:object[], lastSeen:object}}  presence = Online-Benutzer (letzte 2 Minuten); lastSeen = uid → letzter Zeitpunkt (nur Zeitstempel)
 */
export async function readPresence(store, members, nowMs) {
  const doc = (await store.read(PRESENCE_KEY))?.value;
  const rows = doc?.users && typeof doc.users === "object" ? doc.users : {};
  const presence = [];
  const lastSeen = {};
  for (const u of members) {
    const e = rows[u.id];
    if (!e || typeof e !== "object") continue;
    lastSeen[u.id] = e.at;
    if (nowMs - Date.parse(e.at) > ONLINE_MS) continue;
    presence.push({
      uid: u.id, displayName: u.displayName, role: u.role, ownerKey: u.ownerKey || "", superadmin: u.role === "superadmin",
      at: e.at, route: e.route, title: e.title, recordId: e.recordId, relatedIds: e.relatedIds || [], editing: Boolean(e.editing),
      ...(e.spec ? { spec: e.spec } : {}),
    });
  }
  return { now: new Date(nowMs).toISOString(), presence, lastSeen };
}
