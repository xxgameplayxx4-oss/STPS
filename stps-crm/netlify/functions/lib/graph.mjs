// STPS CRM – Microsoft Graph (App-only, Client-Credentials) für Dateien in SharePoint.
//
// Env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SP_SITE (z. B. «contoso.sharepoint.com:/sites/STPS»),
//      optional SP_DRIVE (Name der Dokumentbibliothek; Standard: die Standardbibliothek der Site).
// Nutzt das globale fetch; für Tests ist `fetch` (und Uhr/Wartefunktion) injizierbar.
import { createHash } from "node:crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";
const SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_MARGIN_MS = 2 * 60 * 1000; // Token 2 Minuten vor Ablauf erneuern
const SITE_CACHE_MS = 10 * 60 * 1000;
export const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024; // darüber: createUploadSession
export const UPLOAD_CHUNK = 10 * 320 * 1024; // Vielfaches von 320 KiB (Vorgabe von Graph)

export const BASE_VARS = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SP_SITE"];

/** Fehlende Variablen aus `names` (leer/nur Leerzeichen = fehlt). */
export const missingVars = (env, names = BASE_VARS) => names.filter((n) => !String(env?.[n] ?? "").trim());

export class GraphError extends Error {
  /** kind: config | auth | permission | not_found | locked | throttled | network | too_large | other */
  constructor(message, { kind = "other", status = 0, code = "" } = {}) {
    super(message);
    this.name = "GraphError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Entfernt Geheimnisse aus Texten, die geloggt oder gespeichert werden. */
export function redact(text, env) {
  let s = String(text ?? "");
  for (const k of ["MS_CLIENT_SECRET"]) {
    const v = String(env?.[k] ?? "").trim();
    if (v.length >= 4) s = s.split(v).join("***");
  }
  return s;
}

// ---------------------------------------------------------------- Fehler → deutsche Meldungen

const PERMISSION_MSG = "Keine Berechtigung – App-Berechtigung/Admin-Zustimmung prüfen";

/** Meldung für eine fehlgeschlagene Graph-Anfrage. ctx: kurze Beschreibung, was angefragt wurde (Pfad, Site, …). */
export function describeGraphError(status, body, ctx = "") {
  const code = String(body?.error?.code || "");
  if (status === 401 || status === 403) return new GraphError(PERMISSION_MSG, { kind: "permission", status, code });
  if (status === 404) return new GraphError(`Datei/Site nicht gefunden: ${ctx || "angefragte Ressource"}`, { kind: "not_found", status, code });
  if (status === 423 || (status === 409 && /lock|checkedOut|resourceLocked/i.test(code))) {
    return new GraphError(`Datei ist gesperrt oder ausgecheckt${ctx ? ` (${ctx})` : ""} – bitte in SharePoint schliessen/einchecken und erneut versuchen`, { kind: "locked", status, code });
  }
  if (status === 409) return new GraphError(`Konflikt in SharePoint${ctx ? ` (${ctx})` : ""}${code ? `: ${code}` : ""} – bitte erneut versuchen`, { kind: "other", status, code });
  if (status === 413 || status === 507) return new GraphError(`Datei zu gross oder Speicher in SharePoint voll (HTTP ${status})`, { kind: "too_large", status, code });
  if (status === 429 || status === 503 || status === 504 || status === 502) {
    return new GraphError(`Microsoft ist gerade überlastet oder nicht erreichbar (HTTP ${status}) – bitte später erneut versuchen`, { kind: "throttled", status, code });
  }
  if (status === 400) return new GraphError(`Ungültige Anfrage an Microsoft Graph${ctx ? ` (${ctx})` : ""}${code ? `: ${code}` : ""} – Einstellungen (SP_*) prüfen`, { kind: "other", status, code });
  return new GraphError(`Microsoft Graph meldet einen Fehler (HTTP ${status}${code ? `, ${code}` : ""})`, { kind: "other", status, code });
}

function describeTokenError(status, body) {
  const desc = String(body?.error_description || "");
  const aadsts = /AADSTS(\d+)/.exec(desc)?.[1] || "";
  const base = "Anmeldung bei Microsoft fehlgeschlagen: ";
  const opts = { kind: "auth", status, code: aadsts ? `AADSTS${aadsts}` : String(body?.error || "") };
  switch (aadsts) {
    case "7000215": return new GraphError(`${base}Client-Secret ungültig – MS_CLIENT_SECRET muss der Secret-Wert sein (nicht die Secret-ID).`, opts);
    case "7000222": return new GraphError(`${base}Client-Secret abgelaufen – in Entra ein neues Secret erstellen und MS_CLIENT_SECRET ersetzen.`, opts);
    case "700016": return new GraphError(`${base}App nicht gefunden – MS_CLIENT_ID prüfen (Anwendungs-/Client-ID der App-Registrierung, richtiger Mandant?).`, opts);
    case "90002": case "900023": case "50059": return new GraphError(`${base}Mandant nicht gefunden – MS_TENANT_ID prüfen.`, opts);
    default: return new GraphError(`${base}${body?.error ? String(body.error) : `HTTP ${status}`}${aadsts ? ` (AADSTS${aadsts})` : ""} – MS_TENANT_ID, MS_CLIENT_ID und MS_CLIENT_SECRET prüfen.`, opts);
  }
}

// ---------------------------------------------------------------- Pfade

/** Pfad innerhalb der Dokumentbibliothek normalisieren: «CRM\Export/» → «CRM/Export». */
export function cleanPath(p, what = "Pfad") {
  const parts = String(p ?? "").replace(/\\/g, "/").split("/").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new GraphError(`${what} ist leer`, { kind: "config" });
  if (parts.some((x) => x === "." || x === "..")) throw new GraphError(`${what} darf «.» und «..» nicht enthalten`, { kind: "config" });
  return parts.join("/");
}

export const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/** SP_SITE → Graph-Ausdruck: «contoso.sharepoint.com:/sites/STPS» (auch die volle Adresse https://… wird akzeptiert). */
export function siteRef(raw) {
  let s = String(raw ?? "").trim();
  const url = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(s);
  if (url) s = `${url[1]}:${url[2].replace(/\/+$/, "")}`;
  s = s.replace(/:+$/, "");
  const i = s.indexOf(":");
  const host = (i < 0 ? s : s.slice(0, i)).trim();
  const path = i < 0 ? "" : s.slice(i + 1).trim();
  if (!host) throw new GraphError("SP_SITE ist leer", { kind: "config" });
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new GraphError("SP_SITE ungültig – erwartet z. B. contoso.sharepoint.com:/sites/STPS", { kind: "config" });
  const p = path.replace(/^\/+|\/+$/g, "");
  return p ? `${host}:/${encodePath(p)}` : host;
}

// ---------------------------------------------------------------- Cache (Modul-Ebene: überlebt mehrere Aufrufe derselben Function-Instanz)

const tokenCache = new Map(); // key -> { token, expiresAt }
const tokenInflight = new Map();
const siteCache = new Map(); // key -> { value, exp }

export function clearGraphCache() {
  tokenCache.clear();
  tokenInflight.clear();
  siteCache.clear();
}

const sha = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- Client

/**
 * @param env   Umgebungsvariablen (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SP_SITE, SP_DRIVE)
 * @param opts  { fetch?, now?: () => number, sleep?: (ms) => Promise<void> }
 */
export function createGraphClient(env, opts = {}) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const missing = missingVars(env);
  if (missing.length) throw new GraphError(`SharePoint ist nicht eingerichtet – es fehlen: ${missing.join(", ")}`, { kind: "config" });
  const tenant = String(env.MS_TENANT_ID).trim();
  const clientId = String(env.MS_CLIENT_ID).trim();
  const secret = String(env.MS_CLIENT_SECRET).trim();
  const siteRaw = String(env.SP_SITE).trim();
  const driveName = String(env.SP_DRIVE ?? "").trim();
  if (!/^[A-Za-z0-9.-]+$/.test(tenant)) throw new GraphError("MS_TENANT_ID ungültig (Verzeichnis-/Mandanten-ID erwartet)", { kind: "config" });
  const tokenKey = `${tenant}|${clientId}|${sha(secret)}`;

  const send = async (url, init) => {
    try {
      return await doFetch(url, init);
    } catch (err) {
      throw new GraphError("Microsoft Graph ist nicht erreichbar (Netzwerkfehler) – bitte später erneut versuchen", { kind: "network", code: String(err?.cause?.code || err?.code || "") });
    }
  };

  async function getToken(force = false) {
    const hit = tokenCache.get(tokenKey);
    if (!force && hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit.token;
    if (!force && tokenInflight.has(tokenKey)) return tokenInflight.get(tokenKey);
    const p = (async () => {
      const res = await send(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: SCOPE, grant_type: "client_credentials" }).toString(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.access_token) throw describeTokenError(res.status, body);
      tokenCache.set(tokenKey, { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000 });
      return body.access_token;
    })();
    tokenInflight.set(tokenKey, p);
    try { return await p; } finally { tokenInflight.delete(tokenKey); }
  }

  /** Graph-Aufruf mit Token, einem Wiederholungsversuch bei 401 (Token erneuern) sowie 429/5xx (Retry-After). */
  async function call(method, url, { body, headers, ctx, okStatus } = {}) {
    let forced = false;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(forced);
      forced = false;
      const res = await send(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });
      if (res.ok || (okStatus && okStatus.includes(res.status))) return res;
      if (res.status === 401 && attempt === 0) { tokenCache.delete(tokenKey); forced = true; continue; }
      if ([429, 503, 504].includes(res.status) && attempt < 2) {
        const wait = Math.min(Math.max(Number(res.headers?.get?.("retry-after")) || 1, 1), 5) * 1000;
        await sleep(wait);
        continue;
      }
      const json = await res.json().catch(() => null);
      throw describeGraphError(res.status, json, ctx);
    }
  }

  const callJson = async (method, url, o = {}) => {
    const res = await call(method, url, o);
    return res.status === 204 ? null : res.json().catch(() => null);
  };

  /** Site und Dokumentbibliothek auflösen (zwischengespeichert) */
  async function resolve() {
    const key = `${tokenKey}|${siteRaw}|${driveName}`;
    const hit = siteCache.get(key);
    if (hit && hit.exp > now()) return hit.value;
    const site = await callJson("GET", `${GRAPH}/sites/${siteRef(siteRaw)}`, { ctx: `Site «${siteRaw}» (SP_SITE prüfen)` });
    if (!site?.id) throw new GraphError("Unerwartete Antwort von Microsoft Graph (Site ohne ID)", { kind: "other" });
    let drive;
    if (driveName) {
      const list = await callJson("GET", `${GRAPH}/sites/${encodeURIComponent(site.id)}/drives?$select=id,name,webUrl`, { ctx: `Dokumentbibliotheken der Site «${siteRaw}»` });
      const drives = list?.value ?? [];
      drive = drives.find((d) => d.name === driveName) ?? drives.find((d) => String(d.name).toLowerCase() === driveName.toLowerCase());
      if (!drive) {
        throw new GraphError(`Datei/Site nicht gefunden: Dokumentbibliothek «${driveName}» (SP_DRIVE)${drives.length ? ` – vorhanden: ${drives.map((d) => `«${d.name}»`).join(", ")}` : ""}`, { kind: "not_found", status: 404 });
      }
    } else {
      drive = await callJson("GET", `${GRAPH}/sites/${encodeURIComponent(site.id)}/drive?$select=id,name,webUrl`, { ctx: `Standard-Dokumentbibliothek der Site «${siteRaw}»` });
      if (!drive?.id) throw new GraphError("Unerwartete Antwort von Microsoft Graph (Bibliothek ohne ID)", { kind: "other" });
    }
    const value = { siteId: site.id, siteName: site.displayName || site.name || "", siteUrl: site.webUrl || "", driveId: drive.id, driveName: drive.name || "", driveUrl: drive.webUrl || "" };
    siteCache.set(key, { value, exp: now() + SITE_CACHE_MS });
    return value;
  }

  const itemUrl = (driveId, path) => `${GRAPH}/drives/${encodeURIComponent(driveId)}/root:/${encodePath(path)}`;

  /** Metadaten einer Datei/eines Ordners; null, wenn nicht vorhanden. */
  async function getItem(path) {
    const p = cleanPath(path);
    const { driveId } = await resolve();
    const res = await call("GET", `${itemUrl(driveId, p)}?$select=id,name,size,lastModifiedDateTime,webUrl,folder,file`, { ctx: `«${p}»`, okStatus: [404] });
    if (res.status === 404) return null;
    return res.json();
  }

  /** Dateiinhalt laden (Graph antwortet mit einer Weiterleitung auf eine vorab signierte Adresse; fetch folgt ihr). */
  async function download(path) {
    const p = cleanPath(path);
    const { driveId } = await resolve();
    const res = await call("GET", `${itemUrl(driveId, p)}:/content`, { ctx: `«${p}»` });
    return Buffer.from(await res.arrayBuffer());
  }

  /** Ordner (inkl. Zwischenordner) anlegen, falls nicht vorhanden. */
  async function ensureFolder(folder) {
    const p = cleanPath(folder, "Ordnerpfad");
    const { driveId } = await resolve();
    const parts = p.split("/");
    for (let i = 0; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join("/");
      const res = await call("GET", `${itemUrl(driveId, sub)}?$select=id,folder`, { ctx: `Ordner «${sub}»`, okStatus: [404] });
      if (res.status !== 404) continue;
      const parent = parts.slice(0, i).join("/");
      const url = parent ? `${itemUrl(driveId, parent)}:/children` : `${GRAPH}/drives/${encodeURIComponent(driveId)}/root/children`;
      await call("POST", url, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: parts[i], folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
        ctx: `Ordner «${sub}» anlegen`,
        okStatus: [409], // existiert inzwischen (gleichzeitig angelegt)
      });
    }
  }

  async function uploadSession(driveId, p, buf, retried = false) {
    const res = await call("POST", `${itemUrl(driveId, p)}:/createUploadSession`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
      ctx: `«${p}»`,
      okStatus: retried ? [] : [404],
    });
    if (res.status === 404) {
      const parent = p.split("/").slice(0, -1).join("/");
      if (!parent) throw describeGraphError(404, null, `«${p}»`);
      await ensureFolder(parent);
      return uploadSession(driveId, p, buf, true);
    }
    const { uploadUrl } = await res.json();
    if (!uploadUrl) throw new GraphError("Unerwartete Antwort von Microsoft Graph (keine Upload-Adresse)", { kind: "other" });
    let last = null;
    for (let start = 0; start < buf.length; start += UPLOAD_CHUNK) {
      const end = Math.min(start + UPLOAD_CHUNK, buf.length) - 1;
      // Die Upload-Adresse ist vorab autorisiert: kein Authorization-Header.
      const r = await send(uploadUrl, { method: "PUT", headers: { "content-range": `bytes ${start}-${end}/${buf.length}`, "content-type": "application/octet-stream" }, body: buf.subarray(start, end + 1) });
      if (!r.ok && r.status !== 202) throw describeGraphError(r.status, await r.json().catch(() => null), `«${p}»`);
      last = r;
    }
    return last ? last.json().catch(() => null) : null;
  }

  /**
   * Datei hochladen und eine vorhandene gleichen Namens ersetzen.
   * Annahme: Beim Hochladen per PUT auf einen Pfad legt SharePoint fehlende Zwischenordner selbst an;
   * falls Graph stattdessen 404 meldet, werden die Ordner angelegt und der Upload einmal wiederholt.
   */
  async function upload(path, data, contentType = "application/octet-stream") {
    const p = cleanPath(path);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const { driveId } = await resolve();
    if (buf.length > SIMPLE_UPLOAD_MAX) return uploadSession(driveId, p, buf);
    const url = `${itemUrl(driveId, p)}:/content?@microsoft.graph.conflictBehavior=replace`;
    const put = () => call("PUT", url, { headers: { "content-type": contentType }, body: buf, ctx: `«${p}»`, okStatus: [404] });
    let res = await put();
    if (res.status === 404) {
      const parent = p.split("/").slice(0, -1).join("/");
      if (parent) {
        await ensureFolder(parent); // Zwischenordner fehlen → anlegen und einmal wiederholen
        res = await put();
      }
      if (res.status === 404) throw describeGraphError(404, await res.json().catch(() => null), `«${p}»`);
    }
    return res.json().catch(() => null);
  }

  return { getToken, resolve, getItem, download, upload, ensureFolder, config: { site: siteRaw, drive: driveName } };
}
