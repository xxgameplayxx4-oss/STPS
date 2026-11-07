// STPS CRM – Dateien (Zertifikate, Chat-Anhänge): /api/files  (WP-A)
//
// Jede Datei gehört einem Team: sie liegt im Namensraum des Teams («t/<teamId>/…», siehe teams.mjs scopedStore) – ein Zugriff aus einem
// anderen Team findet sie gar nicht (404). Die Anmeldung und die Team-Zuordnung prüft accounts.authenticate bei JEDER Anfrage.
//   fbin/<id>    die Bytes (Binär-Blob)
//   fmeta/<id>   { id, name, type, size, scope, by, at }
// scope «team» = alle Mitglieder des Teams · «mgmt» = Geschäftsleitung (Team-Admins, Management-Kennzeichen; die Prüfung geschieht hier
// auf dem Server beim Hochladen UND bei jedem Herunterladen/Löschen).
//
//  POST   /api/files?name=<Dateiname>&scope=team|mgmt   Body = rohe Bytes (application/octet-stream) → 201 {file:{id,name,type,size,scope}}
//  GET    /api/files/<id>                               Datei (Anhang, nosniff)       ·  GET /api/files/<id>?meta=1  nur die Angaben
//  DELETE /api/files/<id>                               Hochladender, Team-Admin oder Superadmin
// Höchstens 10 MB; erlaubt sind PDF, PNG, JPG, WEBP – der Typ wird an den ersten Bytes erkannt (nicht am Namen oder Header des Browsers).
import { randomBytes } from "node:crypto";
import { ApiFail, json, fail, queryOf } from "./http.mjs";
import { canManage } from "./roles.mjs";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_SCOPES = ["team", "mgmt"];
export const FILE_TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const FILE_ID_RE = /^f_[0-9a-f]{20}$/;

const metaKey = (id) => `fmeta/${id}`;
const binKey = (id) => `fbin/${id}`;

/** Dateityp an den ersten Bytes erkennen; null = nicht erlaubt */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Dateiname bereinigen: nur der Name (kein Pfad), keine Steuer-/Anführungs-/Pfadzeichen, Endung passend zum erkannten Typ, höchstens 100 Zeichen */
export function safeFilename(name, type) {
  const ext = FILE_TYPES[type] || "bin";
  let base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  base = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069"<>:*?|;,%\\/]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[.\s]+$/, "").slice(0, 90).trim();
  const given = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const okExt = given === ext || (ext === "jpg" && given === "jpeg");
  return `${stem || "datei"}.${okExt ? given : ext}`;
}

/** Content-Disposition-Wert: immer «attachment»; ASCII-Ersatzname plus UTF-8-Name (RFC 5987) – keine Anführungszeichen/Zeilenumbrüche möglich */
export function contentDisposition(filename) {
  const clean = String(filename ?? "datei").replace(/[\u0000-\u001f\u007f"\\]/g, "_");
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/[%;]/g, "_") || "datei";
  const star = encodeURIComponent(clean).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

const newId = () => "f_" + randomBytes(10).toString("hex");

/** Darf dieses Konto Datei mit diesem Bereich sehen? («team»: jedes Mitglied des Teams; «mgmt»: nur Berechtigte) */
export const canAccess = (meta, user, isSuper = false) => Boolean(meta) && (meta.scope !== "mgmt" || canManage(user, isSuper));

export async function readMeta(store, id) {
  if (!FILE_ID_RE.test(String(id))) return null;
  const v = (await store.read(metaKey(id)))?.value;
  return v && typeof v === "object" && v.id === id ? v : null;
}

const pub = (m) => ({ id: m.id, name: m.name, type: m.type, size: m.size, scope: m.scope });

/**
 * Datei speichern. Wirft ApiFail bei zu gross/leer/unerlaubtem Typ/Bereich ohne Berechtigung.
 * @returns öffentliche Angaben {id,name,type,size,scope}
 */
export async function saveFile(store, { buffer, name, scope = "team", user, isSuper = false, now }) {
  if (!FILE_SCOPES.includes(scope)) throw fail(400, "file_scope", "Unbekannter Bereich");
  if (scope === "mgmt" && !canManage(user, isSuper)) throw fail(403, "files_forbidden", "Kein Zugriff auf Dateien der Geschäftsleitung");
  if (!buffer || !buffer.length) throw fail(400, "file_empty", "Die Datei ist leer");
  if (buffer.length > MAX_FILE_BYTES) throw fail(413, "file_too_large", "Die Datei ist zu gross (höchstens 10 MB)", { max: MAX_FILE_BYTES });
  const type = sniffType(buffer);
  if (!type) throw fail(415, "file_type", "Dateityp nicht erlaubt (erlaubt: PDF, PNG, JPG, WEBP)");
  const id = newId();
  const meta = { id, name: safeFilename(name, type), type, size: buffer.length, scope, by: user.id, at: new Date(now).toISOString() };
  await store.writeBin(binKey(id), buffer);
  await store.write(metaKey(id), meta);
  return pub(meta);
}

/**
 * Anhang für eine Chat-Nachricht prüfen: die Datei muss im Team liegen, vom Absender stammen und zum Kanal passen.
 * @returns öffentliche Angaben (vom Server, nicht vom Browser)
 */
export async function attachmentFor(store, id, { uid, scope }) {
  const meta = await readMeta(store, id);
  if (!meta || meta.by !== uid || meta.scope !== scope) throw fail(400, "file_not_found", "Die Datei wurde nicht gefunden");
  return pub(meta);
}

const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });

/** @returns Antwort, oder null wenn der Pfad nicht zu den Dateien gehört */
export async function route(path, method, req, deps, ctx) {
  if (path !== "/files" && !path.startsWith("/files/")) return null;
  const { store } = deps;
  const user = ctx.user;
  try {
    if (path === "/files") {
      if (method !== "POST") return wrongMethod();
      const q = queryOf(req);
      const buffer = req.bodyBuffer ? Buffer.from(req.bodyBuffer) : Buffer.alloc(0);
      const file = await saveFile(store, { buffer, name: q.get("name") || "", scope: q.get("scope") || "team", user, isSuper: ctx.isSuper, now: deps.now });
      return json(201, { file });
    }
    const id = path.slice("/files/".length);
    const meta = await readMeta(store, id);
    // Dateien anderer Teams gibt es im Namensraum dieses Teams nicht (404); Dateien der Geschäftsleitung bleiben Mitgliedern ohne Berechtigung verwehrt (403)
    if (!meta) return json(404, { error: "file_not_found", message: "Die Datei wurde nicht gefunden" });
    if (!canAccess(meta, user, ctx.isSuper)) return json(403, { error: "files_forbidden", message: "Kein Zugriff auf Dateien der Geschäftsleitung" });
    if (method === "GET") {
      if (queryOf(req).get("meta") === "1") return json(200, { file: pub(meta) });
      const bytes = await store.readBin(binKey(id));
      if (!bytes) return json(404, { error: "file_not_found", message: "Die Datei wurde nicht gefunden" });
      return { status: 200, binary: bytes, contentType: meta.type, filename: meta.name };
    }
    if (method === "DELETE") {
      if (meta.by !== user.id && !ctx.isAdmin && !ctx.isSuper) return json(403, { error: "files_forbidden", message: "Nur wer die Datei hochgeladen hat oder ein Admin darf sie löschen" });
      await store.remove(binKey(id));
      await store.remove(metaKey(id));
      return json(200, { ok: true });
    }
    return wrongMethod();
  } catch (e) {
    if (e instanceof ApiFail) return json(e.status, { error: e.code, message: e.message, ...e.extra });
    throw e;
  }
}
