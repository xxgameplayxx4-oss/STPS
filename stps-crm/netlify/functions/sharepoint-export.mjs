// Netlify Scheduled Function: exportiert die Datenbank stündlich nach SharePoint (Excel + JSON).
// Läuft ohne Login-Token direkt über die Export-Logik (für das Team, dem die SharePoint-Anbindung gehört). Ohne SharePoint-Einrichtung (Umgebungsvariablen) passiert nichts.
// Zeitplan: jede volle Stunde (UTC, Cron «0 * * * *»). Die Datei des Tages (STPS_CRM_Export_JJJJ-MM-TT) und STPS_CRM_aktuell werden dabei überschrieben.
import { open as openStore } from "./lib/store.mjs";
import { runScheduledExport, sharepointVars } from "./lib/sharepoint.mjs";
import { loadTeams, sharepointTeamId, scopedStore } from "./lib/teams.mjs";

// Blob-Store erst bei Bedarf öffnen: ohne Einrichtung wird er nie angefasst. Nicht über Aufrufe hinweg merken (siehe api.mjs).
const open = () => openStore();
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

export const config = { schedule: "0 * * * *" };
