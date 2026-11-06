// Netlify Scheduled Function: versendet fällige Kalender-Erinnerungen (Web Push, sonst E-Mail) für alle Teams.
// Läuft alle 5 Minuten ohne Login-Token direkt über die Logik in lib/calendar.mjs (runReminders). Ohne Versandweg (weder VAPID-Schlüssel
// noch Resend) passiert nichts und der Blob-Store wird nicht angefasst. Doppelversand ist durch den Versandvermerk «cal/sent» je Team ausgeschlossen.
// Env (alle optional, siehe lib/push.mjs): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, RESEND_API_KEY, MAIL_FROM, APP_URL.
import { getStore } from "@netlify/blobs";
import { createBlobsAdapter } from "./lib/core.mjs";
import { runReminders } from "./lib/calendar.mjs";
import { logError } from "./lib/http.mjs";

// Blob-Store erst bei Bedarf öffnen. Nicht über Aufrufe hinweg merken (siehe api.mjs).
const open = () => createBlobsAdapter(getStore({ name: "stps-crm", consistency: "strong" }));
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
};

export default async () => {
  try {
    const r = await runReminders({ env: process.env, store: lazyStore });
    if (r.sent || r.due) console.log(`[stps-crm] Kalender-Erinnerungen: ${r.due} fällig, ${r.sent} Zustellungen`);
  } catch (err) {
    logError("Kalender-Erinnerungen (geplante Function)", err);
  }
};

export const config = { schedule: "*/5 * * * *" };
