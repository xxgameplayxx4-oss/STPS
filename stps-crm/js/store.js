// Datenschicht: hält die gesamte Datenbank im Speicher, speichert entprellt auf den Server
// (optimistische Version, 3-Wege-Merge bei 409) bzw. im Lokalen Modus nur in localStorage.
import { LS, NR_BASE, COLLECTIONS, DEFAULT_LISTS, APP } from "./config.js";
import * as api from "./api.js";
import { uid, clone } from "./util.js";
import { t, errorText } from "./i18n.js";
import { mergeDb } from "./merge.js";
import { defaultBilling, normalizeBilling, nextInvoiceNr, nextArtNr, isRetainedInvoice } from "./billing.js";
import { countryCode } from "./countries.js";

// ------------------------------------------------------------ Zustand

/** Öffentlicher, nur lesbarer Zustand */
export const S = {
  mode: "init", // 'server' | 'local' | 'offline'
  status: "saved", // 'saved' | 'dirty' | 'saving' | 'error'
  // statusMsg (Getter, siehe unten): Text zum Status in der gewählten Sprache
  version: 0,
  savedAt: null,
  savedBy: "",
  noTeam: false, // Superadmin ohne betretenes Team (Plattform): es gibt keine Teamdaten
};

let db = emptyDb();
let baseData = null; // letzter vom Server bestätigter Stand (Basis für den Merge)
let gen = 0; // Zähler lokaler Änderungen
let dirty = false;
let saving = false;
let saveAgain = false;
let saveTimer = null;
let retryTimer = null;
let batchDepth = 0;
let batchChanged = false;
const listeners = new Set();

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(type, detail = {}) { for (const fn of [...listeners]) { try { fn({ type, ...detail }); } catch (e) { console.error(e); } } }

// Der Statustext wird als Quelle gemerkt ({key, params} | {err} | {raw}) und beim Lesen übersetzt – so folgt er einem Sprachwechsel.
let statusSrc = null;
const statusText = (m) => (!m ? "" : m.key ? t(m.key, m.params) : m.err ? m.err.message || t("store.saveFailed") : String(m.raw ?? ""));
Object.defineProperty(S, "statusMsg", { enumerable: true, get: () => statusText(statusSrc) });

function setStatus(status, msg = null) {
  S.status = status;
  statusSrc = msg;
  emit("status");
}

export const isDirty = () => dirty;

// ------------------------------------------------------------ localStorage (alles in try/catch)

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

// ------------------------------------------------------------ DB-Struktur

