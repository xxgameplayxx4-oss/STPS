// STPS CRM – Konten, Teams und Zusammenarbeit auf API-Ebene (von core.mjs eingehängt).
//
//  login(...)         POST /api/login  (Erst-Anmeldung des Superadmins über CRM_PASSWORD, danach nur noch Konten)
//  authenticate(...)  prüft bei JEDER Anfrage Token, Benutzer (aktiv? Token-Version?) und Team (aktiv?) und bestimmt den Team-Kontext
//  route(...)         /logout /me /me/password /teams /users /team /audit /presence /branding – liefert null, wenn der Pfad nicht hierher gehört
//
// Team-Kontext: Normale Benutzer arbeiten immer im Team aus ihrem Konto – ein mitgeschickter Header X-CRM-Team wird ignoriert.
// Nur der Superadmin kann mit X-CRM-Team in ein Team «eintreten»; ohne Header hat er keinen Team-Kontext (nur Plattform).
import { createHash, timingSafeEqual } from "node:crypto";
import { json, ApiFail, headerOf, bearerToken, clientIp, queryOf, parseBody, logError } from "./http.mjs";
import { createSessionToken, verifySessionToken, getSecret, SESSION_TTL_MS } from "./session.mjs";
import * as U from "./users.mjs";
import * as T from "./teams.mjs";
import * as A from "./audit.mjs";
import * as P from "./presence.mjs";
import * as BR from "./branding.mjs";
import * as DEV from "./devmode.mjs";
import { scrubStamp } from "./hide-super.mjs";
import { mutateDoc } from "./kv.mjs";
import { checkLock, recordFailure, clearFailures, throttleKeys, lockMessage } from "./login-throttle.mjs";

export const GENERIC_LOGIN_ERROR = "Benutzername oder Passwort falsch";
const FAIL_DELAY_MS = 500;
const ID_PATH = /^\/users\/(u_[0-9a-f]{16})$/;
const TEAM_PATH = /^\/teams\/(tm_[0-9a-f]{12})(\/enter|\/branding)?$/;

// ---------------------------------------------------------------- Konfiguration

export const isConfigured = (env) => Boolean(getSecret(env));
export const configProblem = (env) => (getSecret(env) ? null : "CRM_SECRET nicht gesetzt (mindestens 16 Zeichen, z. B. openssl rand -hex 32)");

/** Benutzername des Superadmins bei der Erst-Anmeldung (CRM_ADMIN_USER, Standard «admin»). */
export function bootstrapName(env) {
  try { return U.normalizeUsername(env?.CRM_ADMIN_USER || "admin"); } catch { return "admin"; }
}

const sha = (s) => createHash("sha256").update(String(s)).digest();

// ---------------------------------------------------------------- Superadmin-Passwort vergessen (CRM_ADMIN_RESET)
//
// Ist CRM_ADMIN_RESET gesetzt (beliebiger Zufallswert) und meldet sich jemand mit CRM_ADMIN_USER + CRM_PASSWORD an, wird das Passwort
// dieses Superadmins auf CRM_PASSWORD zurückgesetzt (Pflicht-Wechsel, alle Sitzungen ungültig). Jeder Wert gilt genau einmal:
// sein SHA-256 steht danach im Blob «admin-reset-used»; für das nächste Zurücksetzen braucht es einen neuen Wert.
// Ohne CRM_ADMIN_RESET (oder bei leerem Wert) hat das alles keine Wirkung. Das Ereignis steht im Blob «platform-audit».
export const RESET_USED_KEY = "admin-reset-used";
export const PLATFORM_AUDIT_KEY = "platform-audit";
const RESET_KEEP = 100;
const sha256hex = (s) => createHash("sha256").update(String(s)).digest("hex");
const resetValue = (env) => String(env?.CRM_ADMIN_RESET ?? "").trim();

