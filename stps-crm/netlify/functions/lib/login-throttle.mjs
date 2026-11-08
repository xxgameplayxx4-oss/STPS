// STPS CRM – Schutz gegen Durchprobieren von Passwörtern: Fehlversuche pro Benutzername und pro IP im Blob «login-throttle».
// Nach MAX_FAILS Fehlversuchen innerhalb von WINDOW_MS ist der Schlüssel LOCK_MS lang gesperrt (auch mit richtigem Passwort).
import { mutateDoc } from "./kv.mjs";

export const THROTTLE_KEY = "login-throttle";
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 2000;

// Ohne bekannte IP nur pro Benutzername (nie ein gemeinsamer «unknown»-Topf, der alle aussperren würde)
export const throttleKeys = (username, ip) => (ip && ip !== "unknown" ? [`u:${username}`, `ip:${ip}`] : [`u:${username}`]);

/** @returns {{locked:boolean, retryAfterMs:number}} */
export async function checkLock(store, keys, now) {
  const doc = (await store.read(THROTTLE_KEY))?.value;
  let until = 0;
  for (const k of keys) {
    const e = doc?.entries?.[k];
    if (e && e.until > now) until = Math.max(until, e.until);
  }
  return until > now ? { locked: true, retryAfterMs: until - now } : { locked: false, retryAfterMs: 0 };
}

function prune(entries, now) {
  const out = {};
  for (const [k, e] of Object.entries(entries)) if (e.until > now || now - e.first <= WINDOW_MS) out[k] = e;
  // Überlauf: gesperrte Einträge werden NIE verdrängt (sonst hebt Fluten mit Zufallsnamen Sperren auf);
  // von den übrigen zuerst die mit den wenigsten Fehlversuchen/ältesten, damit laufende Zählungen länger überleben.
  const keys = Object.keys(out);
  if (keys.length > MAX_ENTRIES) {
    keys.filter((k) => !(out[k].until > now))
      .sort((a, b) => out[a].count - out[b].count || out[a].first - out[b].first)
      .slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete out[k]);
  }
  return out;
}

export async function recordFailure(store, keys, now) {
  await mutateDoc(store, THROTTLE_KEY, (doc) => {
    const entries = prune({ ...(doc?.entries || {}) }, now);
    for (const k of keys) {
      const e = entries[k];
      const fresh = !e || (e.until <= now && now - e.first > WINDOW_MS);
      const count = fresh ? 1 : e.until > now ? e.count : e.count + 1;
      const first = fresh ? now : e.first;
      entries[k] = { count, first, until: count >= MAX_FAILS ? (e && e.until > now ? e.until : now + LOCK_MS) : 0 };
    }
    return { entries };
  });
}

export async function clearFailures(store, keys, now) {
  await mutateDoc(store, THROTTLE_KEY, (doc) => {
    if (!doc?.entries || !keys.some((k) => doc.entries[k])) return undefined;
    const entries = prune({ ...doc.entries }, now);
    for (const k of keys) delete entries[k];
    return { entries };
  });
}

export const lockMessage = (retryAfterMs) => {
  const min = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `Zu viele Fehlversuche. Bitte in ${min} ${min === 1 ? "Minute" : "Minuten"} erneut versuchen.`;
};
