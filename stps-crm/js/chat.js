// Team-Chat (Zustand + Abfrage im Hintergrund): Kanal «team» (alle) und «mgmt» (Geschäftsleitung), Nachrichten kommen von /api/chat.
//
// Abfrage-Takt: Chat-Seite offen und sichtbar → alle 5 s neue Nachrichten (since=<letzte ID>);
// sonst nur der Zähler «ungelesen» (peek) für das Menü-Zeichen: alle 30 s (Tab sichtbar) bzw. 90 s (Tab im Hintergrund).
// Nur im Servermodus mit Team-Kontext aktiv. Die Seite selbst steht in views/chat.js.
import * as api from "./api.js";
import * as store from "./store.js";
import { uid } from "./util.js";

const OPEN_MS = 5000;
const IDLE_MS = 30000;
const HIDDEN_MS = 90000;
const PAGE = 50;

export const MAX_TEXT = 2000;

const mk = () => ({
  messages: [], // aufsteigend nach ID
  lastId: 0, // letzte Nachricht auf dem Server
  cursor: 0, // bis hierhin ist alles geladen (Ausgangspunkt für since); eigene Nachrichten schieben ihn nicht vor, sonst gingen Antworten dazwischen verloren
  readId: 0,
  unread: 0,
  hasMore: false, // es gibt ältere Nachrichten als die geladenen
  loaded: false,
  error: "",
  open: false, // Chat-Seite ist gerade angezeigt (gilt nur für den angezeigten Kanal)
  fromBottom: 0, // Abstand der Liste zum Ende (px), damit ein Neuzeichnen die Position behält
  draft: "", // nicht gesendeter Text (bleibt beim Neuzeichnen der Seite erhalten)
});

// Kanäle: «team» = ganzes Team, «mgmt» = Geschäftsleitung (Team-Admins + Benutzer mit Management-Kennzeichen; der Server prüft das bei jeder Anfrage).
export const CHANNELS = ["team", "mgmt"];
export const channels = { team: mk(), mgmt: mk() };
/** Angezeigter Kanal und sein Zustand (Live-Bindung: Ansichten lesen chat.st / chat.channel) */
export let channel = "team";
export let st = channels.team;
let pageOpen = false;
/** Kanäle, die dieses Konto laut Server sehen darf (nur Anzeige; erzwungen wird serverseitig) */
export let available = ["team"];

const myChannels = () => { const m = store.getMe(); return m && (m.role === "admin" || m.role === "superadmin" || m.management) ? ["team", "mgmt"] : ["team"]; };
export function setChannel(c) {
  if (!CHANNELS.includes(c) || !available.includes(c) || c === channel) return;
  st.open = false;
  channel = c;
  st = channels[c];
  st.open = pageOpen;
  st.fromBottom = 0;
  if (started) { if (st.lastId > st.cursor) st.loaded = false; poll(); }
  emit();
}

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { applyAppBadge(); for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } };

let started = false;
let timer = null;
let busy = false;
let again = false;
let marking = false;

const active = () => store.S.mode === "server" && !store.S.noTeam && Boolean(store.getMe());
const total = () => available.reduce((n, c) => n + channels[c].unread, 0);
export const unread = () => (active() ? total() : 0);
/** Ungelesene Nachrichten eines Kanals (für die Reiter) */
export const unreadOf = (c) => (active() && available.includes(c) ? channels[c].unread : 0);

/** Zähler am App-Symbol (installierte App), wo der Browser das kann */
function applyAppBadge() {
  try {
    if (!navigator.setAppBadge) return;
    if (total() > 0) navigator.setAppBadge(Math.min(total(), 99)); else navigator.clearAppBadge?.();
  } catch { /* nicht unterstützt */ }
}

function merge(list, s = st) {
  if (!list.length) return false;
  const byId = new Map(s.messages.map((m) => [m.id, m]));
  let added = false;
  for (const m of list) if (!byId.has(m.id)) { byId.set(m.id, m); added = true; }
  s.messages = [...byId.values()].sort((a, b) => a.id - b.id);
  return added;
}

function apply(s, r) {
  s.lastId = r.lastId;
  s.readId = r.readId;
  s.unread = r.unread;
  if (Array.isArray(r.channels)) available = r.channels.filter((c) => CHANNELS.includes(c));
}

const visible = () => !document.hidden;

function schedule(ms) {
  clearTimeout(timer);
  if (!started) return;
  timer = setTimeout(() => poll(), ms ?? (st.open && visible() ? OPEN_MS : visible() ? IDLE_MS : HIDDEN_MS));
}

