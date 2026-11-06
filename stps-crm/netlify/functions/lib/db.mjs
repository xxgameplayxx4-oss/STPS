// STPS CRM – Zugriff auf das Datenbank-Dokument (Version, Backups).
// Gemeinsam genutzt von core.mjs (API) und sharepoint.mjs (Import/Export, geplanter Export).
// Der Store hat dasselbe Interface wie in core.mjs beschrieben (read/write/list/remove).

export const DB_KEY = "db";
export const BACKUP_PREFIX = "backup-";
export const BACKUP_KEEP_DAYS = 30;
/** Backup-IDs: «JJJJ-MM-TT» (Tagesstand) oder «JJJJ-MM-TT-import-HHMMSS» (Stand vor einem Import) */
export const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}(?:-import-\d{6})?$/;

export function zurichDate(date = new Date()) {
  // en-CA liefert YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Uhrzeit in Zürich als HHMMSS */
export function zurichTime(date = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "00";
  return g("hour") + g("minute") + g("second");
}

export function isValidDb(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data) && Number.isInteger(data.schema);
}

const backupDate = (key) => /^backup-(\d{4}-\d{2}-\d{2})(?:-import-\d{6})?$/.exec(key)?.[1] ?? null;

// ---------------------------------------------------------------- Backups

export async function writeBackup(store, doc, now = new Date()) {
  const today = zurichDate(now);
  const key = BACKUP_PREFIX + today;
  const existing = await store.list(BACKUP_PREFIX);
  const isNewDay = !existing.includes(key);
  await store.write(key, { date: today, savedAt: doc.savedAt, version: doc.version, data: doc.data });
  if (isNewDay) {
    // Rollierend: nur die letzten BACKUP_KEEP_DAYS Tage behalten (Tagesstände und Import-Sicherungen).
    const cutoff = zurichDate(new Date(now.getTime() - BACKUP_KEEP_DAYS * 86400000));
    for (const k of existing) {
      const d = backupDate(k);
      if (d && d < cutoff) await store.remove(k);
    }
  }
  return key;
}

/** Sichert den Stand VOR einem Import unter einem eigenen Schlüssel (der Tagesstand würde durch den Import überschrieben). */
export async function writeImportBackup(store, doc, now = new Date()) {
  const key = `${BACKUP_PREFIX}${zurichDate(now)}-import-${zurichTime(now)}`;
  await store.write(key, { date: zurichDate(now), kind: "import", savedAt: doc.savedAt, version: doc.version, data: doc.data });
  return key;
}

// ---------------------------------------------------------------- Versioniertes Speichern

/**
 * Schreibt eine neue Version der Datenbank (optimistisch: nur wenn `cur` noch der aktuelle Stand ist).
 * @param cur  Ergebnis von store.read(DB_KEY) (oder null, wenn es noch keine Datenbank gibt)
 * @returns {{ok:true, doc:object}|{ok:false, latest:object|null}}  latest = Stand, der gewonnen hat
 */
export async function commitDb(store, cur, { data, by, now }) {
  const curVersion = cur ? cur.value.version : 0;
  const doc = {
    version: curVersion + 1,
    savedAt: new Date(now).toISOString(),
    savedBy: typeof by === "string" ? by.slice(0, 40) : "",
    data,
  };
  const ok = await store.write(DB_KEY, doc, cur ? { ifMatch: cur.etag } : { ifNew: true });
  if (!ok) return { ok: false, latest: await store.read(DB_KEY) }; // jemand war gleichzeitig schneller
  try {
    await writeBackup(store, doc, new Date(now));
  } catch (err) {
    console.error("Backup fehlgeschlagen:", err);
  }
  return { ok: true, doc };
}
