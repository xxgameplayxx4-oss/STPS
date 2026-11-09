// STPS CRM – reine API-Logik (ohne Netlify-Abhängigkeiten, daher direkt testbar).
//
// api.mjs übersetzt Request/Response und reicht einen "Store" durch, der dieses Interface hat:
//   read(key)                  -> { value, etag } | null
//   write(key, value, cond)    -> boolean   (cond: { ifMatch: etag } | { ifNew: true } | undefined)
//   list(prefix)               -> string[]  (Keys)
//   remove(key)                -> void
import { DB_KEY, BACKUP_PREFIX, BACKUP_KEEP_DAYS, zurichDate, isValidDb, writeBackup, commitDb } from "./db.mjs";
import * as sp from "./sharepoint.mjs";
import * as accounts from "./accounts.mjs";
import * as chat from "./chat.mjs";
import * as calendar from "./calendar.mjs";
import * as files from "./files.mjs";
import * as outlook from "./outlook.mjs";
import * as dev from "./devmode.mjs";
import { updateTeamFx } from "./fx-rates.mjs";
import { parseBody } from "./http.mjs";
import { stampAndDiff, appendAudit } from "./audit.mjs";
import { scrubDb, scrubStamp } from "./hide-super.mjs";

// Datenbank-Zugriff liegt in db.mjs (gemeinsam mit sharepoint.mjs); hier erneut exportiert, damit bestehende Importe gelten.
export { DB_KEY, BACKUP_PREFIX, BACKUP_KEEP_DAYS, zurichDate, isValidDb, writeBackup };
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Excel-Upload (roh oder Base64): Netlify Functions nehmen max. ca. 6 MB pro Anfrage an (praktisch ca. 4,5 MB Datei). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- Hilfen

const json = (status, body) => ({ status, body });

const headerOf = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) || "";

function queryOf(req) {
  if (req.query instanceof URLSearchParams) return req.query;
  if (req.query && typeof req.query === "object") return new URLSearchParams(req.query);
  if (typeof req.query === "string") return new URLSearchParams(req.query);
  const i = String(req.path || "").indexOf("?");
  return new URLSearchParams(i >= 0 ? String(req.path).slice(i + 1) : "");
}

/** Bytes einer hochgeladenen Excel-Datei: roh (octet-stream/xlsx), Text mit Base64 (text/plain) oder JSON {contentBase64}. */
function uploadBytes(req) {
  const type = String(headerOf(req.headers, "content-type")).toLowerCase();
  const fromB64 = (s) => Buffer.from(String(s).replace(/^data:[^,]*,/, "").replace(/\s+/g, ""), "base64");
  if (type.includes("application/json")) {
    let b;
    try { b = JSON.parse(req.bodyText || "{}"); } catch { throw new sp.ImportError("Ungültige Anfrage"); }
    const s = b?.contentBase64 ?? b?.base64;
    if (typeof s !== "string" || !s) throw new sp.ImportError("Die Datei fehlt (Feld contentBase64)");
    return fromB64(s);
  }
  if (type.includes("text/plain") || (!req.bodyBuffer && !type)) return fromB64(req.bodyText || "");
  if (req.bodyBuffer) return Buffer.from(req.bodyBuffer);
  return fromB64(req.bodyText || "");
}

// ---------------------------------------------------------------- Request-Handler

/**
 * @param {object} req  { method, path, query?, headers, bodyText, bodyBuffer? }
 * @param {object} deps { env, store, now?: () => number, delay?: (ms) => Promise<void>, fetch?: typeof fetch (Microsoft Graph, für Tests) }
 * @returns {{status:number, body:object}|{status:number, binary:Buffer, contentType:string, filename:string}}
 */
