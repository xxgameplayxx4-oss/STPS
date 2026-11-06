// STPS CRM – Benutzerkonten: Passwort-Hashing (scrypt), Benutzer-Dokument «users», Anlegen/Ändern mit Rollenregeln.
//
// Rollen:  superadmin (Plattform, gehört keinem Team) · admin (Team-Admin) · member (Team-Mitglied)
// Ein Benutzer gehört zu genau einem Team (teamId), der Superadmin zu keinem (teamId = null).
// Das Dokument «users» enthält alle Benutzer; Passwort-Hashes verlassen dieses Modul nie (publicUser()).
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mutateDoc } from "./kv.mjs";
import { fail, cleanText } from "./http.mjs";

export const USERS_KEY = "users";
export const ROLES = ["superadmin", "admin", "member"];
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
export const MAX_USERS = 500;

/** scrypt-Parameter (werden pro Benutzer mitgespeichert, damit sie später erhöht werden können). */
export const DEFAULT_SCRYPT = { N: 65536, r: 8, p: 1, keylen: 64 };

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------- Passwörter

const validParams = (h) =>
  h && h.algo === "scrypt" && typeof h.salt === "string" && typeof h.hash === "string" &&
  Number.isInteger(h.N) && h.N >= 1024 && h.N <= 2 ** 18 && (h.N & (h.N - 1)) === 0 &&
  Number.isInteger(h.r) && h.r >= 1 && h.r <= 16 && Number.isInteger(h.p) && h.p >= 1 && h.p <= 16 &&
  Number.isInteger(h.keylen) && h.keylen >= 16 && h.keylen <= 128;

const derive = (password, h, salt) =>
  scryptAsync(String(password).normalize("NFKC"), salt, h.keylen, { N: h.N, r: h.r, p: h.p, maxmem: 128 * h.N * h.r * 2 + 1024 * 1024 });

export async function hashPassword(password, params = DEFAULT_SCRYPT) {
  const p = { ...DEFAULT_SCRYPT, ...(params || {}) };
  const salt = randomBytes(16);
  const hash = await derive(password, p, salt);
  return { algo: "scrypt", N: p.N, r: p.r, p: p.p, keylen: p.keylen, salt: salt.toString("base64"), hash: hash.toString("base64") };
}

let dummyHash;
/** Für unbekannte Benutzernamen: gleich viel Rechenzeit wie bei einem echten Konto (verhindert Benutzer-Erkennung per Laufzeit). */
const dummy = () => (dummyHash ??= hashPassword(randomBytes(12).toString("hex")));

/** Zeitkonstanter Vergleich. rec = gespeicherter passwordHash (oder nichts → Scheinprüfung, immer false). */
export async function verifyPassword(password, rec) {
  const real = validParams(rec);
  const target = real ? rec : await dummy();
  let ok = false;
  try {
    const expected = Buffer.from(target.hash, "base64");
    const got = await derive(typeof password === "string" ? password : "", target, Buffer.from(target.salt, "base64"));
    ok = got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    ok = false;
  }
  return real && ok;
}

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/l/I
/** Zufälliges Einmalpasswort, z. B. «kR7x-Ym3p-Wq9b» (12 Zeichen, ~68 Bit). */
export function generateTempPassword() {
  const group = () => Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

export function checkPasswordPolicy(next, { username = "", current = null } = {}) {
  if (typeof next !== "string") throw fail(400, "bad_password", "Bitte ein neues Passwort eingeben");
  if (next.length < MIN_PASSWORD) throw fail(400, "weak_password", `Das neue Passwort muss mindestens ${MIN_PASSWORD} Zeichen lang sein`, { reason: "min", min: MIN_PASSWORD });
  if (next.length > MAX_PASSWORD) throw fail(400, "weak_password", `Das neue Passwort darf höchstens ${MAX_PASSWORD} Zeichen lang sein`, { reason: "max", max: MAX_PASSWORD });
  if (username && next.toLowerCase() === username.toLowerCase()) throw fail(400, "weak_password", "Das Passwort darf nicht dem Benutzernamen entsprechen", { reason: "username" });
  if (current !== null && next === current) throw fail(400, "weak_password", "Das neue Passwort muss sich vom bisherigen unterscheiden", { reason: "same" });
}

// ---------------------------------------------------------------- Eingaben prüfen

export function normalizeUsername(v) {
  const u = String(v ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u)) {
    throw fail(400, "bad_username", "Benutzername: 2–32 Zeichen, nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich und Unterstrich");
  }
  return u;
}
/** Für den Login: nie werfen, nur normalisieren und kürzen. */
export const looseUsername = (v) => String(v ?? "").trim().toLowerCase().slice(0, 64);

