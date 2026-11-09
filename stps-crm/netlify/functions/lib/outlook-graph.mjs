// STPS CRM – Outlook-Kalender: Microsoft-Anmeldung (OAuth 2.0 Authorization-Code-Flow mit PKCE, delegiert) und Graph-Aufrufe im Namen
// eines Benutzers. Jeder Benutzer verbindet seinen EIGENEN Kalender; es gibt keine Anwendungsberechtigung für fremde Postfächer.
//
// Einrichtung: Client-ID aus OUTLOOK_CLIENT_ID / MS_CLIENT_ID, sonst aus der Plattform-Einstellung (vom Superadmin einmalig in der App eingetragen,
//      Blob «platform/outlook»). Ein Client-Secret ist OPTIONAL (OUTLOOK_CLIENT_SECRET / MS_CLIENT_SECRET, nur zusammen mit der Client-ID aus der
//      Umgebung): ohne Secret läuft der Code-Flow als öffentlicher Client (PKCE, Token-Abruf ohne client_secret). Mandant: MS_TENANT_ID bzw.
//      Einstellung, sonst «common» (Einstellung) bzw. «organizations» (Client-ID aus der Umgebung). Rückleit-Adresse /api/outlook/callback: APP_URL,
//      sonst (nur lokal, NICHT in Produktion/auf Netlify) die Adresse der Anfrage (origin), sonst SITE_URL/URL. In Produktion Pflicht: APP_URL bzw. Netlify-URL.
// Für Tests sind `fetch` und `sleep` injizierbar.
import { createHash, randomBytes } from "node:crypto";
import { GraphError } from "./graph.mjs";
import { isDeployedEnv } from "./runtime-env.mjs";

export const GRAPH_URL = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";
export const SCOPES = "offline_access Calendars.ReadWrite User.Read";
export const CALLBACK_PATH = "/api/outlook/callback";

const val = (env, ...names) => {
  for (const n of names) {
    const v = String(env?.[n] ?? "").trim();
    if (v) return v;
  }
  return "";
};

export const CLIENT_ID_RE = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
export const TENANT_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;

