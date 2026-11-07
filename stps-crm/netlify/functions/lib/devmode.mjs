// STPS CRM – Entwicklungsmodus (Entwicklungsphase: «das CRM soll kein Passwort verlangen»).
//
// Aktiv, wenn die Umgebungsvariable CRM_PASSWORD NICHT gesetzt ist (und CRM_DEV_MODE nicht «off» ist) UND es noch keine echten
// Konten gibt (keine Konten, nur die hier angelegten Beispielkonten mit devSeed:true oder nie angemeldete Konten). Dann:
//  - /api/ping meldet dev:true, /api/dev/session liefert ohne Anmeldung eine Sitzung (wählbar: admin, pascal, liz, marco),
//    und Anfragen ohne gültiges Token laufen als Pascal (Team-Admin);
//  - fehlt CRM_SECRET, gilt ein fester interner Entwicklungs-Schlüssel;
//  - das Team «SwissTech Precision Solutions» mit den vier Beispielkonten wird angelegt, falls es noch keine Konten gibt.
// Ist CRM_PASSWORD gesetzt, ist dieses Modul wirkungslos: Anmeldung, Schlüssel und Konten verhalten sich wie zuvor.
// Gibt es echte Konten (angemeldet, z. B. nach der Erst-Anmeldung, danach wurde CRM_PASSWORD entfernt), bleibt die Anmeldung ebenfalls Pflicht.
import { randomBytes } from "node:crypto";
import { mutateDoc } from "./kv.mjs";
import * as U from "./users.mjs";
import * as T from "./teams.mjs";
import { createSessionToken, SESSION_TTL_MS, MIN_SECRET_LENGTH } from "./session.mjs";
import { json } from "./http.mjs";

/** Fester interner Schlüssel – nur im Entwicklungsmodus und nur, wenn CRM_SECRET fehlt. Schützt nichts (bewusst). */
export const DEV_SECRET = "stps-crm-dev-mode-secret-NOT-FOR-PRODUCTION";
export const DEV_TEAM_NAME = "SwissTech Precision Solutions";
/** Beispielkonten: key = Name im Rollenwechsler; Pascal ist der Standard. */
export const DEV_USERS = [
  { key: "admin", username: "admin", displayName: "Admin", role: "superadmin" },
  { key: "pascal", username: "pascal", displayName: "Pascal", role: "admin" },
  { key: "liz", username: "liz", displayName: "Liz", role: "member", management: true },
  { key: "marco", username: "marco", displayName: "Marco", role: "member", management: true },
];
export const DEFAULT_DEV_KEY = "pascal";

/** Nur anhand der Umgebung: darf der Entwicklungsmodus überhaupt gelten? (CRM_PASSWORD gesetzt → nie) */
export const devEnvEnabled = (env) => !String(env?.CRM_PASSWORD ?? "").trim() && String(env?.CRM_DEV_MODE ?? "").trim().toLowerCase() !== "off";

/** Gilt der Entwicklungsmodus jetzt? Nur ohne CRM_PASSWORD und solange es keine echten Konten gibt. */
export async function isDevActive(env, store, now = Date.now()) {
  if (!devEnvEnabled(env)) return false;
  const users = await U.loadUsers(store, { now, cacheMs: 5000 });
  // Echt = hat sich je per Passwort angemeldet (die Erst-Anmeldung des Superadmins setzt lastLoginAt; Beispielkonten und neu angelegte, nie benutzte Konten nicht)
  return users.every((u) => u.devSeed === true || !u.lastLoginAt);
}

/** Umgebung für den Entwicklungsmodus: fehlendes/zu kurzes CRM_SECRET wird durch den festen Schlüssel ersetzt. */
export function withDevEnv(env) {
  return String(env?.CRM_SECRET ?? "").length >= MIN_SECRET_LENGTH ? env : { ...env, CRM_SECRET: DEV_SECRET };
}