export function emptyDb() {
  const d = { schema: APP.schema, meta: { createdAt: new Date().toISOString(), lastNr: {} }, lists: {}, settings: { billing: defaultBilling() } };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

/** Kunde: Land als Ländercode («Schweiz» → «CH», unbekannte Freitexte bleiben), Lieferadressen als Liste mit Unternummer (alte Daten: keine) */
function normalizeCustomerAddresses(rec) {
  if (rec.land) rec.land = countryCode(rec.land) || rec.land;
  const list = Array.isArray(rec.addresses) ? rec.addresses.filter((x) => x && typeof x === "object") : [];
  let seq = Number(rec.addrSeq) || 0;
  const used = new Set();
  rec.addresses = list.map((a) => {
    const sub = Number(a.sub) > 0 && !used.has(Number(a.sub)) ? Number(a.sub) : 0;
    if (sub) { used.add(sub); seq = Math.max(seq, sub); }
    return { ...a, id: a.id || uid(), sub, same: Boolean(a.same), aktiv: a.aktiv !== false, land: a.land ? countryCode(a.land) || a.land : "" };
  }).map((a) => (a.sub ? a : { ...a, sub: ++seq }));
  rec.addrSeq = seq;
}

/** Prüft/ergänzt eine Datenbank (Import, Server, Cache). Wirft Error bei unbrauchbarer Struktur. */
export function normalizeDb(raw) {
  let src = raw;
  if (src && typeof src === "object" && !Array.isArray(src) && !("schema" in src) && !("customers" in src)) {
    src = src.db ?? src.data ?? src; // Export-Hüllen
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) throw new Error(t("store.invalidDbFile"));
  if (!COLLECTIONS.some((c) => Array.isArray(src[c])) && !("schema" in src)) throw new Error(t("store.invalidDbNoTables"));
  const d = emptyDb();
  d.meta = { ...d.meta, ...(src.meta && typeof src.meta === "object" ? src.meta : {}) };
  d.meta.lastNr = { ...(typeof d.meta.lastNr === "object" && d.meta.lastNr ? d.meta.lastNr : {}) };
  for (const c of COLLECTIONS) {
    const arr = src[c];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) throw new Error(t("store.invalidTable", { name: c }));
    d[c] = arr.map((r) => {
      if (!r || typeof r !== "object") throw new Error(t("store.invalidRecord", { name: c }));
      const rec = { ...r };
      if (!rec.id) rec.id = uid();
      if (c === "customers" || c === "suppliers") {
        rec.contacts = Array.isArray(rec.contacts) ? rec.contacts.filter((x) => x && typeof x === "object").map((x) => ({ ...x, id: x.id || uid() })) : [];
      }
      if (c === "customers") normalizeCustomerAddresses(rec);
      // Positionen (Offerten: optional, fehlt = alter manueller Wert; Rechnungen: immer eine Liste)
      if (c === "invoices" || c === "deals") {
        if (rec.positions !== undefined && !Array.isArray(rec.positions)) rec.positions = [];
        if (c === "invoices" && rec.positions === undefined) rec.positions = [];
        if (rec.positions) rec.positions = rec.positions.filter((x) => x && typeof x === "object").map((x) => (x.id ? x : { ...x, id: uid() }));
      }
      return rec;
    });
  }
  if (src.lists && typeof src.lists === "object") {
    for (const k of Object.keys(DEFAULT_LISTS)) if (Array.isArray(src.lists[k])) d.lists[k] = src.lists[k];
  }
  d.settings = { ...(src.settings && typeof src.settings === "object" && !Array.isArray(src.settings) ? src.settings : {}), billing: normalizeBilling(src.settings?.billing) };
  for (const [c, base] of Object.entries(NR_BASE)) {
    const max = d[c].reduce((m, r) => Math.max(m, Number(r.nr) || 0), base - 1);
    d.meta.lastNr[c] = Math.max(Number(d.meta.lastNr[c]) || 0, max);
  }
  if (d.invoices.length || d.meta.lastNr.invoices) {
    d.meta.lastNr.invoices = Math.max(Number(d.meta.lastNr.invoices) || 0, ...d.invoices.map((r) => Number(r.nr) || 0));
  }
  return d;
}

// ------------------------------------------------------------ Lesen

const indexCache = new Map();
let rev = 0;
export function all(coll) { return db[coll]; }
export function byId(coll, id) {
  if (!id) return undefined;
  let e = indexCache.get(coll);
  if (!e || e.rev !== rev) {
    e = { rev, map: new Map(db[coll].map((r) => [r.id, r])) };
    indexCache.set(coll, e);
  }
  return e.map.get(id);
}
export const getDbSnapshot = () => clone(db);
export const counts = () => Object.fromEntries(COLLECTIONS.map((c) => [c, db[c].length]));

// ------------------------------------------------------------ Konto (Servermodus) bzw. «Ich bin» (nur Lokaler Modus)

let me = null; // angemeldetes Konto (public) – Servermodus
let team = null; // Team im Kontext: {id, name, owners:[{name, role}]} (Superadmin: nur wenn er ein Team betreten hat)

export const getMe = () => me;
export const getTeam = () => team;
export const isSuper = () => me?.role === "superadmin";
export const isTeamAdmin = () => me?.role === "admin" || (isSuper() && Boolean(team));

/** Standard-Verantwortlicher: ownerKey des Kontos (Servermodus) bzw. die Wahl «Ich bin» (Lokaler Modus). */
export function getUser() {
  if (S.mode === "local") return lsGet(LS.user) || "";
  return me?.ownerKey || "";
}
/** Nur Lokaler Modus */
export function setUser(name) {
  lsSet(LS.user, name);
  emit("user");
}
/** Name für Stempel «erstellt/geändert von» (der Server setzt sie verbindlich neu). */
const stampName = () => (me ? (me.role === "superadmin" ? `${me.displayName} (Superadmin)` : me.displayName) : getUser());