const httpsBase = (raw) => {
  const u = String(raw || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/.test(u) || /^http:\/\/localhost(?::\d+)?$/.test(u) ? u : "";
};

/**
 * Einrichtung aus Umgebung + Plattform-Einstellung. missing nennt die fehlenden Angaben ("clientId", "CRM_SECRET").
 * @param opts { setting?: {clientId, tenant}, origin?: string (Adresse der Anfrage) }
 * @returns {{configured, missing, clientId, source: "env"|"app"|"", secret, publicClient, tenant, base, redirectUri}}
 */
export function outlookConfig(env, opts = {}) {
  const envId = val(env, "OUTLOOK_CLIENT_ID", "MS_CLIENT_ID");
  const setId = String(opts.setting?.clientId ?? "").trim();
  const clientId = envId || (CLIENT_ID_RE.test(setId) ? setId : "");
  const source = envId ? "env" : clientId ? "app" : "";
  const secret = source === "env" ? val(env, "OUTLOOK_CLIENT_SECRET", "MS_CLIENT_SECRET") : ""; // das Secret gehört zur App der Umgebung, nie zu einer App-ID aus der Einstellung
  // Produktion (NODE_ENV=production / VPS) bzw. bereitgestellte Netlify-Site: die Rückleit-Adresse kommt NIE aus dem Host-Header der Anfrage
  // (sonst liesse sie sich per gefälschtem Host umlenken), sondern nur aus APP_URL bzw. der von Netlify gesetzten URL.
  const prod = isDeployedEnv(env);
  const base = prod
    ? httpsBase(val(env, "APP_URL")) || httpsBase(val(env, "SITE_URL", "URL"))
    : httpsBase(val(env, "APP_URL")) || httpsBase(opts.origin) || httpsBase(val(env, "SITE_URL", "URL"));
  const envTenant = val(env, "MS_TENANT_ID");
  const setTenant = String(opts.setting?.tenant ?? "").trim();
  const tenantRaw = (source === "env" ? envTenant : "") || (source === "app" ? setTenant : "") || (source === "app" ? "common" : "organizations");
  const tenant = TENANT_RE.test(tenantRaw) ? tenantRaw : source === "app" ? "common" : "organizations";
  const missing = [];
  if (!clientId) missing.push("clientId");
  if (String(env?.CRM_SECRET ?? "").length < 16) missing.push("CRM_SECRET");
  return { configured: missing.length === 0, missing, clientId, source, secret, publicClient: !secret, tenant, base, redirectUri: base ? base + CALLBACK_PATH : "", appUrlRequired: prod && !base };
}

/** Entfernt das Client-Secret aus Texten, die gespeichert oder angezeigt werden. */
export function redactSecret(text, env) {
  let s = String(text ?? "");
  const v = val(env, "OUTLOOK_CLIENT_SECRET", "MS_CLIENT_SECRET");
  if (v.length >= 4) s = s.split(v).join("***");
  return s;
}

// ---------------------------------------------------------------- PKCE und Anmelde-Adresse

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(cfg, { state, challenge, loginHint }) {
  const p = new URLSearchParams({
    client_id: cfg.clientId, response_type: "code", redirect_uri: cfg.redirectUri, response_mode: "query", scope: SCOPES,
    state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${LOGIN}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${p}`;
}

// ---------------------------------------------------------------- Token

function tokenError(status, body) {
  const aadsts = /AADSTS(\d+)/.exec(String(body?.error_description || ""))?.[1] || "";
  const err = String(body?.error || "");
  const opts = { status, code: aadsts ? `AADSTS${aadsts}` : err };
  // Zugriff widerrufen, Passwort geändert, Sitzung abgelaufen, Zustimmung zurückgezogen: der Benutzer muss sich neu verbinden
  if (["invalid_grant", "interaction_required", "consent_required", "login_required"].includes(err)) {
    return new GraphError("Die Verbindung zu Outlook wurde widerrufen oder ist abgelaufen – bitte erneut verbinden.", { kind: "revoked", ...opts });
  }
  if (aadsts === "7000218") return new GraphError("Die App ist nicht als öffentlicher Client eingerichtet – in Azure unter «Authentifizierung» «Öffentliche Clientflows zulassen» auf «Ja» stellen (oder ein Client-Secret hinterlegen).", { kind: "config", ...opts });
  if (aadsts === "700025") return new GraphError("Die App ist ein öffentlicher Client, es wurde aber ein Client-Secret mitgeschickt – OUTLOOK_CLIENT_SECRET entfernen oder die App als vertraulichen Client (Plattform «Web») registrieren.", { kind: "config", ...opts });
  if (aadsts === "50194") return new GraphError("Die App ist nur für einen Mandanten registriert – in Azure «Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten» wählen oder die Mandanten-ID eintragen.", { kind: "config", ...opts });
  if (aadsts === "7000215") return new GraphError("Client-Secret ungültig – OUTLOOK_CLIENT_SECRET muss der Secret-Wert sein (nicht die Secret-ID).", { kind: "config", ...opts });
  if (aadsts === "7000222") return new GraphError("Client-Secret abgelaufen – in Entra ein neues Secret erstellen.", { kind: "config", ...opts });
  if (aadsts === "700016") return new GraphError("App nicht gefunden – Client-ID (Anwendungs-ID) und Mandant prüfen.", { kind: "config", ...opts });
  if (aadsts === "50011") return new GraphError("Die Rückleit-Adresse stimmt nicht mit der App-Registrierung überein – /api/outlook/callback als Umleitungs-URI unter «Mobil- und Desktopanwendungen» eintragen.", { kind: "config", ...opts });
  if (aadsts === "65001" || aadsts === "90094" || aadsts === "65004") return new GraphError("Zustimmung fehlt – die Berechtigungen (Calendars.ReadWrite, User.Read, offline_access) müssen erteilt werden, ggf. durch einen Administrator.", { kind: "consent", ...opts });
  return new GraphError(`Anmeldung bei Microsoft fehlgeschlagen${err ? ` (${err}${aadsts ? `, AADSTS${aadsts}` : ""})` : ` (HTTP ${status})`}`, { kind: "auth", ...opts });
}

async function tokenRequest(cfg, params, deps) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  let res;
  try {
    res = await doFetch(`${LOGIN}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, ...(cfg.secret ? { client_secret: cfg.secret } : {}), scope: SCOPES, ...params }).toString(),
    });
  } catch {
    throw new GraphError("Microsoft ist nicht erreichbar (Netzwerkfehler) – bitte später erneut versuchen", { kind: "network" });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw tokenError(res.status, body);
  return { accessToken: body.access_token, refreshToken: body.refresh_token || "", expiresIn: Number(body.expires_in) || 3600 };
}