/** Merkt sich den Reset-Wert atomar als verbraucht. true = dieser Aufruf hat ihn verbraucht (false: war schon verbraucht). */
async function claimAdminReset(store, value, now) {
  const hash = sha256hex(value);
  let claimed = false;
  await mutateDoc(store, RESET_USED_KEY, (doc) => {
    claimed = false;
    const used = Array.isArray(doc?.hashes) ? doc.hashes : [];
    if (used.includes(hash)) return undefined;
    claimed = true;
    return { hashes: [...used, hash].slice(-RESET_KEEP), lastAt: new Date(now).toISOString() };
  });
  return claimed;
}
async function unclaimAdminReset(store, value) {
  const hash = sha256hex(value);
  await mutateDoc(store, RESET_USED_KEY, (doc) => {
    const used = Array.isArray(doc?.hashes) ? doc.hashes : [];
    return used.includes(hash) ? { ...doc, hashes: used.filter((h) => h !== hash) } : undefined;
  }).catch(() => {});
}
const PLATFORM_AUDIT_KEEP = 200;
async function auditAdminReset(store, user, req, now) {
  const entry = { at: new Date(now).toISOString(), uid: user.id, displayName: user.displayName, superadmin: true, action: "admin_reset", table: "platform", recordId: user.id, number: null, label: "Superadmin-Passwort per CRM_ADMIN_RESET zurückgesetzt", fields: [], ip: clientIp(req.headers) || "" };
  console.warn(`Superadmin-Passwort von «${user.username}» per CRM_ADMIN_RESET zurückgesetzt`);
  await mutateDoc(store, PLATFORM_AUDIT_KEY, (doc) => ({ entries: [...(doc?.entries ?? []), entry].slice(-PLATFORM_AUDIT_KEEP) }));
}
const bootstrapPasswordOk = (input, env) => timingSafeEqual(sha(input), sha(env?.CRM_PASSWORD ?? ""));

const o = (deps, now) => ({ now, cacheMs: deps.userCacheMs ?? 5000 });
const fresh = (now) => ({ now, cacheMs: 0 });

const teamInfo = (t) => (t ? { id: t.id, name: t.name, active: t.active !== false, owners: Array.isArray(t.settings?.owners) ? t.settings.owners : [] } : null);

// ---------------------------------------------------------------- Fehler → Antwort

export async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFail) return json(e.status, { error: e.code, message: e.message, ...e.extra });
    throw e;
  }
}

// ---------------------------------------------------------------- Login