export async function handleApi(req, deps) {
  let { env, store } = deps;
  const rootEnv = env; // vollständige Umgebung (ctx.env enthält MS_*/SP_* nur für das SharePoint-Team; Outlook gilt für alle Teams)
  const now = deps.now ? deps.now() : Date.now();
  const delay = deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const method = (req.method || "GET").toUpperCase();
  const path = String(req.path || "").split("?")[0].replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";

  // Entwicklungsmodus (siehe lib/devmode.mjs): nur ausdrücklich lokal (CRM_DEV_MODE=on bzw. netlify dev), nie in Produktion, ohne CRM_PASSWORD und solange es keine echten Konten gibt.
  const devActive = dev.devEnvEnabled(env) && (await dev.isDevActive(env, store, now));
  if (devActive) {
    env = dev.withDevEnv(env);
    deps = { ...deps, env, dev: true };
    await dev.ensureDevSeed(store, { now });
  }

  if (path === "/ping" && method === "GET") {
    return json(200, { ok: true, app: "stps-crm", backend: String(rootEnv.DB_DRIVER || "").toLowerCase() === "mysql" ? "mysql" : "blobs", configured: accounts.isConfigured(env), ...(devActive ? { dev: true } : {}), ...(accounts.isConfigured(env) ? {} : { message: accounts.configProblem(env) }) });
  }

  // /api/dev/* gibt es nur im Entwicklungsmodus – sonst nicht einmal ein Hinweis darauf (404)
  if (!devActive && (path === "/dev" || path.startsWith("/dev/"))) return json(404, { error: "not_found", message: "Nicht gefunden" });

  const problem = accounts.configProblem(env);
  if (problem) return json(500, { error: "not_configured", message: problem, reason: "secret" });

  // Rückleitung von Microsoft nach «Outlook verbinden»: kein Token (Weiterleitung des Browsers); der Benutzer steckt im signierten «state»
  if (path === "/outlook/callback" && method === "GET") return outlook.callback(req, { ...deps, now, rootEnv });

  // Konten + Teams (lib/accounts.mjs): Login, Authentifizierung bei jeder Anfrage, Team-Kontext, /me /users /teams /team /audit /presence
  if (devActive && path === "/dev/session") return accounts.guard(() => dev.devSession(req, { ...deps, now }, method, parseBody));
  if (path === "/login") return accounts.login(req, { ...deps, now, delay }, method);
  const auth = await accounts.authenticate(req, deps, now);
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;
  req = accounts.withIdentity(req, ctx);
  const account = await accounts.route(path, method, req, { ...deps, now, delay }, ctx);
  if (account) return account;

  // Outlook: App-ID einrichten und Einrichtungsstand – nur Superadmin, auch ohne gewähltes Team (Wurzel-Speicher)
  const olPlat = await outlook.platformRoute(path, method, req, { ...deps, now, rootEnv: env }, ctx);
  if (olPlat) return olPlat;

  // Ab hier: Daten des Teams. Der Store kennt nur den Namensraum des eigenen Teams (Superadmin: das gewählte Team).
  if (!ctx.store) return json(409, { error: "team_required", message: "Bitte zuerst ein Team wählen" });
  const rootStore = deps.store; // globale Dokumente (users, teams) – nur für Chat/Push (Mitgliederliste des eigenen Teams)
  deps = { ...deps, env: ctx.env, store: ctx.store };
  env = ctx.env;
  store = ctx.store;

  // Team-Chat und Push (lib/chat.mjs, lib/push.mjs): arbeitet nur im Namensraum des Teams dieser Anfrage
  const chatRes = await chat.route(path, method, req, { ...deps, rootStore, now }, ctx);
  if (chatRes) return chatRes;

  // Dateien (lib/files.mjs): Zertifikate, Chat-Anhänge – im Namensraum des Teams, Berechtigung bei jeder Anfrage
  const fileRes = await files.route(path, method, req, { ...deps, now }, ctx);
  if (fileRes) return fileRes;

  // Team-Kalender (lib/calendar.mjs): Termine, Wiederholungen, Erinnerungen – ebenfalls nur im Namensraum des eigenen Teams
  const calRes = await calendar.route(path, method, req, { ...deps, rootStore, rootEnv, now }, ctx);
  if (calRes) return calRes;

  // Outlook-Verbindung des eigenen Benutzers (lib/outlook.mjs)
  const olRes = await outlook.route(path, method, req, { ...deps, rootStore, rootEnv, now }, ctx);
  if (olRes) return olRes;

  // Wechselkurse jetzt von der EZB holen (Button «Jetzt aktualisieren»); nur Team-Admins, nur im Modus «Automatisch»
  if (path === "/fx/refresh") {
    if (method !== "POST") return json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
    if (!ctx.isAdmin && !ctx.isSuper) return json(403, { error: "forbidden", message: "Nur Admins dürfen die Wechselkurse aktualisieren", reason: "fx_admins_only" });
    const r = await updateTeamFx(store, { now, fetch: deps.fetch });
    if (r.status === "ok") return json(200, { ok: true, fx: r.fx });
    // Kein HTTP-Fehler für erwartbare Ausgänge (manuell, Dienst nicht erreichbar, noch keine Daten): die Oberfläche wertet «status» aus
    return json(200, { ok: false, status: r.status, ...(r.status === "failed" ? { message: "Wechselkurse konnten nicht geladen werden" } : {}) });
  }

  if (path === "/db") {
    if (method === "GET") {
      const cur = await store.read(DB_KEY);
      if (!cur) return json(200, { version: 0, data: null });
      const { version, data, savedAt, savedBy } = cur.value;
      // Mitglieder sehen den Superadmin nicht als Autor (Stempel «… (Superadmin)» → «System»); beim Speichern setzt der Server die Stempel ohnehin neu
      if (!ctx.isSuper) return json(200, { version, data: scrubDb(data), savedAt, savedBy: scrubStamp(savedBy) });
      return json(200, { version, data, savedAt, savedBy });
    }
    if (method === "PUT") return putDb(req, deps, now, ctx);
    return json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
  }

  if (path === "/backups" && method === "GET") {
    const keys = (await store.list(BACKUP_PREFIX)).filter((k) => /^backup-\d{4}-\d{2}-\d{2}(?:-import-\d{6})?$/.test(k));
    const backups = keys
      .map((k) => {
        const id = k.slice(BACKUP_PREFIX.length);
        const isImport = id.length > 10;
        return { key: k, id, date: id.slice(0, 10), kind: isImport ? "import" : "tag", ...(isImport ? { time: `${id.slice(-6, -4)}:${id.slice(-4, -2)}:${id.slice(-2)}` } : {}) };
      })
      .sort((a, b) => b.id.localeCompare(a.id));
    return json(200, { backups });
  }

  const m = /^\/backups\/(\d{4}-\d{2}-\d{2}(?:-import-\d{6})?)$/.exec(path);
  if (m && method === "GET") {
    const b = await store.read(BACKUP_PREFIX + m[1]);
    if (!b) return json(404, { error: "not_found", message: "Backup nicht gefunden", reason: "backup" });
    return json(200, ctx.isSuper ? b.value : { ...b.value, data: scrubDb(b.value.data) });
  }

  // ---- Excel / SharePoint
  if (path.startsWith("/sharepoint/") || path === "/import-xlsx" || path === "/export.xlsx") {
    const denied = sharepointAccess(path, ctx);
    if (denied) return denied;
    return accounts.noteImport(await excelRoutes(path, method, req, deps, now, ctx), ctx, now);
  }

  return json(404, { error: "not_found", message: "Nicht gefunden" });
}

