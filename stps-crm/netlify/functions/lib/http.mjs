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