/** @param deps { env, store, now, delay, scryptParams? } */
export function login(req, deps, method) {
  return guard(async () => {
    if (method !== "POST") return json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
    const { env, store, now, delay } = deps;
    const body = parseBody(req, 4096);
    const username = U.looseUsername(body.username);
    const password = typeof body.password === "string" ? body.password.slice(0, 1024) : "";
    const keys = throttleKeys(username, clientIp(req.headers));

    const lock = await checkLock(store, keys, now);
    if (lock.locked) return json(429, { error: "locked", message: lockMessage(lock.retryAfterMs), retryAfter: Math.ceil(lock.retryAfterMs / 1000) });

    let users = await U.loadUsers(store, fresh(now));
    let user = null;
    let ok = false;
    if (!users.length) {
      // Erst-Anmeldung: nur CRM_ADMIN_USER + CRM_PASSWORD legt (einmalig) den Superadmin an.
      if (!env.CRM_PASSWORD) return json(500, { error: "not_configured", message: "Noch kein Benutzer vorhanden – bitte CRM_PASSWORD für die Erst-Anmeldung in Netlify setzen", reason: "bootstrap" });
      const nameOk = username === bootstrapName(env);
      const pwOk = bootstrapPasswordOk(password, env);
      if (nameOk && pwOk) {
        await T.migrateLegacy(store, { now }); // alte, nicht getrennte Daten → erstes Team
        try {
          user = await U.bootstrapSuperadmin(store, { username, password, now, scryptParams: deps.scryptParams });
          ok = true;
        } catch (e) {
          if (!(e instanceof ApiFail) || e.code !== "exists") throw e;
          users = await U.loadUsers(store, fresh(now)); // gleichzeitige Erst-Anmeldung: normal weiter
        }
      }
    }
    if (!ok && users.length && resetValue(env) && env.CRM_PASSWORD && username === bootstrapName(env) && bootstrapPasswordOk(password, env)) {
      // Superadmin-Passwort vergessen: gültiger, noch nicht verbrauchter CRM_ADMIN_RESET-Wert → Passwort auf CRM_PASSWORD zurücksetzen
      const target = U.findByUsername(users, username);
      if (target?.role === "superadmin" && (await claimAdminReset(store, resetValue(env), now))) {
        try {
          await U.resetSuperadminPassword(store, target.id, env.CRM_PASSWORD, { scryptParams: deps.scryptParams });
        } catch (e) {
          await unclaimAdminReset(store, resetValue(env)); // nicht verbraucht, wenn das Zurücksetzen scheiterte
          throw e;
        }
        users = await U.loadUsers(store, fresh(now));
        try { await auditAdminReset(store, target, req, now); } catch (e) { console.error("Protokoll fehlgeschlagen:", e?.message || e); }
      }
    }
    if (!ok) {
      user = U.findByUsername(users, username);
      ok = await U.verifyPassword(password, user?.passwordHash); // auch bei unbekanntem Benutzer gleich viel Rechenzeit
    }
    if (!ok || !user) {
      await recordFailure(store, keys, now);
      await delay(FAIL_DELAY_MS);
      return json(401, { error: "invalid_credentials", message: GENERIC_LOGIN_ERROR });
    }
    if (user.active === false) return json(403, { error: "inactive", message: "Dieses Konto ist deaktiviert. Bitte wenden Sie sich an Ihren Admin." });
    let team = null;
    if (user.role !== "superadmin") {
      team = T.teamById(await T.loadTeams(store, fresh(now)), user.teamId);
      if (!team || team.active === false) return json(403, { error: "team_inactive", message: `Das Team${team ? ` «${team.name}»` : ""} ist deaktiviert. Bitte wenden Sie sich an den Plattform-Administrator.`, ...(team ? { team: team.name } : { reason: "unknown" }) });
    }
    await clearFailures(store, keys, now);
    await U.recordLogin(store, user.id, now);
    const token = createSessionToken(env, user, now);
    return json(200, {
      token, expiresAt: now + SESSION_TTL_MS,
      user: U.publicUser({ ...user, lastLoginAt: new Date(now).toISOString() }), team: teamInfo(team), mustChangePassword: Boolean(user.mustChangePassword),
    });
  });
}

// ---------------------------------------------------------------- Authentifizierung + Team-Kontext

const SHAREPOINT_VARS = /^(MS_|SP_)/;
const withoutSharepoint = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !SHAREPOINT_VARS.test(k)));

/**
 * @returns {{ok:true, ctx:object}|{ok:false, response:object}}
 * ctx: { user, isSuper, isAdmin, teamId, team, teams, store (Namensraum des Teams oder null), env (SharePoint nur für sein Team), actor }
 */
