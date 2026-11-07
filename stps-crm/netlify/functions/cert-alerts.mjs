// Netlify Scheduled Function: Ablauf-Hinweise für Lieferanten-Dokumente/Zertifikate (einmal täglich, 06:00 UTC).
// Logik und Doppelversand-Schutz: lib/cert-alerts.mjs. Ohne Versandweg (weder VAPID-Schlüssel noch Resend) passiert nichts.
import { getStore } from "@netlify/blobs";
import { createBlobsAdapter } from "./lib/core.mjs";
import { runCertAlerts } from "./lib/cert-alerts.mjs";
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
    const r = await runCertAlerts({ env: process.env, store: lazyStore });
    if (r.sent || r.due) console.log(`[stps-crm] Zertifikats-Hinweise: ${r.due} fällig, ${r.sent} Zustellungen`);
  } catch (err) {
    logError("Zertifikats-Hinweise (geplante Function)", err);
  }
};

export const config = { schedule: "0 6 * * *" };