function applyMe(r) {
  me = r.user;
  team = r.team || null;
  if (!isSuper()) api.setTeamId("");
  S.noTeam = isSuper() && !team;
  try { lsSet(LS.me, JSON.stringify({ user: me, team })); } catch { /* ignore */ }
}

// ------------------------------------------------------------ Listen

export function getList(name) {
  if (name === "owners" && !db.lists?.owners && team?.owners?.length) {
    // Noch keine eigene Liste: die aktiven Mitglieder des Teams (Beschreibung aus den Standardwerten, falls der Name passt)
    return team.owners.map((o) => ({ name: o.name, role: o.role || DEFAULT_LISTS.owners.find((d) => d.name === o.name)?.role || "" }));
  }
  return db.lists?.[name] ?? DEFAULT_LISTS[name];
}
export const ownerNames = () => getList("owners").map((o) => o.name);
export function setList(name, value) {
  db.lists = { ...(db.lists || {}) };
  if (value === null) delete db.lists[name]; else db.lists[name] = value;
  changed();
}

// ------------------------------------------------------------ Abrechnung (Einstellungen: Warengruppen, Firmenangaben, MWST, Zahlungsfrist, Startnummer)

/** db.settings.billing – immer vollständig (Standardwerte für Fehlendes). Nicht verändern, nur über setBilling. */
export function getBilling() {
  if (!db.settings || typeof db.settings !== "object") db.settings = { billing: defaultBilling() };
  if (!db.settings.billing || typeof db.settings.billing !== "object") db.settings.billing = normalizeBilling(null);
  return db.settings.billing;
}
/** Felder von settings.billing ändern (patch wird bereinigt; warengruppen ersetzt die ganze Liste). */
export function setBilling(patch) {
  const next = normalizeBilling({ ...getBilling(), ...clone(patch) });
  db.settings = { ...(db.settings || {}), billing: next };
  changed();
  return next;
}

/** Die Nummer, die die nächste neue Rechnung bekommt (Vorschau im Formular; vergeben wird sie in create) */
export const peekInvoiceNr = () => nextInvoiceNr(db.invoices, getBilling().invoiceStart, db.meta.lastNr?.invoices);

// ------------------------------------------------------------ Schreiben

function stamp(rec, isNew) {
  const now = new Date().toISOString();
  const u = stampName();
  if (isNew) { rec.createdAt = now; rec.createdBy = u; }
  rec.updatedAt = now;
  rec.updatedBy = u;
}

export function nextNr(coll) {
  const base = NR_BASE[coll];
  const max = db[coll].reduce((m, r) => Math.max(m, Number(r.nr) || 0), base - 1);
  return Math.max(max, db.meta.lastNr?.[coll] ?? 0, base - 1) + 1;
}

function changed() {
  rev++;
  gen++;
  if (batchDepth > 0) { batchChanged = true; return; }
  dirty = S.mode !== "local";
  const stored = persist();
  emit("data");
  if (S.mode === "local") { if (stored) setStatus("saved"); return; }
  setStatus("dirty");
  schedule(700);
}

export function batch(fn) {
  batchDepth++;
  try { return fn(); } finally {
    batchDepth--;
    if (batchDepth === 0 && batchChanged) { batchChanged = false; changed(); }
  }
}