export async function authenticate(req, deps, now) {
  const { env, store } = deps;
  const unauth = (message = "Nicht angemeldet", reason = "not_signed_in") => ({ ok: false, response: json(401, { error: "unauthorized", message, reason }) });
  // Ein unbrauchbares Token (auch eines, das eine frühere Version ausgestellt hat) ist immer ein 401 – nie ein 500: Der Browser meldet sich dann neu an.
  let claims = null;
  try {
    claims = verifySessionToken(bearerToken(req.headers), env, now);
  } catch (e) {
    logError("Token prüfen", e);
  }
  // Entwicklungsmodus (nur wenn core.mjs ihn aktiviert hat, d. h. ohne CRM_PASSWORD): ohne gültiges Token läuft die Anfrage als Pascal
  if (!claims && deps.dev) {
    const d = DEV.devUserFor(await U.loadUsers(store, { now, cacheMs: 0 }), DEV.DEFAULT_DEV_KEY);
    if (d) claims = { uid: d.id, tv: d.tokenVersion || 0, exp: now + SESSION_TTL_MS };
  }
  if (!claims) return unauth();
  // Konten und Teams lesen: Scheitert schon das (Datenspeicher), ist das ein echter Serverfehler → api.mjs protokolliert ihn samt Stack.
  const users = await U.loadUsers(store, o(deps, now));
  const teams = await T.loadTeams(store, o(deps, now));
  try {
    const user = U.findById(users, claims.uid);
    if (!user || user.active === false || (user.tokenVersion || 0) !== claims.tv) return unauth("Sitzung abgelaufen – bitte neu anmelden", "expired");
    const isSuper = user.role === "superadmin";
    let team = null;
    if (isSuper) {
      const want = String(headerOf(req.headers, "x-crm-team") || "").trim();
      if (want) {
        team = T.teamById(teams, want);
        if (!team) return { ok: false, response: json(404, { error: "team_not_found", message: "Team nicht gefunden" }) };
      }
    } else {
      team = T.teamById(teams, user.teamId); // Header X-CRM-Team wird bewusst ignoriert
      if (!team || team.active === false) return unauth("Ihr Team ist deaktiviert", "team_inactive");
    }
    const spId = T.sharepointTeamId(env, teams);
    return {
      ok: true,
      ctx: {
        user, isSuper, isAdmin: user.role === "admin", teamId: team?.id ?? null, team, teams,
        store: team ? T.scopedStore(store, team.id) : null,
        env: team && team.id === spId ? env : withoutSharepoint(env),
        actor: { id: user.id, displayName: user.displayName, name: isSuper ? `${user.displayName} (Superadmin)` : user.displayName, superadmin: isSuper },
      },
    };
  } catch (e) {
    // Gespeicherte Daten, die sich nicht auswerten lassen: Sitzung als ungültig behandeln (→ Anmeldeseite), echten Fehler ins Log
    logError("Sitzung auswerten", e, { uid: claims.uid });
    return unauth("Sitzung abgelaufen – bitte neu anmelden", "expired");
  }
}

/** Gestempelter Name statt ?by= vom Client (Excel-/SharePoint-Importe). */
export function withIdentity(req, ctx) {
  const q = queryOf(req);
  q.set("by", ctx.actor.name);
  return { ...req, query: q };
}

// ---------------------------------------------------------------- Routen

const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
const forbidden = (message = "Keine Berechtigung", reason = undefined) => new ApiFail(403, "forbidden", message, reason ? { reason } : {});
const needTeam = (ctx) => {
  if (!ctx.store) throw new ApiFail(409, "team_required", "Bitte zuerst ein Team wählen");
  return ctx.store;
};
const MUST_CHANGE_OK = new Set(["/me", "/me/password", "/logout"]);

