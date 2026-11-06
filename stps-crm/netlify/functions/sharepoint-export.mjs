// Netlify Scheduled Function: exportiert die Datenbank täglich nach SharePoint (Excel + JSON).
// Läuft ohne Login-Token direkt über die Export-Logik (für das Team, dem die SharePoint-Anbindung gehört). Ohne SharePoint-Einrichtung (Umgebungsvariablen) passiert nichts.
// Zeitplan in UTC am ENDE des Schweizer Arbeitstags: 20:00 UTC = 21:00 (Winterzeit) bzw. 22:00 (Sommerzeit) in der Schweiz.
import { getStore } from "@netlify/blobs";
import { createBlobsAdapter } from "./lib/core.mjs";
import { runScheduledExport, sharepointVars } from "./lib/sharepoint.mjs";
import { loadTeams, sharepointTeamId, scopedStore } from "./lib/teams.mjs";

// Blob-Store erst bei Bedarf öffnen: ohne Einrichtung wird er nie angefasst. Nicht über Aufrufe hinweg merken (siehe api.mjs).
const open = () => createBlobsAdapter(getStore({ name: "stps-crm", consistency: "strong" }));
const lazyStore = {
  read: (...a) => open().read(...a),
  write: (...a) => open().write(...a),
  list: (...a) => open().list(...a),
  remove: (...a) => open().remove(...a),
};

export default async () => {
  // Ohne SharePoint-Einrichtung wird nur übersprungen (der Blob-Store wird nicht angefasst).
  if (!sharepointVars(process.env).canExport) return void (await runScheduledExport({ env: process.env, store: lazyStore }));
  // Die SharePoint-Variablen gelten global für EIN Team: SP_TEAM_ID, sonst das erste (älteste) Team.
  const teamId = sharepointTeamId(process.env, await loadTeams(lazyStore, { cacheMs: 0 }));
  if (!teamId) {
    console.log("SharePoint-Export übersprungen: kein Team vorhanden bzw. SP_TEAM_ID unbekannt");
    return;
  }
  await runScheduledExport({ env: process.env, store: scopedStore(lazyStore, teamId) });
};

export const config = { schedule: "0 20 * * *" };
