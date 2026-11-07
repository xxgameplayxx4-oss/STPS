// STPS CRM – Teams (Mandanten): Team-Dokument, Schlüssel-Namensraum je Team, Migration des alten Einzel-Teams.
//
// Strikte Trennung: Alle Daten eines Teams (db, backup-*, audit, presence, sharepoint-meta, …) liegen unter «t/<teamId>/…».
// Die Routen bekommen nur einen «scopedStore», der ausschliesslich Schlüssel mit diesem Präfix anfassen kann.
// Globale Dokumente (users, teams, login-throttle) liegen ausserhalb von «t/».
import { randomBytes } from "node:crypto";
import { mutateDoc } from "./kv.mjs";
import { fail, cleanText } from "./http.mjs";

export const TEAMS_KEY = "teams";
export const LEGACY_TEAM_NAME = "SwissTech Precision Solutions";
export const TEAM_ID_RE = /^tm_[0-9a-f]{12}$/;
export const isTeamId = (v) => typeof v === "string" && TEAM_ID_RE.test(v);

/** Einziger Ort, der Team-Schlüssel bildet. */
export function teamKey(teamId, key) {
  if (!isTeamId(teamId)) throw new Error("Ungültige Team-ID");
  if (typeof key !== "string" || !key || key.startsWith("/") || key.includes("..")) throw new Error("Ungültiger Schlüssel");
  return `t/${teamId}/${key}`;
}

/** Store, der alle Schlüssel automatisch in den Namensraum des Teams legt (gleiches Interface wie der Basis-Store). */
export function scopedStore(store, teamId) {
  if (!isTeamId(teamId)) throw new Error("Ungültige Team-ID");
  const prefix = `t/${teamId}/`;
  return {
    teamId,
    read: (key) => store.read(teamKey(teamId, key)),
    write: (key, value, cond) => store.write(teamKey(teamId, key), value, cond),
    async list(p = "") {
      if (String(p).includes("..")) throw new Error("Ungültiger Schlüssel");
      return (await store.list(prefix + p)).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    remove: (key) => store.remove(teamKey(teamId, key)),
    // Binärdaten (Dateien, siehe files.mjs)
    readBin: (key) => store.readBin(teamKey(teamId, key)),
    writeBin: (key, bytes) => store.writeBin(teamKey(teamId, key), bytes),
  };
}

// ---------------------------------------------------------------- Team-Dokument (kurz zwischengespeichert)

const caches = new WeakMap();
export const invalidateTeams = (store) => caches.delete(store);

/**
 * Gespeicherte Teams von älteren Versionen lesbar machen (fehlende Felder → Standardwerte). Einträge ohne gültige Team-ID
 * (kein Objekt, null, fremdes ID-Format) werden übergangen: Für sie lässt sich ohnehin kein Namensraum bilden (scopedStore wirft).
 */
export function normalizeTeam(t) {
  if (!t || typeof t !== "object" || Array.isArray(t) || !isTeamId(t.id)) return null;
  const s = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? t.settings : {};
  return { ...t, name: typeof t.name === "string" ? t.name : t.id, active: t.active !== false, settings: { ...s, owners: Array.isArray(s.owners) ? s.owners : [] } };
}

export async function loadTeams(store, { now = Date.now(), cacheMs = 5000 } = {}) {
  const c = caches.get(store);
  if (c && now >= c.at && now - c.at < cacheMs) return c.teams;
  const doc = await store.read(TEAMS_KEY);
  const teams = Array.isArray(doc?.value?.teams) ? doc.value.teams.map(normalizeTeam).filter(Boolean) : [];
  caches.set(store, { at: now, teams });
  return teams;
}

export const teamById = (teams, id) => (isTeamId(id) ? teams.find((t) => t.id === id) || null : null);

/** Das Team mit den Altdaten (Migration) bzw. mit dem Namen «SwissTech Precision Solutions»: erhält die SwissTech-Logos als Anfangsdarstellung (branding.mjs). */
export const isLegacyTeam = (team) => Boolean(team) && (team.migratedFromLegacy === true || String(team.name ?? "") === LEGACY_TEAM_NAME);

export const publicTeam = (t) => ({
  id: t.id,
  name: t.name,
  active: t.active !== false,
  createdAt: t.createdAt,
  settings: { owners: Array.isArray(t.settings?.owners) ? t.settings.owners : [] },
});

/** Das «erste» Team (ältestes) – Standard für die SharePoint-Anbindung. */
export function firstTeam(teams) {
  return [...teams].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
}

/** Team, für das die (globalen) SharePoint-Umgebungsvariablen gelten: SP_TEAM_ID oder das erste Team. */
export function sharepointTeamId(env, teams) {
  const want = String(env?.SP_TEAM_ID ?? "").trim();
  if (want) return teamById(teams, want)?.id ?? null;
  return firstTeam(teams)?.id ?? null;
}

export function cleanTeamName(v) {
  const name = cleanText(v, 60);
  if (name.length < 2) throw fail(400, "bad_name", "Bitte einen Teamnamen mit mindestens 2 Zeichen eingeben", { reason: "team" });
  return name;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

export async function createTeam(store, name, { now = Date.now(), extra = {} } = {}) {
  const clean = cleanTeamName(name);
  let created;
  await mutateDoc(store, TEAMS_KEY, (doc) => {
    const teams = doc?.teams ?? [];
    if (teams.some((t) => sameName(t.name, clean))) throw fail(409, "team_exists", "Ein Team mit diesem Namen gibt es bereits");
    if (teams.length >= 200) throw fail(409, "too_many", "Maximale Anzahl Teams erreicht", { reason: "teams" });
    created = { id: "tm_" + randomBytes(6).toString("hex"), name: clean, active: true, createdAt: new Date(now).toISOString(), settings: { owners: [] }, ...extra };
    return { teams: [...teams, created] };
  });
  invalidateTeams(store);
  return created;
}

export async function updateTeam(store, id, patch, { now = Date.now() } = {}) {
  let updated;
  await mutateDoc(store, TEAMS_KEY, (doc) => {
    const teams = doc?.teams ?? [];
    const i = teams.findIndex((t) => t.id === id);
    if (i < 0) throw fail(404, "not_found", "Team nicht gefunden", { reason: "team" });
    const next = { ...teams[i] };
    if (patch.name !== undefined) {
      next.name = cleanTeamName(patch.name);
      if (teams.some((t, j) => j !== i && sameName(t.name, next.name))) throw fail(409, "team_exists", "Ein Team mit diesem Namen gibt es bereits");
    }
    if (patch.active !== undefined) {
      if (typeof patch.active !== "boolean") throw fail(400, "bad_request", "Ungültiger Wert für «active»");
      next.active = patch.active;
      if (!patch.active) next.deactivatedAt = new Date(now).toISOString();
      else delete next.deactivatedAt;
    }
    updated = next;
    const out = [...teams];
    out[i] = next;
    return { teams: out };
  });
  invalidateTeams(store);
  return updated;
}

// ---------------------------------------------------------------- Standard-Verantwortliche des Teams

/** Aktive Mitglieder → Auswahlliste «Verantwortlich» (ownerKey, sonst Anzeigename). */
export function ownersFromUsers(users, teamId) {
  const seen = new Set();
  const out = [];
  for (const u of users) {
    if (u.teamId !== teamId || !u.active || u.role === "superadmin") continue;
    const name = u.ownerKey || u.displayName;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, role: "" });
  }
  return out;
}