export function route(path, method, req, deps, ctx) {
  return guard(async () => {
    const { store: root, env, now } = deps;
    const { user } = ctx;
    if (user.mustChangePassword && !MUST_CHANGE_OK.has(path)) {
      return json(403, { error: "password_change_required", message: "Bitte zuerst ein neues Passwort festlegen" });
    }

    // ---- Konto
    if (path === "/logout") return method === "POST" ? json(200, { ok: true }) : wrongMethod();
    if (path === "/me") {
      if (method !== "GET") return wrongMethod();
      return json(200, { user: U.publicUser(user), team: teamInfo(ctx.team), superadmin: ctx.isSuper, mustChangePassword: Boolean(user.mustChangePassword), now: new Date(now).toISOString() });
    }
    if (path === "/me/password") {
      if (method !== "POST") return wrongMethod();
      const body = parseBody(req, 4096);
      const keys = [`u:${user.username}`];
      const lock = await checkLock(root, keys, now);
      if (lock.locked) return json(429, { error: "locked", message: lockMessage(lock.retryAfterMs), retryAfter: Math.ceil(lock.retryAfterMs / 1000) });
      if (typeof body.current !== "string" || !(await U.verifyPassword(body.current, user.passwordHash))) {
        await recordFailure(root, keys, now);
        await deps.delay(FAIL_DELAY_MS);
        return json(403, { error: "wrong_password", message: "Das aktuelle Passwort ist falsch" });
      }
      U.checkPasswordPolicy(body.new, { username: user.username, current: body.current });
      const updated = await U.setOwnPassword(root, user.id, user.tokenVersion || 0, body.new, { scryptParams: deps.scryptParams });
      await clearFailures(root, keys, now);
      return json(200, { ok: true, token: createSessionToken(env, updated, now), expiresAt: now + SESSION_TTL_MS, user: U.publicUser(updated) });
    }

    // ---- Plattform (nur Superadmin)
    if (path === "/teams" || TEAM_PATH.test(path)) {
      if (!ctx.isSuper) throw forbidden("Nur für den Plattform-Administrator", "platform_only");
      return teamRoutes(path, method, req, deps, ctx);
    }

    // ---- Benutzerverwaltung (Superadmin: alle Teams, Team-Admin: eigenes Team)
    if (path === "/users" || ID_PATH.test(path)) {
      if (!ctx.isSuper && !ctx.isAdmin) throw forbidden("Nur Admins dürfen Benutzer verwalten", "admins_only");
      return userRoutes(path, method, req, deps, ctx);
    }

    // ---- Darstellung (Logo, Anzeigename) des eigenen bzw. betretenen Teams; ohne Team (Superadmin auf der Plattform): Standard-Darstellung
    if (path === "/branding") {
      if (!ctx.store && method === "GET") return json(200, { team: null, branding: null });
      return brandingRoutes(method, req, deps, ctx, ctx.team, needTeam(ctx));
    }

    // ---- Zusammenarbeit im Team
    if (path === "/team") {
      if (method !== "GET") return wrongMethod();
      return teamOverview(deps, ctx);
    }
    if (path === "/audit") {
      if (method !== "GET") return wrongMethod();
      return json(200, { entries: await A.queryAudit(needTeam(ctx), queryOf(req), { hideSuper: !ctx.isSuper }) });
    }
    if (path === "/presence") {
      if (method !== "GET" && method !== "POST") return wrongMethod();
      if (!ctx.store) return json(200, { now: new Date(now).toISOString(), presence: [], lastSeen: {} }); // Superadmin auf der Plattform: nirgends anwesend
      if (method === "POST") await P.heartbeat(ctx.store, user.id, parseBody(req, 4096), now);
      return json(200, await readTeamPresence(deps, ctx));
    }
    return null;
  });
}

/** Übernommene Excel-/SharePoint-Importe erscheinen als eine Zeile im Änderungsprotokoll. Die Antwort bleibt unverändert. */
export async function noteImport(result, ctx, now) {
  const b = result?.body;
  if (result?.status !== 200 || !b || b.dryRun !== false || b.saved !== true || !ctx.store) return result;
  const t = b.totals || {};
  try {
    await A.appendAudit(ctx.store, [{
      at: new Date(now).toISOString(), uid: ctx.user.id, displayName: ctx.user.displayName, ...(ctx.isSuper ? { superadmin: true } : {}),
      action: "import", table: "import", recordId: "", number: null, fields: [],
      label: `${b.source === "sharepoint" ? "SharePoint" : "Excel"}-Import: ${t.added ?? 0} neu, ${t.updated ?? 0} geändert`,
    }]);
  } catch (err) {
    console.error("Änderungsprotokoll fehlgeschlagen:", err?.message || err);
  }
  return result;
}

// ---------------------------------------------------------------- Teams (Plattform)

