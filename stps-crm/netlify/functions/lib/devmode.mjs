// STPS CRM – Entwicklungsmodus (nur für die lokale Entwicklung: «das CRM soll lokal kein Passwort verlangen»).
//
// Aktiv NUR, wenn ALLES zutrifft:
//  - ausdrücklich lokal: CRM_DEV_MODE=on ODER `netlify dev` (NETLIFY_DEV=true; `npm run dev`) bzw. `npm run dev:server` (setzt CRM_DEV_MODE=on);
//  - NICHT Produktion (NODE_ENV/CRM_ENV=production, MySQL-Betrieb) und NICHT auf einer bereitgestellten Netlify-Site;
//  - CRM_DEV_MODE ist nicht «off», CRM_PASSWORD ist nicht gesetzt;
//  - es gibt noch keine echten Konten (nur Beispielkonten mit devSeed:true oder nie angemeldete Konten).
// Dann:
//  - /api/ping meldet dev:true, /api/dev/session liefert ohne Anmeldung eine Sitzung (wählbar: admin, pascal, liz, marco),
//    und Anfragen ohne gültiges Token laufen als Pascal (Team-Admin);
//  - fehlt CRM_SECRET, gilt ein fester interner Entwicklungs-Schlüssel (nur hier; session.mjs lehnt ihn sonst ab);
//  - das Team «SwissTech Precision Solutions» mit den vier Beispielkonten wird angelegt, falls es noch keine Konten gibt.
// Ausserhalb des Entwicklungsmodus existiert /api/dev/* nicht (404).
import { randomBytes } from "node:crypto";
import { mutateDoc } from "./kv.mjs";
import * as U from "./users.mjs";
import * as T from "./teams.mjs";
import { createSessionToken, SESSION_TTL_MS, MIN_SECRET_LENGTH, DEV_SECRET, DEV_ACTIVE_FLAG } from "./session.mjs";
import { isProductionEnv, isDeployedNetlify, isNetlifyLocalDev } from "./runtime-env.mjs";
export { DEV_SECRET, isProductionEnv };
import { json, withCookies, sessionCookie } from "./http.mjs";

export const DEV_TEAM_NAME = "SwissTech Precision Solutions";
/** Beispielkonten: key = Name im Rollenwechsler; Pascal ist der Standard. */
export const DEV_USERS = [
  { key: "admin", username: "admin", displayName: "Admin", role: "superadmin" },
  { key: "pascal", username: "pascal", displayName: "Pascal", role: "admin" },
  { key: "liz", username: "liz", displayName: "Liz", role: "member", management: true },
  { key: "marco", username: "marco", displayName: "Marco", role: "member", management: true },
];
export const DEFAULT_DEV_KEY = "pascal";

/** Loopback-Adresse (127.0.0.0/8, ::1, ::ffff:127.x, localhost)? */
export const isLoopbackHost = (h) => {
  const t = String(h ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return t === "localhost" || t === "::1" || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(t);
};

/** Nur anhand der Umgebung: darf der Entwicklungsmodus überhaupt gelten? (Ausdrücklich lokal, nie Produktion/bereitgestellte Site, CRM_PASSWORD nicht gesetzt, nicht «off», nicht an eine öffentliche Adresse gebunden) */
export function devEnvEnabled(env) {
  const mode = String(env?.CRM_DEV_MODE ?? "").trim().toLowerCase();
  if (mode === "off") return false;
  // Bindeadresse (HOST) gesetzt und nicht Loopback (z. B. 0.0.0.0): aus dem Netz erreichbar → nie Entwicklungsmodus
  const penvHost = typeof process !== "undefined" && process.env ? process.env.HOST : "";
  for (const h of [env?.HOST, penvHost]) if (String(h ?? "").trim() && !isLoopbackHost(h)) return false;
  if (isProductionEnv(env) || isDeployedNetlify(env)) return false;
  if (String(env?.CRM_PASSWORD ?? "").trim()) return false;
  return mode === "on" || isNetlifyLocalDev(env);
}

/** Gilt der Entwicklungsmodus jetzt? Nur ohne CRM_PASSWORD und solange es keine echten Konten gibt. */
export async function isDevActive(env, store, now = Date.now()) {
  if (!devEnvEnabled(env)) return false;
  const users = await U.loadUsers(store, { now, cacheMs: 5000 });
  // Echt = hat sich je per Passwort angemeldet (die Erst-Anmeldung des Superadmins setzt lastLoginAt; Beispielkonten und neu angelegte, nie benutzte Konten nicht)
  return users.every((u) => u.devSeed === true || !u.lastLoginAt);
}

/** Umgebung für den Entwicklungsmodus: fehlendes/zu kurzes CRM_SECRET wird durch den festen Schlüssel ersetzt. */
export function withDevEnv(env) {
  if (!devEnvEnabled(env)) return env; // Sicherheitsnetz: ausserhalb des Entwicklungsmodus nie der bekannte Entwicklungs-Schlüssel
  return String(env?.CRM_SECRET ?? "").length >= MIN_SECRET_LENGTH ? env : { ...env, CRM_SECRET: DEV_SECRET, [DEV_ACTIVE_FLAG]: true };
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
  return withCookies(json(200, {
    dev: true, token, expiresAt: now + SESSION_TTL_MS, user: U.publicUser(user), team: teamInfo, mustChangePassword: false,
    // Der Superadmin hat kein eigenes Team: der Client betritt dieses (X-CRM-Team), damit er die Daten sieht.
    enterTeamId: user.role === "superadmin" ? team?.id ?? null : null,
    devUsers: publicDevList(),
  }), [sessionCookie(token, { origin: req.origin, dev: true, maxAgeSec: SESSION_TTL_MS / 1000 })]);
}