export async function syncOwners(store, teamId, users) {
  const owners = ownersFromUsers(users, teamId);
  await mutateDoc(store, TEAMS_KEY, (doc) => {
    const teams = doc?.teams ?? [];
    const i = teams.findIndex((t) => t.id === teamId);
    if (i < 0 || JSON.stringify(teams[i].settings?.owners ?? []) === JSON.stringify(owners)) return undefined;
    const out = [...teams];
    out[i] = { ...teams[i], settings: { ...(teams[i].settings || {}), owners } };
    return { teams: out };
  });
  invalidateTeams(store);
}

// ---------------------------------------------------------------- Migration: alter Einzel-Mandant → erstes Team

const LEGACY_SINGLE_KEYS = ["sharepoint-meta"];
const LEGACY_PREFIX_KEYS = ["backup-"];

/**
 * Verschiebt die alte, nicht getrennte Datenbank («db», «backup-*», «sharepoint-meta») in ein erstes Team
 * «SwissTech Precision Solutions» (das beim ersten Abruf der Darstellung die SwissTech-Logos erhält, siehe branding.mjs). Idempotent: bricht ein Lauf ab, setzt der nächste fort (db wird zuletzt verschoben).
 * @returns {Promise<string|null>} Team-ID oder null, wenn es nichts zu migrieren gab
 */
export async function migrateLegacy(store, { now = Date.now() } = {}) {
  const legacyDb = await store.read("db");
  const keys = [];
  for (const p of LEGACY_PREFIX_KEYS) keys.push(...(await store.list(p)));
  for (const k of LEGACY_SINGLE_KEYS) if (await store.read(k)) keys.push(k);
  if (!legacyDb && !keys.length) return null;

  const teams = await loadTeams(store, { now, cacheMs: 0 });
  let team = teams.find((t) => t.migratedFromLegacy);
  if (!team) {
    try {
      team = await createTeam(store, LEGACY_TEAM_NAME, { now, extra: { migratedFromLegacy: true } });
    } catch (e) {
      if (e.code !== "team_exists") throw e;
      team = (await loadTeams(store, { now, cacheMs: 0 })).find((t) => t.name === LEGACY_TEAM_NAME);
      if (!team) throw e;
    }
  }
  const move = async (key) => {
    const cur = await store.read(key);
    if (!cur) return;
    await store.write(teamKey(team.id, key), cur.value);
    await store.remove(key);
  };
  for (const k of keys) await move(k);
  if (legacyDb) await move("db");
  return team.id;
}
