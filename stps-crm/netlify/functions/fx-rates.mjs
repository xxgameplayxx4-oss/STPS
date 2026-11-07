// Netlify Scheduled Function: aktualisiert die Wechselkurse aller Teams im Modus «Automatisch» (EZB-Referenzkurse).
// Werktags 16:30 UTC – die EZB veröffentlicht um ca. 16:00 MEZ (15:00 UTC im Winter, 14:00 UTC im Sommer), also liegt der Lauf in jedem Fall danach.
// Logik: lib/fx-rates.mjs. Bei einem Fehler bleiben die letzten Kurse bestehen.
import { getStore } from "@netlify/blobs";
import { createBlobsAdapter } from "./lib/core.mjs";
import { runFxUpdate } from "./lib/fx-rates.mjs";
import { logError } from "./lib/http.mjs";

const open = () => createBlobsAdapter(getStore({ name: "stps-crm", consistency: "strong" }));
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
};

export default async () => {
  try {
    const r = await runFxUpdate({ env: process.env, store: lazyStore });
    console.log(`[stps-crm] Wechselkurse: ${r.updated} aktualisiert, ${r.skipped} übersprungen, ${r.failed} fehlgeschlagen`);
  } catch (err) {
    logError("Wechselkurse (geplante Function)", err);
  }
};

export const config = { schedule: "30 16 * * 1-5" };
