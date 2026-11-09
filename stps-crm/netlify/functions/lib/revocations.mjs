// STPS CRM – Widerruf einzelner Sitzungen (Abmelden): Die Sitzungs-ID (sid) des Tokens kommt bis zu seinem Ablauf in eine Liste im Store.
// authenticate() weist widerrufene Sitzungen ab. «Überall abmelden» (Token-Version) bleibt davon unabhängig.
import { mutateDoc } from "./kv.mjs";

export const REVOKE_KEY = "session-revocations";
const MAX_ENTRIES = 20000;
const caches = new WeakMap();
const invalidate = (store) => caches.delete(store);

/** Widerrufene Sitzungen {sid: ablaufMs}; höchstens `cacheMs` alt, eigene Widerrufe leeren den Zwischenspeicher sofort. */
export async function loadRevoked(store, { now = Date.now(), cacheMs = 5000 } = {}) {
  const c = caches.get(store);
  if (c && now >= c.at && now - c.at < cacheMs) return c.map;
  const doc = (await store.read(REVOKE_KEY))?.value;
  const map = doc && typeof doc.revoked === "object" && doc.revoked ? doc.revoked : {};
  caches.set(store, { at: now, map });
  return map;
}

export async function isRevoked(store, sid, opts) {
  if (!sid) return false;
  const map = await loadRevoked(store, opts);
  return Object.prototype.hasOwnProperty.call(map, sid);
}

/** Merkt die Sitzung bis `exp` (Ablauf des Tokens) als widerrufen; abgelaufene Einträge werden dabei entfernt. */
export async function revokeSession(store, sid, exp, now = Date.now()) {
  if (!sid || typeof exp !== "number") return;
  try {
    await mutateDoc(store, REVOKE_KEY, (doc) => {
      const out = {};
      for (const [k, e] of Object.entries(doc?.revoked ?? {})) if (typeof e === "number" && e > now) out[k] = e;
      out[sid] = exp;
      const keys = Object.keys(out);
      if (keys.length > MAX_ENTRIES) keys.sort((a, b) => out[a] - out[b]).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete out[k]);
      return { revoked: out };
    });
  } finally {
    invalidate(store);
  }
}
