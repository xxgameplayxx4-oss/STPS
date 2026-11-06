// Netlify Function (modern API): /api/*
// Jedes Team hat seine Daten als JSON-Dokumente im Blob-Store "stps-crm" unter "t/<teamId>/…" (db, backup-*, audit, presence, …);
// globale Dokumente: "users", "teams", "login-throttle". Benutzerkonten mit Rollen superadmin/admin/member.
// Logik: ./lib/core.mjs (+ accounts.mjs, users.mjs, teams.mjs, audit.mjs, presence.mjs, chat.mjs, calendar.mjs; rein, getestet).
// Env: CRM_SECRET (Pflicht, min. 16 Zeichen), CRM_PASSWORD + CRM_ADMIN_USER (nur für die Erst-Anmeldung des Superadmins), SP_TEAM_ID (optional);
// optional für SharePoint (siehe SHAREPOINT-SETUP.md): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SP_SITE, SP_DRIVE, SP_IMPORT_PATH, SP_EXPORT_FOLDER;
// Outlook-Kalender je Benutzer (siehe OUTLOOK-SETUP.md): keine Variablen nötig – der Superadmin trägt die App-ID einmal in der App ein. Optional
// (überschreibt die App-Einstellung): OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET (sonst MS_*), APP_URL.
import { getStore } from "@netlify/blobs";
import { handleApi, createBlobsAdapter, MAX_BODY_BYTES, MAX_UPLOAD_BYTES } from "./lib/core.mjs";
import { logError } from "./lib/http.mjs";

// Blob-Store erst bei Bedarf öffnen (/api/ping braucht ihn nicht). Nicht über Aufrufe hinweg merken: getStore() ist billig (kein Netzwerk)
// und nimmt die Zugangsdaten des laufenden Aufrufs; ein im warmen Container gemerkter Store würde die des ersten Aufrufs weiterverwenden.
const open = () => createBlobsAdapter(getStore({ name: "stps-crm", consistency: "strong" }));
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
};

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const tooLarge = () => new Response(JSON.stringify({ error: "too_large", message: "Daten zu gross" }), { status: 413, headers });

export default async (req, context) => {
  const url = new URL(req.url);
  let bodyText = "";
  let bodyBuffer;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Excel-Upload: bis ca. 5 MB roh (bzw. Base64 → 4/3 davon); alles andere wie bisher max. 10 MB.
    const limit = url.pathname.replace(/\/+$/, "") === "/api/import-xlsx" ? Math.ceil(MAX_UPLOAD_BYTES * 1.4) : MAX_BODY_BYTES * 2;
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
    if (result.redirect) return new Response(null, { status: result.status, headers: { location: result.redirect, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    if (result.binary) {
      return new Response(result.binary, {
        status: result.status,
        headers: {
          "content-type": result.contentType,
          "content-disposition": `attachment; filename="${result.filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  } catch (err) {
    // Der echte Fehler samt Stack steht im Function-Log (Netlify → Logs → Functions → api); der Browser sieht nur «Serverfehler» + Fehlerart.
    logError(`API-Fehler ${req.method} ${url.pathname}`, err);
    const kind = typeof err?.name === "string" && /^[A-Za-z][A-Za-z0-9]{2,39}$/.test(err.name) ? err.name : undefined;
    return new Response(JSON.stringify({ error: "server_error", message: "Serverfehler", ...(kind ? { reason: kind } : {}) }), { status: 500, headers });
  }
};

export const config = { path: "/api/*" };
