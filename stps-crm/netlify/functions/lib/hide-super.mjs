// STPS CRM – der Superadmin ist für Team-Mitglieder unsichtbar.
//
// Betritt der Superadmin ein Team (Support), sollen Mitglieder davon nichts erfahren: Er erscheint nicht bei «Gerade online», nicht auf der
// Team-Seite, nicht als Autor im Änderungsprotokoll oder in den Stempeln der Datensätze, im Chat nur als «Administrator» und nie als Empfänger
// von Benachrichtigungen. Das gilt serverseitig: Die Antworten an Nicht-Superadmins werden hier bereinigt, bevor sie die Function verlassen.
// Der Superadmin selbst sieht weiterhin alles (die Funktionen werden dann gar nicht aufgerufen).

/** Ersatz für den Namen des Superadmins in Stempeln, Protokoll und Terminen */
export const SYSTEM_NAME = "System";
/** Anzeigename seiner Chat-Nachrichten gegenüber Mitgliedern (in Deutsch und Englisch gleich) */
export const ADMIN_NAME = "Administrator";
/** Stempel des Superadmins lauten «<Anzeigename> (Superadmin)» (accounts.mjs, ctx.actor.name); Mitglieder können so nicht heissen (users.mjs) */
export const SUPER_SUFFIX = " (Superadmin)";

export const isSuperStamp = (v) => typeof v === "string" && v.endsWith(SUPER_SUFFIX);
export const scrubStamp = (v) => (isSuperStamp(v) ? SYSTEM_NAME : v);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Datenbank-Dokument (data): createdBy/updatedBy der Datensätze ersetzen. Gibt das Original zurück, wenn nichts zu ändern ist. */
export function scrubDb(data) {
  if (!isObj(data)) return data;
  let out = data;
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    let changed = null;
    rows.forEach((r, i) => {
      if (!isObj(r) || !(isSuperStamp(r.createdBy) || isSuperStamp(r.updatedBy))) return;
      changed ??= [...rows];
      changed[i] = { ...r, ...(isSuperStamp(r.createdBy) ? { createdBy: SYSTEM_NAME } : {}), ...(isSuperStamp(r.updatedBy) ? { updatedBy: SYSTEM_NAME } : {}) };
    });
    if (changed) { if (out === data) out = { ...data }; out[table] = changed; }
  }
  return out;
}

/** Antwort von GET /db bzw. 409 (version, data, savedAt, savedBy) */
export function scrubDbDoc(doc) {
  if (!isObj(doc)) return doc;
  return { ...doc, ...(doc.data !== undefined ? { data: scrubDb(doc.data) } : {}), ...(isSuperStamp(doc.savedBy) ? { savedBy: SYSTEM_NAME } : {}) };
}

/** Protokolleintrag für Nicht-Superadmins: null = weglassen (Eintritt ins Team), sonst ohne Name und Kennung des Superadmins */
export function scrubAuditEntry(e) {
  if (!e || !e.superadmin) return e;
  if (e.action === "enter") return null;
  const { superadmin, ...rest } = e;
  return { ...rest, uid: "", displayName: "", anon: true };
}

/** Chat-Nachricht: vom Superadmin → «Administrator» ohne Name und Kennung (sa bleibt, damit der Browser die Beschriftung in der eigenen Sprache setzt) */
export function scrubChat(m) {
  return m && m.sa ? { ...m, uid: "", name: ADMIN_NAME } : m;
}

/** {id, name}-Verweis (Termine: createdBy/updatedBy) */
export function scrubActor(a) {
  return a && isSuperStamp(a.name) ? { ...a, id: "", name: SYSTEM_NAME } : a;
}

export function scrubEvent(ev) {
  if (!isObj(ev)) return ev;
  return { ...ev, ...(ev.createdBy ? { createdBy: scrubActor(ev.createdBy) } : {}), ...(ev.updatedBy ? { updatedBy: scrubActor(ev.updatedBy) } : {}) };
}
