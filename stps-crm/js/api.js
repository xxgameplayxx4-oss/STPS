// Client für die Netlify Function unter /api (Anmeldung per HttpOnly-Cookie, siehe unten)
import { LS } from "./config.js";
import { t, errorText } from "./i18n.js";

/**
 * Fehler der API. Die Server-Antwort trägt einen stabilen Code (body.error); message wird beim Lesen in der aktuell gewählten
 * Sprache gebildet (unbekannter Code → Text des Servers). So bleibt eine gespeicherte Fehlermeldung beim Sprachwechsel korrekt.
 */
export class ApiError extends Error {
  constructor(status, body, message) {
    super(message || body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
    Object.defineProperty(this, "message", { configurable: true, get: () => message || errorText(body) || t("err.http", { status }) });
  }
}

/** Server nicht erreichbar bzw. kein JSON-API (statisch gehostet); message folgt der gewählten Sprache */
export class ApiUnavailable extends Error {
  constructor(key = "err.unreachable") {
    super(key);
    Object.defineProperty(this, "message", { configurable: true, get: () => t(key) });
  }
}

// Das Sitzungs-Token steckt in einem HttpOnly-Cookie, das der Server setzt (für JavaScript unlesbar). Hier liegt nur ein Merker «war angemeldet»
// (kein Geheimnis): er steuert den Offline-Start und den Abmelde-Knopf im Fehlerbildschirm. Ein früher gespeichertes Token wird entfernt.
try { localStorage.removeItem(LS.token); } catch { /* ignore */ }
export const hasSession = () => { try { return localStorage.getItem(LS.session) === "1"; } catch { return false; } };
export const setSession = (on) => { try { on ? localStorage.setItem(LS.session, "1") : localStorage.removeItem(LS.session); } catch { /* ignore */ } };

// Vom Superadmin «betretenes» Team (nur pro Browser-Tab). Der Server beachtet den Header nur für den Superadmin.
let teamMem = "";
export const getTeamId = () => { try { return sessionStorage.getItem(LS.team) || ""; } catch { return teamMem; } };
export const setTeamId = (id) => { teamMem = id || ""; try { id ? sessionStorage.setItem(LS.team, id) : sessionStorage.removeItem(LS.team); } catch { /* ignore */ } };

async function request(method, path, body, { auth = true, timeout = 20000, raw, binary = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(raw !== undefined ? { "content-type": "application/octet-stream" } : {}),
        "x-requested-with": "stps-crm", // CSRF-Schutz: der Server verlangt diesen Header bei ändernden Anfragen (das Cookie geht automatisch mit)
        ...(auth && getTeamId() ? { "x-crm-team": getTeamId() } : {}),
      },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
      signal: ctl.signal,
    });
  } catch (e) {
    throw new ApiUnavailable(e?.name === "AbortError" ? "err.timeout" : "err.unreachable");
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get("content-type") || "";
  if (binary && res.ok && !type.includes("application/json") && !type.includes("text/html")) return res.blob();
  if (!type.includes("application/json")) {
    // z. B. statischer Server liefert 404/index.html
    throw new ApiUnavailable("err.noApi");
  }
  let data = null;
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const ping = () => request("GET", "/ping", undefined, { auth: false, timeout: 6000 });
/** Mit Sitzung: zusätzlich Backend-Typ (für die Anzeige in den Einstellungen) */
export const pingAuth = () => request("GET", "/ping", undefined, { timeout: 6000 });
export const login = (username, password) => request("POST", "/login", { username, password }, { auth: false });
/** Entwicklungsmodus (Server ohne CRM_PASSWORD): Sitzung für ein Beispielkonto – as: admin | pascal | liz | marco */
export const devSession = (as) => request("POST", "/dev/session", { as }, { auth: false, timeout: 15000 });
/** Entwicklungsmodus: der vollständige Beispielsatz (sample/beispieldaten.json) */
export const devSample = () => request("GET", "/dev/sample", undefined, { timeout: 15000 });
/** Beispieldaten im laufenden Betrieb (nur Team-Admins): hinzufügen (nichts wird überschrieben) bzw. nur die markierten Beispiel-Datensätze entfernen */
export const sampleAdd = () => request("POST", "/sample/add", {}, { timeout: 40000 });
export const sampleRemove = () => request("POST", "/sample/remove", {}, { timeout: 40000 });
export const logout = () => request("POST", "/logout", {}, { timeout: 5000 });
export const me = () => request("GET", "/me");
export const changePassword = (current, next) => request("POST", "/me/password", { current, new: next });
export const getDb = () => request("GET", "/db");
export const putDb = (baseVersion, data, by) => request("PUT", "/db", { baseVersion, data, by }, { timeout: 40000 });
export const refreshFx = () => request("POST", "/fx/refresh", {}, { timeout: 20000 });
export const listBackups = () => request("GET", "/backups");
export const getBackup = (date) => request("GET", "/backups/" + encodeURIComponent(date));

// ---- Benutzer, Teams, Zusammenarbeit
export const listUsers = (teamId) => request("GET", "/users" + qs({ teamId }));
export const createUser = (input) => request("POST", "/users", input);
export const updateUser = (id, patch) => request("PATCH", "/users/" + encodeURIComponent(id), patch);
export const listTeams = () => request("GET", "/teams");
export const createTeam = (name) => request("POST", "/teams", { name });
export const updateTeam = (id, patch) => request("PATCH", "/teams/" + encodeURIComponent(id), patch);
export const enterTeam = (id) => request("POST", "/teams/" + encodeURIComponent(id) + "/enter", {});
export const team = () => request("GET", "/team");
export const audit = (params) => request("GET", "/audit" + qs(params));
export const heartbeat = (state) => request("POST", "/presence", state, { timeout: 8000 });

// ---- Darstellung (Logo, Anzeigename): eigenes bzw. betretenes Team, oder (Superadmin, Plattform) ein beliebiges Team
const brandingPath = (teamId) => (teamId ? "/teams/" + encodeURIComponent(teamId) + "/branding" : "/branding");
export const branding = (teamId, { timeout = 15000 } = {}) => request("GET", brandingPath(teamId), undefined, { timeout });
/** patch: { logo?: Data-URL, displayName?: Text ("" = Teamname) } */
export const setBranding = (teamId, patch) => request("PUT", brandingPath(teamId), patch, { timeout: 40000 });
export const resetBranding = (teamId) => request("DELETE", brandingPath(teamId), undefined, { timeout: 20000 });

// ---- Excel / SharePoint
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
/** Kleine Zusammenfassung für die Karte «Excel in SharePoint» (alle Team-Mitglieder): {configured, lastExportAt, folderUrl} */
export const spSummary = () => request("GET", "/sharepoint/summary", undefined, { timeout: 15000 });
export const spStatus = (test = false) => request("GET", "/sharepoint/status" + qs({ test: test ? 1 : "" }), undefined, { timeout: 45000 });
/** dryRun=true: nur Vorschau. Zum Übernehmen baseVersion/expect aus der Vorschau mitgeben (sonst 409 bei zwischenzeitlicher Änderung). */
export const spImport = ({ dryRun = true, baseVersion, expect, by } = {}) =>
  request("POST", "/sharepoint/import" + qs({ dryRun: dryRun ? 1 : 0, baseVersion, expect, by }), undefined, { timeout: 60000 });
export const spExport = (by) => request("POST", "/sharepoint/export" + qs({ by }), undefined, { timeout: 90000 });
export const importXlsx = (bytes, { dryRun = true, name, baseVersion, expect, by } = {}) =>
  request("POST", "/import-xlsx" + qs({ dryRun: dryRun ? 1 : 0, name, baseVersion, expect, by }), undefined, { raw: bytes, timeout: 60000 });
export const downloadXlsx = () => request("GET", "/export.xlsx", undefined, { binary: true, timeout: 60000 });

// ---- Team-Chat und Web Push (nur Servermodus mit Team-Kontext)
/** params: { channel ("team"|"mgmt"), since, before, limit, peek } → { messages, lastId, readId, unread, hasMore, gap?, channels } */
export const chatList = (params) => request("GET", "/chat" + qs(params), undefined, { timeout: 15000 });
export const chatSend = (text, cid, channel = "team", file) => request("POST", "/chat", { text, cid, channel, ...(file ? { file } : {}) }, { timeout: 20000 });
export const chatRead = (upTo, channel = "team") => request("POST", "/chat/read", { upTo, channel }, { timeout: 10000 });
// ---- Team-Kalender (nur Servermodus mit Team-Kontext)
/** Vorkommen im Zeitraum [from, to) (ISO-Zeitpunkte) → { occurrences:[{eventId, i, start, end, allDay}], events, members, truncated, now } */
export const calList = (from, to) => request("GET", "/calendar" + qs({ from, to }), undefined, { timeout: 20000 });
export const calGet = (id) => request("GET", "/calendar/events/" + encodeURIComponent(id), undefined, { timeout: 15000 });
export const calCreate = (event) => request("POST", "/calendar/events", event, { timeout: 20000 });
/** event muss die bekannte Version (rev) enthalten; sonst 409 cal_conflict */
export const calUpdate = (id, event) => request("PUT", "/calendar/events/" + encodeURIComponent(id), event, { timeout: 20000 });
export const calDelete = (id) => request("DELETE", "/calendar/events/" + encodeURIComponent(id), undefined, { timeout: 15000 });
// ---- Outlook-Kalender des eigenen Benutzers
export const olStatus = () => request("GET", "/outlook/status", undefined, { timeout: 15000 });
/** → { url }: Anmelde-Adresse bei Microsoft (der Browser wird dorthin geleitet; die Rückkehr landet unter /api/outlook/callback) */
export const olConnect = () => request("GET", "/outlook/connect", undefined, { timeout: 15000 });
export const olSettings = (direction) => request("PUT", "/outlook/settings", { direction }, { timeout: 15000 });
export const olSync = () => request("POST", "/outlook/sync", undefined, { timeout: 60000 });
/** Superadmin: App-ID (Client-ID) der Microsoft-App einmalig eintragen bzw. entfernen – keine Umgebungsvariablen nötig */
export const olPlatformSave = (clientId, tenant) => request("PUT", "/outlook/platform", { clientId, tenant }, { timeout: 15000 });
export const olPlatformClear = () => request("DELETE", "/outlook/platform", undefined, { timeout: 15000 });
export const olDisconnect = () => request("DELETE", "/outlook/connection", undefined, { timeout: 20000 });
export const pushConfig = () => request("GET", "/push/config", undefined, { timeout: 10000 });
export const pushSubscribe = (subscription) => request("POST", "/push/subscribe", { subscription }, { timeout: 15000 });
export const pushUnsubscribe = (endpoint) => request("POST", "/push/unsubscribe", { endpoint }, { timeout: 8000 });
// ---- Dateien (Zertifikate, Chat-Anhänge): Team-Namensraum, max. 10 MB, PDF/PNG/JPG/WEBP (WP-A)
/** Rohe Bytes hochladen; scope: "team" | "mgmt" (nur Geschäftsleitung) → { file: {id, name, type, size, scope} } */
export const fileUpload = (blob, { name, scope = "team" } = {}) => request("POST", "/files" + qs({ name, scope }), undefined, { raw: blob, timeout: 180000 });
/** → Blob (Fehler: ApiError, z. B. 403/404) */
export const fileDownload = (id) => request("GET", "/files/" + encodeURIComponent(id), undefined, { binary: true, timeout: 120000 });
export const fileDelete = (id) => request("DELETE", "/files/" + encodeURIComponent(id), undefined, { timeout: 20000 });
