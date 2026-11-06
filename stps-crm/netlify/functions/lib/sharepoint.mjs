// STPS CRM – SharePoint-/Excel-Dienste: Status, Import (SharePoint-Datei oder Upload), Export, geplanter Export.
// Das CRM bleibt führend: Der Import führt nur zusammen (löscht nie), der Export überschreibt nur die Exportdateien.
// Die Funktionen liefern {status, body} (für die API-Routen) oder werfen GraphError/ImportError (siehe toResponse).
import { createHash } from "node:crypto";
import { DB_KEY, writeImportBackup, commitDb } from "./db.mjs";
import { createGraphClient, GraphError, BASE_VARS, missingVars, redact, cleanPath } from "./graph.mjs";
import { parseWorkbook, mergeImport, emptyDb, ImportError } from "./xlsx-import.mjs";
import { buildWorkbookBuffer, buildJsonBackup, exportFileNames } from "./xlsx-export.mjs";

export const META_KEY = "sharepoint-meta";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_SHAREPOINT_FILE_BYTES = 25 * 1024 * 1024;
const COLLECTIONS = ["customers", "suppliers", "rfqs", "deals", "activities", "tasks", "focus", "approvals"];

export { GraphError, ImportError };

// ---------------------------------------------------------------- Konfiguration

export function sharepointVars(env) {
  const missing = missingVars(env, BASE_VARS);
  const missingImport = missingVars(env, ["SP_IMPORT_PATH"]);
  const missingExport = missingVars(env, ["SP_EXPORT_FOLDER"]);
  const configured = missing.length === 0;
  return { configured, missing, missingImport, missingExport, canImport: configured && !missingImport.length, canExport: configured && !missingExport.length };
}

const notConfigured = (names) => new GraphError(`SharePoint ist nicht eingerichtet – es fehlen: ${names.join(", ")}`, { kind: "config" });

// ---------------------------------------------------------------- Metadaten (letzter Export/Import)

export async function readMeta(store) {
  try {
    return (await store.read(META_KEY))?.value ?? {};
  } catch {
    return {};
  }
}

async function patchMeta(store, patch) {
  try {
    await store.write(META_KEY, { ...(await readMeta(store)), ...patch });
  } catch (err) {
    console.error("sharepoint-meta konnte nicht gespeichert werden:", err?.message || err);
  }
}

// ---------------------------------------------------------------- Fehler → Antwort

/** GraphError/ImportError → {status, body}; andere Fehler werden erneut geworfen. */
export function toResponse(err, env = {}) {
  if (err instanceof ImportError) return { status: 400, body: { error: "bad_import", message: err.message } };
  if (err instanceof GraphError) {
    const message = redact(err.message, env);
    if (err.kind === "config") return { status: 400, body: { error: "not_configured", message, reason: "sharepoint" } };
    return { status: 502, body: { error: "graph_error", kind: err.kind, reason: err.kind, code: err.code || undefined, message } };
  }
  throw err;
}

// ---------------------------------------------------------------- Status / Verbindungstest

async function testConnection(env, deps) {
  const t0 = Date.now();
  try {
    const g = createGraphClient(env, deps);
    const r = await g.resolve();
    const out = { ok: true, siteName: r.siteName, siteUrl: r.siteUrl, driveName: r.driveName, importFile: null, exportFolder: null };
    if (String(env.SP_IMPORT_PATH ?? "").trim()) {
      const path = cleanPath(env.SP_IMPORT_PATH, "SP_IMPORT_PATH");
      const it = await g.getItem(path);
      out.importFile = { path, exists: Boolean(it) && !it.folder, size: it?.size ?? null, modified: it?.lastModifiedDateTime ?? null };
    }
    if (String(env.SP_EXPORT_FOLDER ?? "").trim()) {
      const path = cleanPath(env.SP_EXPORT_FOLDER, "SP_EXPORT_FOLDER");
      const it = await g.getItem(path);
      out.exportFolder = { path, exists: Boolean(it?.folder) };
    }
    out.ms = Date.now() - t0;
    return out;
  } catch (err) {
    if (!(err instanceof GraphError)) throw err;
    return { ok: false, kind: err.kind, code: err.code || undefined, message: redact(err.message, env), ms: Date.now() - t0 };
  }
}

/** Kleine Zusammenfassung für Team-Mitglieder (Karte «Excel in SharePoint»): nichts Technisches, nur wenn der Export vollständig eingerichtet ist. */
export async function getSummary({ env, store }) {
  if (!sharepointVars(env).canExport) return { configured: false };
  const m = await readMeta(store);
  return { configured: true, lastExportAt: m.lastSuccess?.at ?? null, folderUrl: m.folderUrl ?? null };
}

