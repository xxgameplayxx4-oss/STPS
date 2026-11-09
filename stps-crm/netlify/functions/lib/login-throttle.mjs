// STPS CRM – Schutz gegen Durchprobieren von Passwörtern (Blob «login-throttle»).
//
// Harte Sperre (429, auch mit richtigem Passwort) gilt nur je IP-Adresse:
//   «ipu:<ip>|<benutzer>»  nach MAX_FAILS Fehlversuchen dieser IP für diesen Benutzernamen,
//   «ip:<ip>»              nach MAX_IP_FAILS Fehlversuchen dieser IP insgesamt (z. B. Durchprobieren vieler Benutzernamen).
// Ein fremder Angreifer kann so den echten Benutzer NICHT aussperren: Je Benutzername gibt es nur eine weiche Bremse («u:<benutzer>»):
// eine wachsende Wartezeit vor der Prüfung (ab SOFT_FREE Fehlversuchen im Zeitfenster, höchstens SOFT_MAX_MS), nie eine Sperre.
// Ohne bekannte IP (falsch konfigurierter Proxy, siehe TRUST_PROXY) gibt es nur die weiche Bremse.
// Andere Schlüssel (z. B. «pw:<benutzer>» beim Passwortwechsel) sperren nach MAX_FAILS.
import { mutateDoc } from "./kv.mjs";

export const THROTTLE_KEY = "login-throttle";
export const MAX_FAILS = 5;
export const MAX_IP_FAILS = 30;
export const LOCK_MS = 15 * 60 * 1000;
export const WINDOW_MS = 15 * 60 * 1000;
export const SOFT_FREE = 3;
export const SOFT_BASE_MS = 500;
export const SOFT_MAX_MS = 5000;
const MAX_ENTRIES = 2000;

const limitOf = (k) => (k.startsWith("u:") ? Infinity : k.startsWith("ip:") ? MAX_IP_FAILS : MAX_FAILS);

/** Schlüssel der Fehlversuche einer Anmeldung: harte Schlüssel (nur mit bekannter IP) + weicher Schlüssel je Benutzername. */
export const throttleKeys = (username, ip) => {
  const known = ip && ip !== "unknown";
  return { hard: known ? [`ipu:${ip}|${username}`, `ip:${ip}`] : [], soft: `u:${username}` };
};

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
      entries[k] = { count, first, until: count >= limitOf(k) ? (e && e.until > now ? e.until : now + LOCK_MS) : 0 };
    }
    return { entries };
  });
}

/** Wartezeit (ms) vor der Prüfung eines Versuchs für diesen Benutzernamen: 0 bis SOFT_FREE-1 Fehlversuche, danach 500, 1000, 2000 … höchstens SOFT_MAX_MS. */
export async function softDelayMs(store, username, now) {
  const e = (await store.read(THROTTLE_KEY))?.value?.entries?.[`u:${username}`];
  if (!e || now - e.first > WINDOW_MS || e.count < SOFT_FREE) return 0;
  return Math.min(SOFT_MAX_MS, SOFT_BASE_MS * 2 ** (e.count - SOFT_FREE));
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