export function cleanDisplayName(v) {
  const n = cleanText(v, 40);
  if (!n) throw fail(400, "bad_name", "Bitte einen Anzeigenamen eingeben", { reason: "user" });
  // «… (Superadmin)» ist die Kennzeichnung der Stempel des Plattform-Kontos (hide-super.mjs) und darf kein Name sein
  if (/\(superadmin\)\s*$/i.test(n)) throw fail(400, "bad_name", "Dieser Anzeigename ist nicht erlaubt", { reason: "user" });
  return n;
}
export const cleanOwnerKey = (v) => cleanText(v, 40);

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[^\s@<>"',;:()[\]\\]{1,120}\.[A-Za-z]{2,24}$/;
/** Optionale E-Mail-Adresse (für den E-Mail-Ersatz der Chat-Benachrichtigung): leer = keine; sonst klein geschrieben und geprüft */
export function cleanEmail(v) {
  const e = String(v ?? "").trim().toLowerCase();
  if (!e) return "";
  if (e.length > 160 || !EMAIL_RE.test(e)) throw fail(400, "bad_email", "Bitte eine gültige E-Mail-Adresse eingeben");
  return e;
}

/** Management-Kennzeichen (Zugang zum Chat-Kanal «Geschäftsleitung»): nur true/false; fehlt = false */
export function cleanManagement(v) {
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw fail(400, "bad_request", "Ungültiger Wert für «management»");
  return v;
}

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  teamId: u.teamId ?? null,
  ownerKey: u.ownerKey || "",
  email: typeof u.email === "string" ? u.email : "",
  active: u.active !== false,
  management: u.management === true,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt || null,
  mustChangePassword: Boolean(u.mustChangePassword),
});

// ---------------------------------------------------------------- Dokument «users» (kurz zwischengespeichert)

const caches = new WeakMap();
export const invalidateUsers = (store) => caches.delete(store);

/**
 * Gespeicherte Konten von älteren Versionen (oder von Hand veränderte) lesbar machen: fehlende Felder bekommen die Standardwerte,
 * die der Rest des Codes ohnehin annimmt; Einträge, die kein Konto sind (null, Zahl, ohne ID), werden übergangen – sie dürfen nie
 * eine Anfrage zum Absturz bringen. Verändert die gespeicherten Daten nicht (nur die gelesene Kopie).
 */
export function normalizeUser(u) {
  if (!u || typeof u !== "object" || Array.isArray(u) || typeof u.id !== "string" || !u.id) return null;
  const tv = Number(u.tokenVersion);
  return {
    ...u,
    username: typeof u.username === "string" ? u.username : "",
    displayName: typeof u.displayName === "string" && u.displayName ? u.displayName : typeof u.username === "string" ? u.username : "",
    role: ROLES.includes(u.role) ? u.role : "member",
    teamId: typeof u.teamId === "string" && u.teamId ? u.teamId : null,
    ownerKey: typeof u.ownerKey === "string" ? u.ownerKey : "",
    management: u.management === true,
    active: u.active !== false,
    tokenVersion: Number.isInteger(tv) && tv >= 0 ? tv : 0,
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}

/** Höchstens `cacheMs` (Standard 5 s) alt; eigene Änderungen leeren den Zwischenspeicher sofort. Ergebnis nicht verändern! */
export async function loadUsers(store, { now = Date.now(), cacheMs = 5000 } = {}) {
  const c = caches.get(store);
  if (c && now >= c.at && now - c.at < cacheMs) return c.users;
  const doc = await store.read(USERS_KEY);
  const users = Array.isArray(doc?.value?.users) ? doc.value.users.map(normalizeUser).filter(Boolean) : [];
  caches.set(store, { at: now, users });
  return users;
}

export const findByUsername = (users, username) => (username ? users.find((u) => u.username === username) || null : null);
export const findById = (users, id) => users.find((u) => u.id === id) || null;

const newId = () => "u_" + randomBytes(8).toString("hex");

async function write(store, fn) {
  try {
    return await mutateDoc(store, USERS_KEY, fn);
  } finally {
    invalidateUsers(store);
  }
}

// ---------------------------------------------------------------- Anlegen

/** Erstes Konto: der Superadmin (nur wenn es noch gar keine Benutzer gibt). */
export async function bootstrapSuperadmin(store, { username, password, now = Date.now(), scryptParams }) {
  const passwordHash = await hashPassword(password, scryptParams);
  let created;
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    if (users.length) throw fail(409, "exists", "Es gibt bereits Benutzer");
    created = {
      id: newId(), username, displayName: username.charAt(0).toUpperCase() + username.slice(1), role: "superadmin", teamId: null,
      ownerKey: "", passwordHash, active: true, tokenVersion: 0, createdAt: new Date(now).toISOString(), lastLoginAt: null, mustChangePassword: true,
    };
    return { users: [created] };
  });
  return created;
}