/** Einen Kanal abfragen: der angezeigte (Seite offen) lädt Nachrichten, die übrigen nur den Zähler «ungelesen» */
async function pollChannel(c) {
  const s = channels[c];
  const q = { channel: c };
  if (s.open && !s.loaded) {
    const r = await api.chatList({ ...q, limit: PAGE });
    s.messages = r.messages;
    s.hasMore = r.hasMore;
    s.loaded = true;
    s.cursor = r.lastId;
    apply(s, r);
  } else if (s.open && s.loaded) {
    const r = await api.chatList({ ...q, since: s.cursor, limit: 100 });
    if (r.gap) { s.messages = r.messages; s.hasMore = r.hasMore; } else merge(r.messages, s);
    s.cursor = r.lastId;
    apply(s, r);
  } else {
    apply(s, await api.chatList({ ...q, peek: 1 }));
    if (s.loaded && s.lastId > s.cursor) s.loaded = false; // beim nächsten Öffnen frisch laden
  }
}

/** Einmal abfragen (und danach im passenden Takt weiter). Gleichzeitige Aufrufe werden zusammengelegt. */
export async function poll() {
  if (!started || !active()) { schedule(); return; }
  if (busy) { again = true; return; }
  busy = true;
  try {
    for (const c of [...available]) {
      try {
        await pollChannel(c);
      } catch (e) {
        if (c !== "team" && e?.status === 403) { // Zugang zum Kanal wurde entzogen
          available = available.filter((x) => x !== c);
          channels[c] = mk();
          if (channel === c) { channel = "team"; st = channels.team; st.open = pageOpen; st.loaded = false; }
          continue;
        }
        throw e;
      }
    }
    if (!available.includes(channel)) { channel = "team"; st = channels.team; st.open = pageOpen; st.loaded = false; } // Zugang entzogen
    for (const c of CHANNELS) channels[c].error = "";
    emit();
    if (st.open) markRead();
  } catch (e) {
    if (store.handleAuthError(e)) { busy = false; return; }
    st.error = e.message || "";
    emit();
  } finally {
    busy = false;
  }
  if (again) { again = false; schedule(300); return; }
  schedule();
}

/** Beim Start der Anwendung (Servermodus): Zähler laden und im Hintergrund aktuell halten */
export function start() {
  if (started || !active()) return;
  started = true;
  available = myChannels();
  document.addEventListener("visibilitychange", () => { if (visible()) poll(); else schedule(); });
  window.addEventListener("online", () => poll());
  poll();
}

/** Chat-Seite wurde geöffnet/geschlossen: sofort abfragen bzw. in den Hintergrund-Takt zurück */
export function setOpen(on) {
  if (on && !st.open) st.fromBottom = 0; // frisch geöffnet: ans Ende
  pageOpen = on;
  if (st.open === on) return;
  st.open = on;
  if (!started) return;
  if (on) { if (st.lastId > st.cursor) st.loaded = false; poll(); } else schedule();
}

/** Alles Geladene des angezeigten Kanals als gelesen melden (nur wenn die Seite offen und sichtbar ist) */
export async function markRead() {
  const s = st;
  const c = channel;
  const last = s.messages.at(-1)?.id ?? 0;
  if (marking || !s.open || !visible() || !last || (s.readId >= last && s.unread === 0)) return;
  marking = true;
  try {
    const r = await api.chatRead(last, c);
    s.readId = r.readId;
    s.unread = 0;
    emit();
  } catch (e) {
    store.handleAuthError(e);
  } finally {
    marking = false;
  }
}

/** Nachricht in den angezeigten Kanal senden. Wirft bei Fehler (Text bleibt dann im Eingabefeld). */
export async function send(text) {
  const s = st;
  const r = await api.chatSend(text, uid().replace(/-/g, "").slice(0, 24), channel);
  merge([r.message], s);
  s.lastId = Math.max(s.lastId, r.lastId);
  s.readId = Math.max(s.readId, r.message.id);
  if (s.loaded) schedule(400); // Antworten anderer, die zwischen den Nachrichten eingetroffen sind
  emit();
  return r.message;
}

/** Ältere Nachrichten nachladen */
export async function loadOlder() {
  const s = st;
  const first = s.messages[0]?.id;
  if (!first) return 0;
  const r = await api.chatList({ channel, before: first, limit: PAGE });
  merge(r.messages, s);
  s.hasMore = r.hasMore;
  emit();
  return r.messages.length;
}