export function create(coll, data) {
  const rec = { ...clone(data), id: uid() };
  if (NR_BASE[coll]) {
    rec.nr = nextNr(coll);
    db.meta.lastNr = { ...(db.meta.lastNr || {}), [coll]: rec.nr };
  }
  if (coll === "invoices") {
    // Rechnungsnummer: ab Startnummer, nie wiederverwendet (Zähler meta.lastNr.invoices)
    const given = Number(rec.nr);
    if (!Number.isInteger(given) || given <= 0) rec.nr = nextInvoiceNr(db.invoices, getBilling().invoiceStart, db.meta.lastNr?.invoices);
    db.meta.lastNr = { ...(db.meta.lastNr || {}), invoices: Math.max(rec.nr, db.meta.lastNr?.invoices ?? 0) };
    if (rec.positions === undefined) rec.positions = [];
  } else if (coll === "articles" && !(Number(rec.nr) > 0)) {
    const g = getBilling().warengruppen.find((x) => x.id === rec.warengruppeId);
    rec.nr = g ? nextArtNr(db.articles, g) : null;
  }
  stamp(rec, true);
  db[coll].push(rec);
  changed();
  return rec;
}

export function update(coll, id, patch) {
  const rec = db[coll].find((r) => r.id === id);
  if (!rec) throw new Error(t("store.recordGone"));
  const p = clone(patch);
  delete p.id; delete p.createdAt; delete p.createdBy;
  if (coll !== "articles") delete p.nr; // Artikelnummern bleiben änderbar (Wechsel der Warengruppe); die Oberfläche prüft auf Duplikate
  Object.assign(rec, p);
  stamp(rec, false);
  changed();
  return rec;
}

/** Was hängt an einem Datensatz? (für die Löschbestätigung) → { Sammlung: Anzahl }; Beschriftung: dep.<Sammlung> */
export function dependents(coll, id) {
  const n = {};
  if (coll === "customers") {
    n.deals = db.deals.filter((x) => x.customerId === id).length;
    n.rfqs = db.rfqs.filter((x) => x.customerId === id).length;
    n.activities = db.activities.filter((x) => x.customerId === id && !x.supplierId).length;
    n.tasks = db.tasks.filter((x) => x.customerId === id && !x.supplierId).length;
    n.focus = db.focus.filter((x) => x.customerId === id).length;
    n.invoices = db.invoices.filter((x) => x.customerId === id).length;
  } else if (coll === "suppliers") {
    n.rfqs = db.rfqs.filter((x) => x.supplierId === id).length;
    n.activities = db.activities.filter((x) => x.supplierId === id && !x.customerId).length;
    n.tasks = db.tasks.filter((x) => x.supplierId === id && !x.customerId).length;
  } else if (coll === "deals") {
    n.rfqs = db.rfqs.filter((x) => x.dealId === id).length;
  }
  return Object.fromEntries(Object.entries(n).filter(([, v]) => v > 0));
}

/** Rechnungen des Kunden, die aufbewahrt werden müssen (10 Jahre, nicht mehr Entwurf) */
export const retainedInvoicesOf = (customerId) => (db.invoices || []).filter((i) => i.customerId === customerId && isRetainedInvoice(i));

/** Löschen. Aufbewahrungspflicht (CH, 10 Jahre): versendete/bezahlte/stornierte Rechnungen und Kunden mit solchen Rechnungen werden NICHT gelöscht (false). */
export function remove(coll, id) {
  if (coll === "invoices" && isRetainedInvoice(byId("invoices", id))) return false;
  if (coll === "customers" && retainedInvoicesOf(id).length) return false;
  batch(() => {
    const unlinkOrDrop = (arr, own, other) =>
      arr.filter((x) => {
        if (x[own] !== id) return true;
        if (x[other]) { x[own] = ""; stamp(x, false); return true; }
        return false;
      });
    if (coll === "customers" || coll === "suppliers") {
      db.articles.forEach((x) => { if (x[coll === "customers" ? "customerId" : "supplierId"] === id) { x[coll === "customers" ? "customerId" : "supplierId"] = null; stamp(x, false); } });
    }
    if (coll === "customers") {
      db.deals = db.deals.filter((x) => x.customerId !== id);
      db.rfqs = db.rfqs.filter((x) => x.customerId !== id);
      db.focus = db.focus.filter((x) => x.customerId !== id);
      db.invoices = db.invoices.filter((x) => x.customerId !== id);
      db.articles.forEach((x) => { if (x.customerId === id) { x.customerId = null; stamp(x, false); } });
      db.approvals.forEach((x) => { if (x.customerId === id) x.customerId = ""; });
      db.activities = unlinkOrDrop(db.activities, "customerId", "supplierId");
      db.tasks = unlinkOrDrop(db.tasks, "customerId", "supplierId");
    } else if (coll === "suppliers") {
      db.rfqs = db.rfqs.filter((x) => x.supplierId !== id);
      db.articles.forEach((x) => { if (x.supplierId === id) { x.supplierId = null; stamp(x, false); } });
      db.activities = unlinkOrDrop(db.activities, "supplierId", "customerId");
      db.tasks = unlinkOrDrop(db.tasks, "supplierId", "customerId");
    } else if (coll === "deals") {
      db.rfqs.forEach((x) => { if (x.dealId === id) x.dealId = ""; });
      db.invoices.forEach((x) => { if (x.dealId === id) { x.dealId = null; stamp(x, false); } });
    }
    db[coll] = db[coll].filter((r) => r.id !== id);
    changed();
  });
  return true;
}