/**
 * Benutzer anlegen (immer mit Einmalpasswort, das genau einmal zurückgegeben wird).
 * actor = Superadmin (teamId aus input) oder Team-Admin (immer das eigene Team).
 */
export async function createUser(store, input, actor, { now = Date.now(), scryptParams } = {}) {
  const username = normalizeUsername(input.username);
  const displayName = cleanDisplayName(input.displayName);
  if (input.role !== "admin" && input.role !== "member") throw fail(400, "bad_role", "Rolle muss «admin» oder «member» sein");
  const teamId = actor.role === "superadmin" ? input.teamId : actor.teamId;
  const ownerKey = input.ownerKey === undefined || input.ownerKey === null ? displayName : cleanOwnerKey(input.ownerKey);
  const email = cleanEmail(input.email);
  const management = cleanManagement(input.management);
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword, scryptParams);
  let user;
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    if (users.some((u) => u.username === username)) throw fail(409, "username_taken", "Dieser Benutzername ist bereits vergeben");
    if (users.length >= MAX_USERS) throw fail(409, "too_many", "Maximale Anzahl Benutzer erreicht", { reason: "users" });
    user = {
      id: newId(), username, displayName, role: input.role, teamId, ownerKey, ...(email ? { email } : {}), ...(management ? { management: true } : {}), passwordHash, active: true, tokenVersion: 0,
      createdAt: new Date(now).toISOString(), lastLoginAt: null, mustChangePassword: true,
    };
    return { users: [...users, user] };
  });
  return { user, temporaryPassword };
}

// ---------------------------------------------------------------- Ändern

const OWN_ONLY = "Das Plattform-Konto lässt sich nur über «Passwort ändern» und den Anzeigenamen anpassen";

/**
 * Benutzer ändern: displayName, ownerKey, email, role (admin|member), management (true|false), active, resetPassword.
 * Regeln: Team-Admins nur im eigenen Team; nie sich selbst deaktivieren/herabstufen/zurücksetzen;
 * pro Team bleibt immer mindestens ein aktiver Admin.
 */