async function putDb(req, deps, now, ctx) {
  const { store } = deps;
  const text = req.bodyText || "";
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return json(413, { error: "too_large", message: "Daten zu gross" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "bad_json", message: "Ungültige Anfrage" }); }
  const { baseVersion, data } = body || {};
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return json(400, { error: "bad_request", message: "baseVersion fehlt" });
  if (!isValidDb(data)) return json(400, { error: "bad_request", message: "Ungültige Daten" });

  const conflict = (cur) =>
    json(409, {
      error: "conflict",
      message: "Daten wurden von jemand anderem geändert",
      version: cur ? cur.value.version : 0,
      data: cur ? (ctx.isSuper ? cur.value.data : scrubDb(cur.value.data)) : null,
      savedAt: cur?.value.savedAt,
      savedBy: ctx.isSuper ? cur?.value.savedBy : scrubStamp(cur?.value.savedBy),
    });

  const cur = await store.read(DB_KEY);
  const curVersion = cur ? cur.value.version : 0;
  if (baseVersion !== curVersion) return conflict(cur);

  // Die Warengruppen (Nummernbereiche der Artikel) dürfen nur Team-Admins ändern; Mitglieder lesen sie nur.
  const oldWg = cur?.value.data?.settings?.billing?.warengruppen;
  if (!ctx.isAdmin && !ctx.isSuper && oldWg !== undefined && JSON.stringify(oldWg) !== JSON.stringify(data.settings?.billing?.warengruppen)) {
    return json(403, { error: "forbidden", message: "Nur Admins dürfen die Warengruppen ändern", reason: "warengruppen_admins_only" });
  }

  // Stempel (erstellt/geändert von/am) setzt der Server aus dem Konto; die Änderungen kommen ins Protokoll.
  const stamped = stampAndDiff(cur?.value.data ?? null, data, ctx.actor, now);
  const res = await commitDb(store, cur, { data: stamped.data, by: ctx.actor.name, now });
  if (!res.ok) return conflict(res.latest);
  try {
    await appendAudit(store, stamped.entries);
  } catch (err) {
    console.error("Änderungsprotokoll fehlgeschlagen:", err?.message || err);
  }
  return json(200, { version: res.doc.version, savedAt: res.doc.savedAt });
}

