// Netlify Function (modern API): /api/*
// Jedes Team hat seine Daten als JSON-Dokumente im Blob-Store "stps-crm" unter "t/<teamId>/…" (db, backup-*, audit, presence, …);
// globale Dokumente: "users", "teams", "login-throttle". Benutzerkonten mit Rollen superadmin/admin/member.
// Logik: ./lib/core.mjs (+ accounts.mjs, users.mjs, teams.mjs, audit.mjs, presence.mjs, chat.mjs, calendar.mjs; rein, getestet).
// Entwicklungsmodus (lib/devmode.mjs): NUR lokal (netlify dev bzw. CRM_DEV_MODE=on), nie in Produktion/auf Netlify – dort braucht es Anmeldung und CRM_SECRET. Sitzung: HttpOnly-Cookie (accounts.mjs), CSRF-Header unten.
// Env: CRM_SECRET (Pflicht, min. 16 Zeichen; im Entwicklungsmodus optional), CRM_PASSWORD + CRM_ADMIN_USER (nur für die Erst-Anmeldung des Superadmins), SP_TEAM_ID (optional);
// optional für SharePoint (siehe SHAREPOINT-SETUP.md): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SP_SITE, SP_DRIVE, SP_IMPORT_PATH, SP_EXPORT_FOLDER;
// Outlook-Kalender je Benutzer (siehe OUTLOOK-SETUP.md): keine Variablen nötig – der Superadmin trägt die App-ID einmal in der App ein. Optional
// (überschreibt die App-Einstellung): OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET (sonst MS_*), APP_URL.
import { open as openStore } from "./lib/store.mjs";
import { handleApi, MAX_BODY_BYTES, MAX_UPLOAD_BYTES } from "./lib/core.mjs";
import { logError, csrfOk } from "./lib/http.mjs";
import { MAX_FILE_BYTES, contentDisposition } from "./lib/files.mjs";

// Blob-Store erst bei Bedarf öffnen (/api/ping braucht ihn nicht). Nicht über Aufrufe hinweg merken: getStore() ist billig (kein Netzwerk)
// und nimmt die Zugangsdaten des laufenden Aufrufs; ein im warmen Container gemerkter Store würde die des ersten Aufrufs weiterverwenden.
const open = () => openStore();
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
  readBin: (...a) => open().readBin(...a),
  writeBin: (...a) => open().writeBin(...a),
};

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const tooLarge = () => new Response(JSON.stringify({ error: "too_large", message: "Daten zu gross" }), { status: 413, headers });

export default async (req, context) => {
  const url = new URL(req.url);
  // Gesundheitscheck für externes Monitoring (ohne Anmeldung): billiger Lesezugriff auf den Speicher
  if (url.pathname.replace(/\/+$/, "") === "/api/health" && (req.method === "GET" || req.method === "HEAD")) {
    const up = await Promise.race([open().read("__health__").then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 5000))]);
    return new Response(JSON.stringify({ ok: up, db: up ? "up" : "down" }), { status: up ? 200 : 503, headers });
  }
  // CSRF: Das Sitzungs-Cookie wird vom Browser automatisch mitgeschickt. Ändernde Anfragen brauchen deshalb den Header X-Requested-With: stps-crm
  // (oder Authorization: Bearer) – Fremdseiten können ihn ohne CORS-Freigabe nicht setzen. Gilt auch für /login und /dev/session (Login-CSRF).
  if (!csrfOk(req.method, req.headers)) {
    return new Response(JSON.stringify({ error: "csrf", message: "Anfrage abgelehnt (fehlender Sicherheits-Header)", reason: "csrf" }), { status: 403, headers });
  }
  let bodyText = "";
  let bodyBuffer;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Excel-Upload: bis ca. 5 MB roh (bzw. Base64 → 4/3 davon); alles andere wie bisher max. 10 MB.
    const route = url.pathname.replace(/\/+$/, "");
    // Datei-Upload (/api/files): rohe Bytes, höchstens 10 MB (+ Spielraum); die Typ-/Grössenprüfung macht lib/files.mjs
    const limit = route === "/api/import-xlsx" ? Math.ceil(MAX_UPLOAD_BYTES * 1.4) : route === "/api/files" ? MAX_FILE_BYTES + 4096 : MAX_BODY_BYTES * 2;
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) return tooLarge();
    bodyBuffer = Buffer.from(await req.arrayBuffer());
    if (bodyBuffer.length > limit) return tooLarge();
    const type = (req.headers.get("content-type") || "").toLowerCase();
    // Binärer Upload nicht als Text dekodieren
    bodyText = type.includes("octet-stream") || type.includes("spreadsheetml") ? "" : bodyBuffer.toString("utf8");
  }

  try {
    const result = await handleApi(
      { method: req.method, path: url.pathname, query: url.searchParams, origin: url.origin, headers: req.headers, bodyText, bodyBuffer },
      { env: process.env, store: lazyStore },
    );
    // Set-Cookie (Anmelden/Abmelden): mehrere Zeilen als eigene Header
    const withSetCookie = (h) => {
      const out = new Headers(h);
      for (const c of result.setCookie ?? []) out.append("set-cookie", c);
      return out;
    };
    if (result.redirect) return new Response(null, { status: result.status, headers: withSetCookie({ location: result.redirect, "cache-control": "no-store", "x-content-type-options": "nosniff" }) });
    if (result.binary) {
      return new Response(result.binary, {
        status: result.status,
        headers: withSetCookie({
          "content-type": result.contentType,
          "content-disposition": contentDisposition(result.filename),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        }),
      });
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers: withSetCookie(headers) });
  } catch (err) {
    // Der echte Fehler samt Stack steht im Function-Log (Netlify → Logs → Functions → api); der Browser sieht nur «Serverfehler» + Fehlerart.
    logError(`API-Fehler ${req.method} ${url.pathname}`, err);
    const kind = typeof err?.name === "string" && /^[A-Za-z][A-Za-z0-9]{2,39}$/.test(err.name) ? err.name : undefined;
    return new Response(JSON.stringify({ error: "server_error", message: "Serverfehler", ...(kind ? { reason: kind } : {}) }), { status: 500, headers });
  }
};

export const config = { path: "/api/*" };