// ------------------------------------------------------------ Persistenz lokal

/** Zwischenspeicher je Team getrennt (nie Daten eines anderen Teams anzeigen) */
const cacheKey = () => `${LS.cache}:${team?.id || me?.teamId || ""}`;

function persist() {
  let ok = true;
  if (S.mode === "local") {
    ok = lsSet(LS.local, JSON.stringify({ db }));
    if (!ok) setStatus("error", { key: "store.storageFull" });
  } else if (!S.noTeam) {
    lsSet(cacheKey(), JSON.stringify({ version: S.version, db, base: dirty ? baseData : null }));
  }
  return ok;
}

// ------------------------------------------------------------ Speichern (Server)

function schedule(ms) {
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  saveTimer = setTimeout(flush, ms);
}

export const flushNow = () => { clearTimeout(saveTimer); return flush(); };

function sessionExpired() {
  api.setToken("");
  setStatus("error", { key: "store.sessionExpired" });
  emit("auth");
}
/** Für andere Module (z. B. Anwesenheit): Antwort 401 → neu anmelden */
export function handleAuthError(e) {
  if (e instanceof api.ApiError && e.status === 401) { sessionExpired(); return true; }
  return false;
}

async function flush() {
  if (saving) { saveAgain = true; return; }
  if (!dirty || S.noTeam) return;
  if (S.mode === "local") { dirty = false; setStatus("saved"); return; }
  if (S.mode === "offline") {
    if (!(await tryReconnect())) { setStatus("error", { key: "store.offlineLocalSafe" }); retryTimer = setTimeout(flush, 10000); return; }
  }
  saving = true;
  setStatus("saving");
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const myGen = gen;
      const snapshot = clone(db);
      try {
        const res = await api.putDb(S.version, snapshot, stampName());
        S.version = res.version;
        S.savedAt = res.savedAt;
        S.savedBy = stampName();
        baseData = snapshot;
        if (gen === myGen) dirty = false;
        persist();
        break;
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 409) {
          let merged;
          try {
            const remote = e.body?.data ? normalizeDb(e.body.data) : emptyDb();
            merged = mergeDb(baseData || emptyDb(), db, remote);
            S.version = e.body?.version ?? 0;
            baseData = clone(remote);
          } catch (mergeErr) {
            console.error(mergeErr);
            emit("conflict-failed");
            throw new Error(t("store.conflictReload"));
          }
          db = merged.db;
          rev++;
          gen++;
          persist();
          emit("data");
          emit("merged", { conflicts: merged.conflicts, renumbered: merged.renumbered });
          continue;
        }
        throw e;
      }
    }
    if (dirty) { setStatus("dirty"); schedule(300); } else setStatus("saved");
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) sessionExpired();
    else if (e instanceof api.ApiUnavailable) { setStatus("error", { key: "store.unreachableRetry" }); retryTimer = setTimeout(flush, 8000); }
    else { setStatus("error", { err: e }); retryTimer = setTimeout(flush, 15000); }
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; schedule(100); }
  }
}

// ------------------------------------------------------------ Laden

function adoptRemote(r) {
  db = r.data ? normalizeDb(r.data) : emptyDb();
  baseData = clone(db);
  S.version = r.version || 0;
  S.savedAt = r.savedAt || null;
  S.savedBy = r.savedBy || "";
  rev++;
}