/** Status ohne Geheimnisse. test=true prüft zusätzlich die Verbindung zu Microsoft Graph. */
export async function getStatus({ env, store, fetch, test = false }) {
  const v = sharepointVars(env);
  const body = {
    configured: v.configured,
    canImport: v.canImport,
    canExport: v.canExport,
    missing: v.missing,
    missingImport: v.missingImport,
    missingExport: v.missingExport,
    settings: { site: String(env.SP_SITE ?? "").trim(), drive: String(env.SP_DRIVE ?? "").trim(), importPath: String(env.SP_IMPORT_PATH ?? "").trim(), exportFolder: String(env.SP_EXPORT_FOLDER ?? "").trim() },
    meta: await readMeta(store),
  };
  if (test && v.configured) body.test = await testConnection(env, { fetch });
  return { status: 200, body };
}

// ---------------------------------------------------------------- Import

const conflict = (version) => ({
  status: 409,
  body: { error: "conflict", message: "Daten wurden von jemand anderem geändert – bitte die Vorschau neu öffnen", version },
});

/**
 * Excel-Datei (Buffer) in die Datenbank übernehmen oder als Vorschau (dryRun) auswerten.
 * Speichern wie PUT /api/db: nur wenn der Stand unverändert ist (sonst 409), vorher wird ein Backup des alten Standes angelegt.
 * @param o { store, buffer, source: 'sharepoint'|'upload', fileInfo?, dryRun, baseVersion?: number, expect?: string, by?: string, now?: Date }
 */
export async function applyImport(o) {
  const { store, buffer, source, fileInfo = null, dryRun = true, baseVersion = null, expect = "", by = "" } = o;
  const now = o.now ?? new Date();
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  if (expect && expect !== hash) {
    return { status: 409, body: { error: "file_changed", message: "Die Datei hat sich seit der Vorschau geändert – bitte die Vorschau neu öffnen" } };
  }
  const parsed = await parseWorkbook(buffer);
  const stampBy = source === "sharepoint" ? "SharePoint-Import" : "Excel-Import";

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await store.read(DB_KEY);
    const curVersion = cur ? cur.value.version : 0;
    if (baseVersion !== null && baseVersion !== curVersion) return conflict(curVersion);

    const { db, summary, changed } = mergeImport(cur?.value.data ?? emptyDb(now), parsed, { now, stampBy });
    const common = { source, file: fileInfo, fileHash: hash, baseVersion: curVersion, summary, totals: summary.totals, changed };
    if (dryRun) return { status: 200, body: { dryRun: true, ...common } };

    const logImport = (extra) => patchMeta(store, { lastImport: { at: now.toISOString(), source, by: by || stampBy, file: fileInfo?.name ?? null, totals: summary.totals, ...extra } });
    if (!changed) {
      await logImport({ saved: false });
      return { status: 200, body: { dryRun: false, saved: false, version: curVersion, message: "Keine Änderungen – die Datei enthält nichts Neues", ...common } };
    }
    const backupKey = cur ? await writeImportBackup(store, cur.value, now) : null; // Sicherung VOR dem Speichern
    const res = await commitDb(store, cur, { data: db, by: by || stampBy, now: now.getTime() });
    if (res.ok) {
      await logImport({ saved: true, version: res.doc.version });
      return { status: 200, body: { dryRun: false, saved: true, version: res.doc.version, savedAt: res.doc.savedAt, backupKey, ...common } };
    }
    if (baseVersion !== null) return conflict(res.latest ? res.latest.value.version : 0);
    // Jemand hat gleichzeitig gespeichert: mit dem neuen Stand erneut zusammenführen.
  }
  return conflict(0);
}

/** Datei aus SharePoint (SP_IMPORT_PATH) importieren bzw. als Vorschau auswerten. */
export async function importFromSharepoint({ env, store, fetch, dryRun = true, baseVersion = null, expect = "", by = "", now }) {
  const v = sharepointVars(env);
  if (!v.canImport) throw notConfigured([...v.missing, ...v.missingImport]);
  const g = createGraphClient(env, { fetch });
  const path = cleanPath(env.SP_IMPORT_PATH, "SP_IMPORT_PATH");
  const item = await g.getItem(path);
  if (!item || item.folder) throw new GraphError(`Datei/Site nicht gefunden: SP_IMPORT_PATH «${path}»`, { kind: "not_found", status: 404 });
  if (Number(item.size) > MAX_SHAREPOINT_FILE_BYTES) throw new ImportError("Die Datei in SharePoint ist zu gross (über 25 MB).");
  const buffer = await g.download(path);
  return applyImport({
    store, buffer, source: "sharepoint", dryRun, baseVersion, expect, by, now,
    fileInfo: { name: item.name || path.split("/").pop(), path, size: buffer.length, modified: item.lastModifiedDateTime || null },
  });
}

