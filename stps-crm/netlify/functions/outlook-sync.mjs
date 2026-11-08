// Netlify Scheduled Function: gleicht die Outlook-Kalender aller verbundenen Benutzer ab (Outlook → CRM, bei Richtung «both» auch offene
// Änderungen CRM → Outlook). Läuft alle 15 Minuten ohne Login-Token direkt über lib/outlook.mjs (runSync). Ohne Einrichtung (App-ID in der App oder in den
// Umgebungsvariablen) passiert nichts (es wird nur die Einstellung gelesen). Pro Lauf höchstens ca. 20 Sekunden; was offen bleibt, setzt der nächste Lauf fort.
// Env: CRM_SECRET; optional OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET (sonst MS_*), MS_TENANT_ID (überschreiben die App-Einstellung).
import { open as openStore } from "./lib/store.mjs";
import { runSync } from "./lib/outlook.mjs";
import { logError } from "./lib/http.mjs";

// Blob-Store erst bei Bedarf öffnen. Nicht über Aufrufe hinweg merken (siehe api.mjs).
const open = () => openStore();
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
};

export default async () => {
  try {
    const r = await runSync({ env: process.env, store: lazyStore });
    if (r.users) console.log(`[stps-crm] Outlook-Abgleich: ${r.users} Benutzer, ${r.ok} ok, ${r.failed} Fehler${r.partial ? " (unvollständig, nächster Lauf setzt fort)" : ""}`);
  } catch (err) {
    logError("Outlook-Abgleich (geplante Function)", err);
  }
};

export const config = { schedule: "*/15 * * * *" };
