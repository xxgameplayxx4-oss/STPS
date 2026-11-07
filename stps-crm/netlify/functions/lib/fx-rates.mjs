// STPS CRM – automatische Wechselkurse (EZB-Referenzkurse über frankfurter.app, ohne Schlüssel).
// Die Kurse dienen nur der Übersicht (Umrechnung «≈»); Belege behalten Währung und Betrag. Gespeichert wird in db.settings.fx des Teams:
// { EUR, USD, date, mode: "auto"|"manual", source, fetchedAt, failedAt? }. Im Modus «manual» werden handgepflegte Werte nie überschrieben.
// Aufrufer: POST /api/fx/refresh (Button «Jetzt aktualisieren») und die geplante Function fx-rates.mjs (werktags 16:30 UTC).
import { DB_KEY, commitDb } from "./db.mjs";
import { loadTeams, scopedStore } from "./teams.mjs";
import { logError } from "./http.mjs";

export const FX_URL = "https://api.frankfurter.app/latest?from=CHF&to=EUR,USD";
export const FX_SOURCE = "EZB / ECB via frankfurter.app";
const TIMEOUT_MS = 8000;
const inRange = (n) => Number.isFinite(n) && n >= 0.1 && n <= 10; // 1 EUR/USD in CHF – alles ausserhalb ist ein Datenfehler
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Prüft die Antwort von frankfurter.app (Basis CHF: «1 CHF = x EUR») und kehrt sie um («1 EUR = y CHF»).
 * @returns {{EUR:number, USD:number, date:string}} – wirft bei ungültiger Antwort
 */
export function parseRates(body) {
  const bad = (why) => { throw new Error("Ungültige Kursantwort: " + why); };
  if (!body || typeof body !== "object" || Array.isArray(body)) bad("kein Objekt");
  if (body.base !== undefined && body.base !== "CHF") bad("Basis " + String(body.base));
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(body.date))) bad("Datum");
  const r = body.rates;
  if (!r || typeof r !== "object") bad("rates fehlt");
  const out = { date: body.date };
  for (const cur of ["EUR", "USD"]) {
    const perChf = typeof r[cur] === "number" ? r[cur] : NaN; // 1 CHF = perChf cur
    if (!(perChf > 0)) bad(cur + " fehlt");
    const inChf = round4(1 / perChf);
    if (!inRange(inChf)) bad(cur + " unplausibel");
    out[cur] = inChf;
  }
  return { EUR: out.EUR, USD: out.USD, date: out.date };
}

/** Holt und prüft die aktuellen Kurse. deps.fetch: für Tests ersetzbar. */
export async function fetchRates(deps = {}) {
  const f = deps.fetch ?? globalThis.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await f(FX_URL, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("Kursdienst antwortet mit HTTP " + res.status);
    return parseRates(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

const fxModeOf = (fx) => fx?.mode ?? (fx?.date ? "manual" : "auto");

/** Schreibt Kurse (oder den Fehlervermerk) in db.settings.fx; wiederholt bei gleichzeitigem Speichern. */
async function writeFx(store, mutate, now, { retries = 6 } = {}) {
  for (let i = 0; i < retries; i++) {
    const cur = await store.read(DB_KEY);
    const data = cur?.value?.data;
    if (!data || typeof data !== "object") return { status: "nodb" };
    const fx = data.settings?.fx;
    const next = mutate(fx && typeof fx === "object" ? fx : {});
    if (!next) return { status: "manual", fx };
    const res = await commitDb(store, cur, { data: { ...data, settings: { ...(data.settings || {}), fx: next } }, by: "System (EZB)", now });
    if (res.ok) return { status: "ok", fx: next };
  }
  throw new Error("Konflikt beim Speichern der Wechselkurse");
}

/**
 * Aktualisiert die Kurse EINES Teams. Im Modus «manual» passiert nichts (status «manual»). Bei Fehler bleiben die letzten Kurse
 * erhalten; es wird nur «failedAt» vermerkt (status «failed»).
 * @param deps { now?: number, fetch?, rates? (bereits geholt), fetchError? (Abruf schon gescheitert) }
 */
export async function updateTeamFx(store, deps = {}) {
  const now = deps.now ?? Date.now();
  const doc = await store.read(DB_KEY);
  if (!doc) return { status: "nodb" };
  const cur = doc.value?.data?.settings?.fx;
  if (fxModeOf(cur) === "manual") return { status: "manual", fx: cur };
  let rates;
  try {
    if (deps.fetchError) throw deps.fetchError;
    rates = deps.rates ?? (await fetchRates(deps));
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Zeitüberschreitung" : String(err?.message || err);
    try { await writeFx(store, (fx) => (fxModeOf(fx) === "manual" ? null : { ...fx, failedAt: new Date(now).toISOString() }), now); } catch (e) { logError("Wechselkurse: Fehlervermerk", e); }
    return { status: "failed", error: msg };
  }
  const r = await writeFx(store, (fx) => (fxModeOf(fx) === "manual" ? null : { EUR: rates.EUR, USD: rates.USD, date: rates.date, mode: "auto", source: FX_SOURCE, fetchedAt: new Date(now).toISOString() }), now);
  return r;
}

/** Geplanter Lauf: alle aktiven Teams im Modus «auto». Die Kurse werden nur einmal geholt. */
export async function runFxUpdate(deps) {
  const now = deps.now ? deps.now() : Date.now();
  const res = { teams: 0, updated: 0, skipped: 0, failed: 0 };
  const teams = (await loadTeams(deps.store, { now, cacheMs: 0 })).filter((t) => t.active !== false);
  let rates = null, error = null;
  try { rates = await fetchRates(deps); } catch (err) { error = err; logError("Wechselkurse abrufen", err); }
  for (const team of teams) {
    res.teams++;
    try {
      const r = await updateTeamFx(scopedStore(deps.store, team.id), { now, rates, fetchError: error });
      if (r.status === "ok") res.updated++; else if (r.status === "failed") res.failed++; else res.skipped++;
    } catch (err) {
      res.failed++;
      logError("Wechselkurse", err, { team: team.id });
    }
  }
  return res;
}
