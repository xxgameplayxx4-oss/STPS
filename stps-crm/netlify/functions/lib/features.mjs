// STPS CRM – Feature-Schalter (Server). Team-Chat ist vorübergehend abgeschaltet (Umzug zu Microsoft Teams geplant), der Kalender ist an;
// Backend-Code und gespeicherte Daten (chat/…, chatm/…, cal/…, Outlook-Verbindungen) bleiben unangetastet.
//   CHAT_ENABLED=1|on|true|yes      Team-Chat (/api/chat, /api/chat/read)            · Gegenstück im Browser: CHAT_ENABLED in js/config.js
//   CALENDAR_ENABLED=0|off|false|no Team-Kalender ausschalten, Erinnerungen, Outlook-Abgleich     · Gegenstück im Browser: CALENDAR_ENABLED in js/config.js
// Standard (nicht gesetzt): Chat aus, Kalender an. Ausgeschaltet antworten die Pfade 404 und die geplanten Funktionen tun nichts.
const on = (v) => /^(1|on|true|yes)$/i.test(String(v ?? "").trim());
export const chatEnabled = (env) => on(env?.CHAT_ENABLED);
const off = (v) => /^(0|off|false|no)$/i.test(String(v ?? "").trim());
export const calendarEnabled = (env) => !off(env?.CALENDAR_ENABLED);
export const notFound = () => ({ status: 404, body: { error: "not_found", message: "Nicht gefunden" } });
