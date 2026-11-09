// STPS CRM – kleine HTTP-Hilfen für die Konto-/Team-Module (Fehlerklasse, Header, JSON-Body).

/** Wird von den Modulen geworfen und in accounts.mjs zu {status, body} umgewandelt. */
export class ApiFail extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const fail = (status, code, message, extra) => new ApiFail(status, code, message, extra);

export const json = (status, body) => ({ status, body });

/** Antwort um Set-Cookie-Zeilen ergänzen (api.mjs setzt sie als Header). */
export const withCookies = (res, cookies) => (cookies?.length ? { ...res, setCookie: [...(res.setCookie ?? []), ...cookies] } : res);

/**
 * Den echten Fehler samt Stack in die Function-Logs schreiben (Netlify zeigt console.error im Function-Log).
 * `where` sagt, wo es passiert ist (kein Token, keine Passwörter hineinschreiben). Wirft nie selbst.
 */
export function logError(where, err, extra) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const cause = e.cause instanceof Error ? e.cause : null;
    // e.stack beginnt mit «Name: Meldung» und enthält die Aufrufkette
    console.error(`[stps-crm] ${where}${extra ? ` ${JSON.stringify(extra)}` : ""}\n${e.stack || `${e.name}: ${e.message}`}${cause ? `\nUrsache: ${cause.stack || cause.message}` : ""}`);
  } catch { /* Protokollieren darf nie selbst scheitern */ }
}

export const headerOf = (headers, name) =>
  (typeof headers?.get === "function" ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) || "";

/** Bearer-Token aus dem Authorization-Header ("" wenn keines) */
export function bearerToken(headers) {
  const h = headerOf(headers, "authorization");
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------- Sitzungs-Cookie
// Das Sitzungs-Token liegt in einem HttpOnly-Cookie (für JavaScript unlesbar): SameSite=Strict, Path=/, Secure ausser bei http auf localhost
// (und im Entwicklungsmodus). Mit Secure heisst es «__Host-stps_session» (Browser erzwingt Secure, Path=/, kein Domain-Attribut).
export const COOKIE_SECURE_NAME = "__Host-stps_session";
export const COOKIE_PLAIN_NAME = "stps_session";
/** CSRF-Schutz: Cookie-authentifizierte, ändernde Anfragen müssen diesen Header tragen (Fremdseiten können ihn ohne CORS-Freigabe nicht setzen). */
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "stps-crm";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
/** Darf das Cookie ohne Secure gesetzt werden? Nur bei http auf localhost/127.0.0.1 (oder im Entwicklungsmodus). */
export function cookieSecure(origin, { dev = false } = {}) {
  let u;
  try { u = new URL(String(origin || "")); } catch { return true; }
  if (u.protocol !== "http:") return true;
  return !(dev || LOOPBACK.test(u.hostname));
}

export function sessionCookie(token, { origin, dev = false, maxAgeSec }) {
  const secure = cookieSecure(origin, { dev });
  return `${secure ? COOKIE_SECURE_NAME : COOKIE_PLAIN_NAME}=${token}; Max-Age=${Math.floor(maxAgeSec)}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Cookies, die die Sitzung beim Browser löschen (beide Namen). */
export const clearSessionCookies = () => [
  `${COOKIE_SECURE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict; Secure`,
  `${COOKIE_PLAIN_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`,
];

/** Token aus dem Sitzungs-Cookie ("" wenn keines). Der Name ohne __Host- gilt nur bei http auf localhost/Entwicklungsmodus (sonst könnte ihn eine Nachbar-Subdomain setzen). */
export function cookieToken(headers, { origin, dev = false } = {}) {
  const name = cookieSecure(origin, { dev }) ? COOKIE_SECURE_NAME : COOKIE_PLAIN_NAME;
  for (const part of String(headerOf(headers, "cookie")).split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/**
 * Darf diese Anfrage ändern (CSRF-Schutz)? Sichere Methoden immer. Sonst: entweder Authorization-Bearer (Skripte; Fremdseiten können den Header nicht setzen)
 * oder der Header X-Requested-With: stps-crm, den das Frontend immer sendet.
 */
export function csrfOk(method, headers) {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  if (bearerToken(headers)) return true;
  return String(headerOf(headers, CSRF_HEADER)).trim() === CSRF_VALUE;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;
const ipOf = (v) => { const t = String(v || "").trim(); return IP_RE.test(t) ? t.toLowerCase() : ""; };

/**
 * IP-Adresse des Clients oder "" (unbekannt – Aufrufer darf dann NICHT in einen gemeinsamen Topf fallen).
 * TRUST_PROXY=1 (VPS hinter nginx): nur X-Real-IP bzw. erster X-Forwarded-For-Eintrag, die nginx selbst setzt; der Netlify-Header wird ignoriert (fälschbar).
 * Sonst (Netlify): nur x-nf-client-connection-ip.
 */
export function clientIp(headers, env = typeof process !== "undefined" ? process.env : {}) {
  if (String(env?.TRUST_PROXY ?? "").trim() === "1") {
    return ipOf(headerOf(headers, "x-real-ip")) || ipOf(String(headerOf(headers, "x-forwarded-for")).split(",")[0]);
  }
  return ipOf(headerOf(headers, "x-nf-client-connection-ip"));
}

export function queryOf(req) {
  if (req.query instanceof URLSearchParams) return new URLSearchParams(req.query);
  if (req.query && typeof req.query === "object") return new URLSearchParams(req.query);
  if (typeof req.query === "string") return new URLSearchParams(req.query);
  const i = String(req.path || "").indexOf("?");
  return new URLSearchParams(i >= 0 ? String(req.path).slice(i + 1) : "");
}

/** JSON-Objekt aus dem Body; wirft 400/413. */
export function parseBody(req, maxBytes = 16 * 1024) {
  const text = req.bodyText || "";
  if (Buffer.byteLength(text) > maxBytes) throw fail(413, "too_large", "Anfrage zu gross");
  let v;
  try { v = JSON.parse(text || "{}"); } catch { throw fail(400, "bad_json", "Ungültige Anfrage"); }
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw fail(400, "bad_request", "Ungültige Anfrage");
  return v;
}

/** Entfernt Steuerzeichen, trimmt und kürzt. */
export const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