async function teamRoutes(path, method, req, deps, ctx) {
  const { store: root, now } = deps;
  if (path === "/teams") {
    if (method === "GET") {
      const teams = await T.loadTeams(root, fresh(now));
      const users = await U.loadUsers(root, fresh(now));
      const spId = T.sharepointTeamId(deps.env, teams);
      const out = [];
      for (const t of teams) {
        const members = users.filter((u) => u.teamId === t.id && u.role !== "superadmin");
        const pres = (await T.scopedStore(root, t.id).read(P.PRESENCE_KEY))?.value?.users ?? {};
        const stamps = [...members.map((u) => u.lastLoginAt), ...members.map((u) => pres[u.id]?.at)].filter(Boolean).sort();
        out.push({
          id: t.id, name: t.name, active: t.active !== false, createdAt: t.createdAt, settings: { owners: t.settings?.owners ?? [] },
          members: { total: members.length, active: members.filter((u) => u.active !== false).length, admins: members.filter((u) => u.role === "admin" && u.active !== false).length },
          lastActivityAt: stamps.length ? stamps[stamps.length - 1] : null,
          sharepoint: t.id === spId,
        });
      }
      return json(200, { teams: out });
    }
    if (method === "POST") {
      const body = parseBody(req);
      return json(201, { team: T.publicTeam(await T.createTeam(root, body.name, { now })) });
    }
    return wrongMethod();
  }
  const m = TEAM_PATH.exec(path);
  const id = m[1];
  if (m[2] === "/branding") {
    // Superadmin: Darstellung jedes Teams (Plattform), ohne das Team zu betreten
    const team = T.teamById(await T.loadTeams(root, fresh(now)), id);
    if (!team) throw new ApiFail(404, "team_not_found", "Team nicht gefunden");
    return brandingRoutes(method, req, deps, ctx, team, T.scopedStore(root, id));
  }
  if (m[2]) {
    if (method !== "POST") return wrongMethod();
    const team = T.teamById(await T.loadTeams(root, fresh(now)), id);
    if (!team) throw new ApiFail(404, "team_not_found", "Team nicht gefunden");
    await A.appendAudit(T.scopedStore(root, id), [{
      at: new Date(now).toISOString(), uid: ctx.user.id, displayName: ctx.user.displayName, superadmin: true, action: "enter", table: "team",
      recordId: id, number: null, label: "Superadmin-Zugriff", fields: [],
    }]).catch((e) => console.error("Audit fehlgeschlagen:", e?.message || e));
    return json(200, { team: teamInfo(team) });
  }
  if (method !== "PATCH") return wrongMethod();
  const body = parseBody(req);
  const team = await T.updateTeam(root, id, { name: body.name, active: body.active }, { now });
  return json(200, { team: T.publicTeam(team) });
}

// ---------------------------------------------------------------- Darstellung (Logo)

const BRANDING_LABEL = { logo: "Logo geändert", color: "Farbe geändert", name: "Anzeigename geändert", reset: "Darstellung zurückgesetzt" }; // recordId = Schlüssel; der Browser übersetzt anhand davon (team.js)

/**
 * GET/PUT/DELETE /api/branding bzw. /api/teams/<id>/branding. `store` ist der Namensraum des betroffenen Teams (nie der eines anderen:
 * Team-Konten kommen nur über ihr eigenes Team hierher). Lesen darf jedes Mitglied; Ändern und Zurücksetzen nur Team-Admins und der Superadmin.
 * Jede Änderung steht im Änderungsprotokoll des Teams.
 */
async function brandingRoutes(method, req, deps, ctx, team, store) {
  const { now } = deps;
  const opts = { now, seed: T.isLegacyTeam(team) };
  const reply = (doc) => {
    const b = BR.publicBranding(doc);
    return json(200, { team: { id: team.id, name: team.name }, branding: b && !ctx.isSuper ? { ...b, updatedBy: scrubStamp(b.updatedBy) } : b }); // Mitglieder sehen den Superadmin nicht als Autor
  };
  if (method === "GET") return reply(await BR.readBranding(store, opts));
  if (method !== "PUT" && method !== "DELETE") return wrongMethod();
  if (!ctx.isSuper && !ctx.isAdmin) throw forbidden("Nur Admins dürfen die Darstellung ändern", "branding_admins_only");
  const note = (kinds) => A.appendAudit(store, kinds.map((k) => ({
    at: new Date(now).toISOString(), uid: ctx.user.id, displayName: ctx.user.displayName, ...(ctx.isSuper ? { superadmin: true } : {}),
    action: "branding", table: "branding", recordId: k, number: null, label: BRANDING_LABEL[k], fields: [],
  }))).catch((e) => console.error("Änderungsprotokoll fehlgeschlagen:", e?.message || e));
  if (method === "PUT") {
    if (Buffer.byteLength(req.bodyText || "") > BR.MAX_BODY_BYTES) throw new ApiFail(413, "bad_logo", "Das Logo ist zu gross (höchstens 300 KB)", { reason: "size" });
    const { doc, changed } = await BR.updateBranding(store, parseBody(req, BR.MAX_BODY_BYTES), ctx.actor, opts);
    await note([...(changed.logo ? ["logo"] : []), ...(changed.color ? ["color"] : []), ...(changed.name ? ["name"] : [])]);
    return reply(doc);
  }
  await BR.readBranding(store, opts); // das SwissTech-Team: Anfangsdarstellung zuerst setzen, damit «Zurücksetzen» sie wirklich ersetzt
  if (await BR.resetBranding(store, ctx.actor, { now })) await note(["reset"]);
  return reply(null);
}