/** Legt Team + Beispielkonten an, falls es noch keine Konten gibt (atomar, mehrfach aufrufbar). Passwörter: zufällig, unbekannt (Anmeldung per Passwort nicht möglich). */
export async function ensureDevSeed(store, { now = Date.now() } = {}) {
  if ((await U.loadUsers(store, { now, cacheMs: 5000 })).length) return;
  let team = (await T.loadTeams(store, { now, cacheMs: 0 })).find((t) => t.name === DEV_TEAM_NAME);
  if (!team) {
    try {
      team = await T.createTeam(store, DEV_TEAM_NAME, { now });
    } catch (e) {
      if (e.code !== "team_exists") throw e;
      team = (await T.loadTeams(store, { now, cacheMs: 0 })).find((t) => t.name === DEV_TEAM_NAME);
    }
  }
  const quick = { N: 1024 }; // die Passwörter sind zufällig und werden nie benutzt
  const hashes = [];
  for (let i = 0; i < DEV_USERS.length; i++) hashes.push(await U.hashPassword(randomBytes(24).toString("hex"), quick));
  const created = new Date(now).toISOString();
  try {
    await mutateDoc(store, U.USERS_KEY, (doc) => {
      if (doc?.users?.length) return undefined;
      return {
        users: DEV_USERS.map((d, i) => ({
          id: "u_" + randomBytes(8).toString("hex"), username: d.username, displayName: d.displayName, role: d.role,
          teamId: d.role === "superadmin" ? null : team.id, ownerKey: d.role === "superadmin" ? "" : d.displayName,
          ...(d.management ? { management: true } : {}), passwordHash: hashes[i], active: true, tokenVersion: 0,
          createdAt: created, lastLoginAt: null, mustChangePassword: false, devSeed: true,
        })),
      };
    });
  } finally {
    U.invalidateUsers(store);
  }
  const users = await U.loadUsers(store, { now, cacheMs: 0 });
  await T.syncOwners(store, team.id, users);
}

export const devUserFor = (users, key) => {
  const d = DEV_USERS.find((x) => x.key === String(key ?? "").toLowerCase()) || DEV_USERS.find((x) => x.key === DEFAULT_DEV_KEY);
  return users.find((u) => u.username === d.username && u.devSeed === true) || null;
};

const publicDevList = () => DEV_USERS.map(({ key, displayName, role }) => ({ key, displayName, role }));

/** GET/POST /api/dev/session – Sitzung für ein Beispielkonto (POST {as: "admin"|"pascal"|"liz"|"marco"}; GET = Pascal). */
export async function devSession(req, deps, method, parseBody) {
  const { env, store, now } = deps;
  if (method !== "GET" && method !== "POST") return json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
  const as = method === "POST" ? parseBody(req, 1024).as : undefined;
  if (as !== undefined && !DEV_USERS.some((d) => d.key === String(as).toLowerCase())) return json(400, { error: "bad_request", message: "Unbekanntes Beispielkonto" });
  await ensureDevSeed(store, { now });
  const users = await U.loadUsers(store, { now, cacheMs: 0 });
  const user = devUserFor(users, as);
  if (!user) return json(500, { error: "server_error", message: "Beispielkonto fehlt" });
  const team = user.teamId ? T.teamById(await T.loadTeams(store, { now, cacheMs: 0 }), user.teamId) : (await T.loadTeams(store, { now, cacheMs: 0 })).find((t) => t.name === DEV_TEAM_NAME) || null;
  const token = createSessionToken(env, user, now);
  const teamInfo = team ? { id: team.id, name: team.name, active: team.active !== false, owners: Array.isArray(team.settings?.owners) ? team.settings.owners : [] } : null;
  return json(200, {
    dev: true, token, expiresAt: now + SESSION_TTL_MS, user: U.publicUser(user), team: teamInfo, mustChangePassword: false,
    // Der Superadmin hat kein eigenes Team: der Client betritt dieses (X-CRM-Team), damit er die Daten sieht.
    enterTeamId: user.role === "superadmin" ? team?.id ?? null : null,
    devUsers: publicDevList(),
  });
}