// ---------------------------------------------------------------- Export

const countsOf = (db) => Object.fromEntries(COLLECTIONS.map((c) => [c, Array.isArray(db?.[c]) ? db[c].length : 0]));

/** Excel-Export als Download (ohne Microsoft) */
export async function exportXlsx({ store, now = new Date() }) {
  const cur = await store.read(DB_KEY);
  const buffer = await buildWorkbookBuffer(cur?.value.data ?? emptyDb(now), { now });
  return { buffer, filename: exportFileNames(now).xlsx };
}

/**
 * Exportiert die Datenbank nach SharePoint (SP_EXPORT_FOLDER):
 *   STPS_CRM_Export_JJJJ-MM-TT.xlsx / .json (am selben Tag überschrieben) und STPS_CRM_aktuell.xlsx.
 * Das Ergebnis (auch ein Fehler) wird als «lastExport» im Blob «sharepoint-meta» festgehalten.
 */
export async function exportToSharepoint({ env, store, fetch, trigger = "manuell", by = "", now = new Date() }) {
  const v = sharepointVars(env);
  if (!v.canExport) throw notConfigured([...v.missing, ...v.missingExport]);
  const cur = await store.read(DB_KEY);
  if (!cur) throw new GraphError("Es gibt noch keine Daten zum Exportieren.", { kind: "config" });
  const attempt = { at: now.toISOString(), trigger, by: by || null };
  try {
    const folder = cleanPath(env.SP_EXPORT_FOLDER, "SP_EXPORT_FOLDER");
    const g = createGraphClient(env, { fetch });
    const db = cur.value.data;
    const names = exportFileNames(now);
    const xlsx = await buildWorkbookBuffer(db, { now });
    const json = Buffer.from(buildJsonBackup(db), "utf8");
    const files = [];
    for (const [name, data, type] of [[names.xlsx, xlsx, XLSX_TYPE], [names.json, json, "application/json"], [names.current, xlsx, XLSX_TYPE]]) {
      const item = await g.upload(`${folder}/${name}`, data, type);
      files.push({ name, size: data.length, webUrl: item?.webUrl ?? null });
    }
    // Link auf den Ordner (für «Ordner öffnen»): optional – ein Fehler hier lässt den Export nicht scheitern
    let folderUrl = null;
    try {
      const it = await g.getItem(folder);
      folderUrl = it?.folder && it.webUrl ? it.webUrl : null;
    } catch { /* ignorieren */ }
    folderUrl = folderUrl || (await readMeta(store)).folderUrl || null;
    const info = { ...attempt, ok: true, version: cur.value.version, folder, files, counts: countsOf(db), folderUrl };
    await patchMeta(store, { lastExport: info, lastSuccess: info, ...(folderUrl ? { folderUrl } : {}) });
    return info;
  } catch (err) {
    await patchMeta(store, { lastExport: { ...attempt, ok: false, error: redact(err?.message || String(err), env) } });
    throw err;
  }
}

/**
 * Täglicher Export (Netlify Scheduled Function). Braucht kein Token; ohne Einrichtung wird still übersprungen.
 * Wirft nie: Fehler werden geloggt und in «sharepoint-meta» vermerkt.
 */
export async function runScheduledExport({ env, store, fetch, now = new Date(), log = console }) {
  const v = sharepointVars(env);
  if (!v.canExport) {
    log.log(`SharePoint-Export übersprungen: nicht eingerichtet (fehlend: ${[...v.missing, ...v.missingExport].join(", ")})`);
    return { skipped: true, reason: "not_configured" };
  }
  try {
    if (!(await store.read(DB_KEY))) {
      log.log("SharePoint-Export übersprungen: noch keine Daten vorhanden");
      return { skipped: true, reason: "no_data" };
    }
    const info = await exportToSharepoint({ env, store, fetch, trigger: "geplant", now });
    log.log(`SharePoint-Export abgeschlossen: ${info.files.map((f) => f.name).join(", ")} → ${info.folder}`);
    return { ok: true, info };
  } catch (err) {
    const message = redact(err?.message || String(err), env);
    log.error(`SharePoint-Export fehlgeschlagen: ${message}`);
    return { ok: false, error: message };
  }
}