// ---------------------------------------------------------------- Excel-Import/-Export, SharePoint

const intParam = (q, name) => {
  const v = q.get(name);
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
};
const byParam = (q) => (q.get("by") || "").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40);

/**
 * SharePoint ist Sache des Superadmins (Einrichtung, Diagnose, Import). Team-Mitglieder und Team-Admins sehen davon nur
 * die kleine Karte «Excel in SharePoint»: /sharepoint/summary (Teams ohne Anbindung erhalten {configured:false}) und
 * den Upload /sharepoint/export (nur im Team, dem die Anbindung gehört). Excel-Upload/-Download (/import-xlsx, /export.xlsx) bleibt für alle.
 */
function sharepointAccess(path, ctx) {
  if (!path.startsWith("/sharepoint/") || ctx.isSuper) return null;
  if (path === "/sharepoint/summary") return null;
  if (path === "/sharepoint/export" && sp.sharepointVars(ctx.env).canExport) return null;
  return json(403, { error: "forbidden", message: "Keine Berechtigung", reason: "superadmin_only" });
}

async function excelRoutes(path, method, req, deps, now, ctx) {
  const { env, store } = deps;
  const q = queryOf(req);
  const nowDate = new Date(now);
  const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
  try {
    if (path === "/sharepoint/summary") {
      if (method !== "GET") return wrongMethod();
      return json(200, await sp.getSummary({ env, store }));
    }
    if (path === "/sharepoint/status") {
      if (method !== "GET") return wrongMethod();
      return await sp.getStatus({ env, store, fetch: deps.fetch, test: q.get("test") === "1" });
    }
    if (path === "/sharepoint/import") {
      if (method !== "POST") return wrongMethod();
      return await sp.importFromSharepoint({
        env, store, fetch: deps.fetch, now: nowDate,
        dryRun: q.get("dryRun") !== "0", // sicherer Standard: nur Vorschau
        baseVersion: intParam(q, "baseVersion"), expect: (q.get("expect") || "").slice(0, 64), by: byParam(q),
      });
    }
    if (path === "/import-xlsx") {
      if (method !== "POST") return wrongMethod();
      const buffer = uploadBytes(req);
      if (buffer.length > MAX_UPLOAD_BYTES) return json(413, { error: "too_large", message: "Datei zu gross (max. 5 MB)" });
      if (!buffer.length) return json(400, { error: "bad_import", message: "Die Datei ist leer" });
      return await sp.applyImport({
        store, buffer, source: "upload", now: nowDate,
        fileInfo: { name: (q.get("name") || "").slice(0, 120) || null, size: buffer.length },
        dryRun: q.get("dryRun") !== "0",
        baseVersion: intParam(q, "baseVersion"), expect: (q.get("expect") || "").slice(0, 64), by: byParam(q),
      });
    }
    if (path === "/sharepoint/export") {
      if (method !== "POST") return wrongMethod();
      const info = await sp.exportToSharepoint({ env, store, fetch: deps.fetch, trigger: "manuell", by: byParam(q), now: nowDate });
      return json(200, ctx?.isSuper ? { ok: true, ...info } : { ok: true, at: info.at, folderUrl: info.folderUrl ?? null });
    }
    if (path === "/export.xlsx") {
      if (method !== "GET") return wrongMethod();
      const { buffer, filename } = await sp.exportXlsx({ store, now: nowDate });
      return { status: 200, binary: buffer, contentType: sp.XLSX_TYPE, filename };
    }
  } catch (err) {
    const r = sp.toResponse(err, env); // wirft bei unbekannten Fehlern
    if (r.status >= 500) console.error("SharePoint/Excel:", r.body.message);
    // Teams sehen keine technischen Details (Variablen, Microsoft-Meldungen); der Superadmin findet sie in der SharePoint-Karte (lastExport).
    if (path === "/sharepoint/export" && !ctx?.isSuper) return json(502, { error: "export_failed", message: "Der Upload nach SharePoint ist fehlgeschlagen. Bitte versuchen Sie es später erneut oder wenden Sie sich an Ihren Administrator." });
    return r;
  }
  return json(404, { error: "not_found", message: "Nicht gefunden" });
}

