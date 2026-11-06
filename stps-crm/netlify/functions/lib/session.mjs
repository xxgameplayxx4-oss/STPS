// STPS CRM – Sitzungs-Token: HMAC-signiert, enthält nur Benutzer-ID, Token-Version und Ablauf.
// Ob der Benutzer noch aktiv ist und die Token-Version stimmt, prüft accounts.mjs bei JEDER Anfrage
// (Deaktivieren oder Passwort-Reset macht alte Token sofort ungültig).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_SECRET_LENGTH = 16;
const PREFIX = "v2";
const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** CRM_SECRET ist Pflicht (kein Ableiten aus Passwörtern mehr). null = nicht oder zu schwach konfiguriert. */
export function getSecret(env) {
  const s = String(env?.CRM_SECRET ?? "");
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

function sign(payloadB64, secret) {
  const key = createHmac("sha256", secret).update("stps-crm/session/v2").digest();
  return b64u(createHmac("sha256", key).update(`${PREFIX}.${payloadB64}`).digest());
}

export function createSessionToken(env, user, now = Date.now(), ttl = SESSION_TTL_MS) {
  const secret = getSecret(env);
  if (!secret) throw new Error("CRM_SECRET fehlt");
  const payload = b64u(JSON.stringify({ uid: user.id, tv: user.tokenVersion ?? 0, exp: now + ttl }));
  return `${PREFIX}.${payload}.${sign(payload, secret)}`;
}

/** @returns {{uid:string, tv:number, exp:number}|null} */
export function verifySessionToken(token, env, now = Date.now()) {
  const secret = getSecret(env);
  if (!secret || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = Buffer.from(sign(parts[1], secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof p.uid !== "string" || !Number.isInteger(p.tv) || typeof p.exp !== "number" || p.exp <= now) return null;
    return { uid: p.uid, tv: p.tv, exp: p.exp };
  } catch {
    return null;
  }
}