// ---------------------------------------------------------------- Benutzerverwaltung

async function userRoutes(path, method, req, deps, ctx) {
  const { store: root, now } = deps;
  const syncOwners = async (teamId) => {
    if (teamId) await T.syncOwners(root, teamId, await U.loadUsers(root, fresh(now)));
  };
  if (path === "/users") {
    if (method === "GET") {
      const users = await U.loadUsers(root, fresh(now));
      const want = queryOf(req).get("teamId");
      let list;
      if (ctx.isSuper) list = want ? users.filter((u) => u.teamId === want) : users;
      else list = users.filter((u) => u.teamId === ctx.user.teamId && u.role !== "superadmin"); // teamId-Parameter wird ignoriert
      return json(200, { users: list.map(U.publicUser) });
    }
    if (method === "POST") {
      const body = parseBody(req);
      if (ctx.isSuper) {
        const team = T.teamById(await T.loadTeams(root, fresh(now)), body.teamId);
        if (!team) throw new ApiFail(400, "bad_team", "Bitte ein Team wählen");
      }
      const { user, temporaryPassword } = await U.createUser(root, body, ctx.user, { now, scryptParams: deps.scryptParams });
      await syncOwners(user.teamId);
      return json(201, { user: U.publicUser(user), temporaryPassword });
    }
    return wrongMethod();
  }
  if (method !== "PATCH") return wrongMethod();
  const body = parseBody(req);
  const { user, temporaryPassword } = await U.updateUser(root, ID_PATH.exec(path)[1], body, ctx.user, { scryptParams: deps.scryptParams });
  await syncOwners(user.teamId);
  return json(200, { user: U.publicUser(user), ...(temporaryPassword ? { temporaryPassword } : {}) });
}

// ---------------------------------------------------------------- Team-Seite

/** Wer im Team angezeigt werden darf: aktive Mitglieder; der Superadmin (Besucher) nur für den Superadmin selbst – Mitglieder erfahren nie von ihm. */
async function presenceMembers(deps, ctx) {
  const users = await U.loadUsers(deps.store, o(deps, deps.now));
  return {
    members: users.filter((u) => u.teamId === ctx.teamId && u.active !== false && u.role !== "superadmin"),
    visitors: ctx.isSuper ? users.filter((u) => u.role === "superadmin" && u.active !== false) : [],
  };
}

async function readTeamPresence(deps, ctx) {
  const { members, visitors } = await presenceMembers(deps, ctx);
  return P.readPresence(ctx.store, [...members, ...visitors], deps.now);
}

async function teamOverview(deps, ctx) {
  const store = needTeam(ctx);
  const { members, visitors } = await presenceMembers(deps, ctx);
  const pres = await P.readPresence(store, [...members, ...visitors], deps.now);
  const recent = await A.recentByUser(store, members.map((u) => u.id), 10);
  return json(200, {
    now: pres.now,
    team: teamInfo(ctx.team),
    users: members.map((u) => ({
      id: u.id, displayName: u.displayName, role: u.role, ownerKey: u.ownerKey || "", lastLoginAt: u.lastLoginAt || null,
      presence: pres.presence.find((p) => p.uid === u.id) || null,
      lastSeenAt: pres.lastSeen[u.id] || null,
      recent: recent[u.id] || [],
    })),
    visitors: pres.presence.filter((p) => p.superadmin),
  });
}