// ---------------------------------------------------------------- Netlify-Blobs-Adapter

export function createBlobsAdapter(blobStore) {
  return {
    async read(key) {
      const r = await blobStore.getWithMetadata(key, { type: "json" });
      return r ? { value: r.data, etag: r.etag } : null;
    },
    async write(key, value, cond) {
      const opts = cond?.ifMatch ? { onlyIfMatch: cond.ifMatch } : cond?.ifNew ? { onlyIfNew: true } : undefined;
      const r = await blobStore.setJSON(key, value, opts);
      return opts ? r.modified !== false : true;
    },
    async list(prefix) {
      const r = await blobStore.list({ prefix });
      return r.blobs.map((b) => b.key);
    },
    async remove(key) {
      await blobStore.delete(key);
    },
    // Binärdaten (Dateien, siehe files.mjs)
    async readBin(key) {
      const b = await blobStore.get(key, { type: "arrayBuffer" });
      return b ? Buffer.from(b) : null;
    },
    async writeBin(key, bytes) {
      await blobStore.set(key, bytes);
    },
  };
}

// Einfacher In-Memory-Store (Tests / lokale Entwicklung ohne Blobs)
export function createMemoryStore() {
  const m = new Map();
  const bins = new Map(); // Binärdaten (Dateien)
  let n = 0;
  return {
    m,
    bins,
    async read(key) {
      const e = m.get(key);
      return e ? { value: JSON.parse(e.json), etag: e.etag } : null;
    },
    async write(key, value, cond) {
      const e = m.get(key);
      if (cond?.ifNew && e) return false;
      if (cond?.ifMatch && (!e || e.etag !== cond.ifMatch)) return false;
      m.set(key, { json: JSON.stringify(value), etag: "e" + ++n });
      return true;
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix));
    },
    async remove(key) {
      m.delete(key);
      bins.delete(key);
    },
    async readBin(key) {
      return bins.has(key) ? Buffer.from(bins.get(key)) : null;
    },
    async writeBin(key, bytes) {
      bins.set(key, Buffer.from(bytes));
    },
  };
}
