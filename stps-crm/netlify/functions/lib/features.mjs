// STPS CRM – Feature-Schalter (Server). Beide Funktionen sind vorübergehend abgeschaltet (Umzug zu Microsoft Teams geplant);
// Backend-Code und gespeicherte Daten (chat/…, chatm/…, cal/…, Outlook-Verbindungen) bleiben unangetastet.
//   CHAT_ENABLED=1|on|true|yes      Team-Chat (/api/chat, /api/chat/read)            · Gegenstück im Browser: CHAT_ENABLED in js/config.js
//   CALENDAR_ENABLED=1|on|true|yes  Team-Kalender, Erinnerungen, Outlook-Abgleich     · Gegenstück im Browser: CALENDAR_ENABLED in js/config.js
// Standard (nicht gesetzt) = aus: die Pfade antworten 404, die geplanten Funktionen tun nichts.
const on = (v) => /^(1|on|true|yes)$/i.test(String(v ?? "").trim());
export const chatEnabled = (env) => on(env?.CHAT_ENABLED);
export const calendarEnabled = (env) => on(env?.CALENDAR_ENABLED);
export const notFound = () => ({ status: 404, body: { error: "not_found", message: "Nicht gefunden" } });