/** Fehlerbildschirm beim Start. Mit Token kann man sich abmelden (canLogout) – sonst bliebe eine kaputte Sitzung eine Sackgasse. */
const errorState = (message) => ({ state: "error", message, canLogout: Boolean(api.getToken()) });

async function loadServer() {
  let r;
  try {
    r = await api.getDb();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) { api.setToken(""); return { state: "login" }; }
    if (e instanceof api.ApiError && e.status === 500) return errorState(e.message);
    if (e instanceof api.ApiError && e.status === 409 && e.body?.error === "team_required") { S.noTeam = true; return { state: "ready" }; }
    if (e instanceof api.ApiUnavailable && loadOfflineCache()) return { state: "ready" };
    return errorState(e.message || t("store.loadFailed"));
  }
  const cache = readCache();
  adoptRemote(r);
  S.mode = "server";
  if (cache?.base && cache.db) {
    // Es gab noch nicht gespeicherte lokale Änderungen -> mit dem Serverstand zusammenführen
    try {
      const merged = mergeDb(normalizeDb(cache.base), normalizeDb(cache.db), db);
      db = merged.db;
      rev++;
      gen++;
      dirty = true;
      persist();
      schedule(500);
      setStatus("dirty");
      setTimeout(() => emit("recovered"), 0);
    } catch (err) { console.error(err); }
  } else {
    persist();
    setStatus("saved");
  }
  lsSet(LS.wasServer, "1");
  return { state: "ready" };
}

function readCache() {
  try { return JSON.parse(lsGet(cacheKey()) || "null"); } catch { return null; }
}

function loadOfflineCache() {
  const c = readCache();
  if (!c?.db) return false;
  try {
    db = normalizeDb(c.db);
    baseData = c.base ? normalizeDb(c.base) : clone(db);
    S.version = c.version || 0;
    S.mode = "offline";
    dirty = Boolean(c.base);
    rev++;
    setStatus("error", { key: "store.offlineCache" });
    retryTimer = setTimeout(() => tryReconnect().then((ok) => ok && emit("data")), 10000);
    return true;
  } catch { return false; }
}

async function tryReconnect() {
  try {
    await api.ping();
    const r = await api.getDb();
    if (dirty) {
      const merged = mergeDb(baseData || emptyDb(), db, r.data ? normalizeDb(r.data) : emptyDb());
      db = merged.db;
      baseData = clone(r.data ? normalizeDb(r.data) : emptyDb());
      S.version = r.version;
      rev++;
      gen++;
    } else {
      adoptRemote(r);
    }
    S.mode = "server";
    setStatus(dirty ? "dirty" : "saved");
    emit("data");
    return true;
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) sessionExpired();
    return false;
  }
}

/** Nach erfolgreicher Anmeldung bzw. beim Start mit Token: Konto laden, Pflicht-Passwortwechsel prüfen, Teamdaten laden. */
async function afterAuth() {
  let r;
  try {
    r = await api.me();
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 404 && api.getTeamId()) { api.setTeamId(""); return afterAuth(); } // betretenes Team gibt es nicht mehr
    if (e instanceof api.ApiError && (e.status === 401 || e.status === 403)) { api.setToken(""); return { state: "login" }; }
    if (e instanceof api.ApiError && e.status === 500) return errorState(e.message);
    if (e instanceof api.ApiUnavailable) {
      const cached = readCachedMe();
      if (cached && api.getToken()) { me = cached.user; team = cached.team; S.noTeam = isSuper() && !team; if (loadOfflineCache()) return { state: "ready" }; }
    }
    return errorState(e.message || t("store.loadFailed"));
  }
  applyMe(r);
  if (r.mustChangePassword) return { state: "change-password" };
  if (S.noTeam) { db = emptyDb(); rev++; setStatus("saved"); return { state: "ready" }; }
  return loadServer();
}

function readCachedMe() {
  try { return JSON.parse(lsGet(LS.me) || "null"); } catch { return null; }
}