export const exchangeCode = (cfg, code, verifier, deps) =>
  tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verifier }, deps);
export const refreshAccess = (cfg, refreshToken, deps) => tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, deps);

// ---------------------------------------------------------------- Graph im Namen des Benutzers

export function graphFail(status, body, ctx = "") {
  const code = String(body?.error?.code || "");
  const o = { status, code };
  if (status === 401) return new GraphError("Microsoft hat den Zugriff abgelehnt – bitte Outlook erneut verbinden.", { kind: "auth", ...o });
  if (status === 403) return new GraphError("Keine Berechtigung für den Kalender – Zustimmung zu «Calendars.ReadWrite» fehlt oder wurde eingeschränkt; Outlook erneut verbinden bzw. Administrator fragen.", { kind: "permission", ...o });
  if (status === 404 && /MailboxNotEnabled|InvalidUser|MailboxNotFound|NoMailbox/i.test(code)) return new GraphError("Für dieses Konto gibt es kein Exchange-Online-Postfach (Lizenz prüfen).", { kind: "mailbox", ...o });
  if (status === 404) return new GraphError(`Nicht gefunden${ctx ? ` (${ctx})` : ""}`, { kind: "not_found", ...o });
  if (status === 410) return new GraphError("Der Synchronisierungsstand ist abgelaufen.", { kind: "gone", ...o });
  if ([429, 502, 503, 504].includes(status)) return new GraphError(`Microsoft ist gerade überlastet oder nicht erreichbar (HTTP ${status}) – bitte später erneut versuchen`, { kind: "throttled", ...o });
  return new GraphError(`Microsoft Graph meldet einen Fehler (HTTP ${status}${code ? `, ${code}` : ""})`, { kind: "other", ...o });
}

/** Graph-Client mit festem Zugriffstoken. Wiederholt 429/503/504 (Retry-After, höchstens 2×). `path` beginnt mit «/» oder ist eine volle Graph-Adresse. */
export function createUserGraph(accessToken, deps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  async function call(method, path, { body, headers, okStatus = [], ctx } = {}) {
    const url = /^https:\/\//.test(path) ? path : GRAPH_URL + path;
    if (!url.startsWith(GRAPH_URL + "/")) throw new GraphError("Ungültige Graph-Adresse", { kind: "other" });
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await doFetch(url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers, authorization: `Bearer ${accessToken}`, prefer: [headers?.prefer, 'IdType="ImmutableId"'].filter(Boolean).join(", ") }, body: body !== undefined ? JSON.stringify(body) : undefined });
      } catch {
        throw new GraphError("Microsoft Graph ist nicht erreichbar (Netzwerkfehler) – bitte später erneut versuchen", { kind: "network" });
      }
      if (res.ok || okStatus.includes(res.status)) return res;
      if ([429, 503, 504].includes(res.status) && attempt < 2) {
        await sleep(Math.min(Math.max(Number(res.headers?.get?.("retry-after")) || 1, 1), 5) * 1000);
        continue;
      }
      throw graphFail(res.status, await res.json().catch(() => null), ctx);
    }
  }
  const json = async (method, path, o) => {
    const res = await call(method, path, o);
    return res.status === 204 || res.status === 404 ? null : res.json().catch(() => null);
  };
  return { call, json };
}