export async function updateUser(store, targetId, patch, actor, { scryptParams } = {}) {
  let temporaryPassword = null;
  let tempHash = null;
  if (patch.resetPassword === true) {
    temporaryPassword = generateTempPassword();
    tempHash = await hashPassword(temporaryPassword, scryptParams);
  }
  let result;
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    const i = users.findIndex((u) => u.id === targetId);
    const t = users[i];
    // Fremde Teams (und der Superadmin für Team-Admins) sind unsichtbar → 404, nicht 403.
    if (!t || (actor.role !== "superadmin" && (t.teamId !== actor.teamId || t.role === "superadmin"))) throw fail(404, "not_found", "Benutzer nicht gefunden", { reason: "user" });
    const self = t.id === actor.id;
    const next = { ...t };

    if (patch.displayName !== undefined) next.displayName = cleanDisplayName(patch.displayName);
    if (t.role === "superadmin") {
      if (!self || patch.role !== undefined || patch.active !== undefined || patch.resetPassword !== undefined || patch.ownerKey !== undefined) throw fail(403, "forbidden", OWN_ONLY, { reason: "own_account" });
    } else {
      if (patch.ownerKey !== undefined) next.ownerKey = cleanOwnerKey(patch.ownerKey);
      if (patch.email !== undefined) {
        const email = cleanEmail(patch.email);
        if (email) next.email = email; else delete next.email;
      }
      if (patch.management !== undefined) {
        // nur Team-Admin/Superadmin erreichen diese Funktion (Routen /users/:id); ein Admin hat den Zugang ohnehin durch seine Rolle
        if (cleanManagement(patch.management)) next.management = true; else delete next.management;
      }
      if (patch.role !== undefined) {
        if (patch.role !== "admin" && patch.role !== "member") throw fail(400, "bad_role", "Rolle muss «admin» oder «member» sein");
        if (self && patch.role !== t.role) throw fail(403, "self", "Sie können Ihre eigene Rolle nicht ändern", { reason: "role" });
        next.role = patch.role;
      }
      if (patch.active !== undefined) {
        if (typeof patch.active !== "boolean") throw fail(400, "bad_request", "Ungültiger Wert für «active»");
        if (self && !patch.active) throw fail(403, "self", "Sie können sich nicht selbst deaktivieren", { reason: "deactivate" });
        next.active = patch.active;
        if (!patch.active) next.tokenVersion = (t.tokenVersion || 0) + 1; // sofort abmelden
      }
      if (patch.resetPassword === true) {
        if (self) throw fail(403, "self", "Ihr eigenes Passwort ändern Sie über «Passwort ändern»", { reason: "password" });
        next.passwordHash = tempHash;
        next.mustChangePassword = true;
        next.tokenVersion = (next.tokenVersion || 0) + 1;
      }
      const wasAdmin = t.role === "admin" && t.active !== false;
      const stillAdmin = next.role === "admin" && next.active !== false;
      if (wasAdmin && !stillAdmin) {
        const others = users.filter((u) => u.id !== t.id && u.teamId === t.teamId && u.role === "admin" && u.active !== false);
        if (!others.length) throw fail(409, "last_admin", "Mindestens ein aktiver Admin muss im Team bleiben – zuerst jemand anderen zum Admin machen (oder das ganze Team deaktivieren)");
      }
    }
    result = next;
    const out = [...users];
    out[i] = next;
    return { users: out };
  });
  return { user: result, temporaryPassword };
}

/** Eigenes Passwort setzen (current wurde vom Aufrufer bereits geprüft). expectedTv schützt vor gleichzeitigen Änderungen. */
export async function setOwnPassword(store, userId, expectedTv, newPassword, { scryptParams } = {}) {
  const passwordHash = await hashPassword(newPassword, scryptParams);
  let result;
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    const i = users.findIndex((u) => u.id === userId);
    if (i < 0 || (users[i].tokenVersion || 0) !== expectedTv || users[i].active === false) throw fail(401, "unauthorized", "Sitzung abgelaufen – bitte neu anmelden", { reason: "expired" });
    result = { ...users[i], passwordHash, mustChangePassword: false, tokenVersion: (users[i].tokenVersion || 0) + 1 };
    const out = [...users];
    out[i] = result;
    return { users: out };
  });
  return result;
}

/**
 * Notfall-Zurücksetzen des Superadmin-Passworts (CRM_ADMIN_RESET, siehe accounts.mjs): neues Passwort, Pflicht-Wechsel beim nächsten Login,
 * alle bestehenden Sitzungen ungültig (tokenVersion + 1). Betrifft nur Konten mit der Rolle «superadmin».
 */
export async function resetSuperadminPassword(store, userId, password, { scryptParams } = {}) {
  const passwordHash = await hashPassword(password, scryptParams);
  let result;
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    const i = users.findIndex((u) => u.id === userId && u.role === "superadmin");
    if (i < 0) throw fail(404, "not_found", "Benutzer nicht gefunden", { reason: "user" });
    result = { ...users[i], passwordHash, mustChangePassword: true, tokenVersion: (users[i].tokenVersion || 0) + 1 };
    const out = [...users];
    out[i] = result;
    return { users: out };
  });
  return result;
}

export async function recordLogin(store, userId, now = Date.now()) {
  await write(store, (doc) => {
    const users = doc?.users ?? [];
    const i = users.findIndex((u) => u.id === userId);
    if (i < 0) return undefined;
    const out = [...users];
    out[i] = { ...users[i], lastLoginAt: new Date(now).toISOString() };
    return { users: out };
  });
}