export async function init() {
  let info = null;
  try { info = await api.ping(); } catch { info = null; }

  if (info) {
    S.mode = "server";
    if (!info.configured) return { state: "error", message: errorText({ error: "not_configured", reason: "secret", message: info.message }) || t("err.not_configured.secret") };
    if (!api.getToken()) return { state: "login" };
    return afterAuth();
  }

  if (lsGet(LS.wasServer) && api.getToken()) {
    const cached = readCachedMe();
    if (cached) { me = cached.user; team = cached.team; S.noTeam = isSuper() && !team; }
    if (loadOfflineCache()) return { state: "ready" };
  }

  // Lokaler Modus
  S.mode = "local";
  try {
    const saved = JSON.parse(lsGet(LS.local) || "null");
    if (saved?.db) db = normalizeDb(saved.db);
  } catch (e) { console.error(e); }
  rev++;
  setStatus("saved");
  return { state: "ready" };
}

export async function loginWith(username, password) {
  const r = await api.login(username, password);
  api.setToken(r.token);
  try { lsSet(LS.lastUser, username.trim().toLowerCase()); } catch { /* ignore */ }
  return afterAuth();
}

/** Eigenes Passwort ändern; das Token wird ersetzt (alle anderen Sitzungen sind danach abgemeldet). */
export async function changePassword(current, next) {
  const r = await api.changePassword(current, next);
  api.setToken(r.token);
  if (r.user) { me = r.user; applyMe({ user: r.user, team }); }
  return r;
}
/** Nach dem Pflicht-Wechsel: Daten laden */
export const continueAfterPasswordChange = () => afterAuth();

/** Superadmin: Team betreten (Seite wird neu geladen, damit nie Daten zweier Teams gemischt werden) bzw. verlassen. */
export async function enterTeam(teamId) {
  if (teamId) await api.enterTeam(teamId);
  api.setTeamId(teamId || "");
  location.hash = teamId ? "#/uebersicht" : "#/plattform";
  location.reload();
}

export function logout() {
  const wasDirty = dirty;
  if (api.getToken()) api.logout().catch(() => {});
  api.setToken("");
  api.setTeamId("");
  if (!wasDirty) lsSet(cacheKey(), "null");
  lsSet(LS.me, "null");
  me = null;
  team = null;
}

/** Periodischer Abgleich: übernimmt Änderungen anderer, solange man selbst nichts Offenes hat. */
export async function refresh() {
  if (S.mode !== "server" || S.noTeam || saving || dirty) return false;
  try {
    const r = await api.getDb();
    if (r.version > S.version) {
      adoptRemote(r);
      persist();
      emit("data", { remote: true });
      return true;
    }
  } catch (e) {
    if (e instanceof api.ApiError && e.status === 401) sessionExpired();
  }
  return false;
}

/** Server-Stand erzwingen (verwirft lokale, noch nicht gespeicherte Änderungen). silent: kein Hinweis «jemand anderes …» (z. B. nach dem eigenen Excel-Import). */
export async function reloadFromServer({ silent = false } = {}) {
  const r = await api.getDb();
  dirty = false;
  adoptRemote(r);
  persist();
  setStatus("saved");
  emit("data", { remote: !silent });
}

// ------------------------------------------------------------ Import / Reset

/** Ersetzt die komplette Datenbank (Import, Wiederherstellung, Löschen) */
export async function replaceDb(newDb) {
  const next = normalizeDb(newDb);
  if (S.mode === "server") {
    // Basis auf den aktuellen Serverstand setzen: so wird nicht gemerged, sondern wirklich ersetzt.
    const r = await api.getDb();
    S.version = r.version;
    baseData = r.data ? normalizeDb(r.data) : emptyDb();
  }
  db = next;
  rev++;
  changed();
}

export function exportJson() {
  return JSON.stringify(db, null, 2);
}

export async function resetAll() {
  const e = emptyDb();
  e.lists = clone(db.lists || {});
  e.settings = clone(db.settings || e.settings); // Firmenangaben, Warengruppen, MWST bleiben beim «Alles löschen» erhalten
  await replaceDb(e);
}
