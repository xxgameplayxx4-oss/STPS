// STPS CRM – Team-Kalender: Termine mit Teilnehmern, Wiederholung und Erinnerungen, strikt je Team
// (der Store ist der Namensraum des Teams, siehe teams.mjs scopedStore).
//
// Speicherung im Blob-Store des Teams (nie im globalen Namensraum):
//   cal/events   { events: [Termin …] }          alle Termine des Teams (höchstens MAX_EVENTS)
//   cal/sent     { sent: { "<id>|<Beginn>|<min>": <ms> } }   bereits versandte Erinnerungen (Doppelversand-Schutz; alte Einträge werden entfernt)
//
// Zeiten: Zeitpunkte als UTC-ISO («2026-10-25T13:00:00.000Z»), die Anzeige übernimmt der Browser in seiner Zeitzone.
// Ganztägige Termine sind reine Daten («2026-10-25», Ende einschliesslich). Wiederholungen werden in der Zeitzone des Termins (tz, Standard
// Europe/Zurich) gerechnet: «jeden Montag 09:00» bleibt auch über die Sommerzeit hinweg 09:00. E-Mails nennen die Zeit in Europe/Zurich.
//
//  GET    /api/calendar?from=<ISO>&to=<ISO>   Vorkommen im Zeitraum (Wiederholungen aufgelöst) + zugehörige Termine + Mitglieder des Teams
//  GET    /api/calendar/events/<id>           ein Termin
//  POST   /api/calendar/events                anlegen
//  PUT    /api/calendar/events/<id>           ändern (rev = bekannter Stand; sonst 409)
//  DELETE /api/calendar/events/<id>           löschen
//  Outlook (lib/outlook.mjs): Termine verbundener Benutzer erscheinen zusätzlich (source «outlook», nur lesbar; private Termine anderer nur als «Beschäftigt»);
//  gespeicherte CRM-Termine werden bei Richtung «both» nach Outlook geschrieben (Antwort-Feld «outlook»: pushed | skipped | error).
//  Erinnerungen versendet die geplante Function calendar-reminders.mjs über runReminders() und den Versandweg aus push.mjs.
import { randomBytes } from "node:crypto";
import { mutateDoc } from "./kv.mjs";
import { ApiFail, json, fail, parseBody, cleanText, queryOf, logError } from "./http.mjs";
import { loadTeams, scopedStore } from "./teams.mjs";
import * as U from "./users.mjs";
import * as PUSH from "./push.mjs";
import * as OL from "./outlook.mjs";
import { scrubEvent } from "./hide-super.mjs";

export const EVENTS_KEY = "cal/events";
export const SENT_KEY = "cal/sent";
export const MAX_EVENTS = 2000;
export const MAX_TITLE = 120;
export const MAX_LOCATION = 200;
export const MAX_NOTES = 2000;
export const MAX_PARTICIPANTS = 100;
export const MAX_SPAN_DAYS = 31;
export const MAX_RANGE_DAYS = 400;
export const MAX_ITEMS = 3000;
export const MAX_COUNT = 1000;
export const MAX_INTERVAL = 52;
export const DEFAULT_TZ = "Europe/Zurich";
/** Erlaubte Vorlaufzeiten der Erinnerungen in Minuten (0 = zum Beginn) */
export const REMINDER_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const FREQS = ["daily", "weekly", "monthly", "yearly"];
/** Ganztägige Termine: Erinnerungen beziehen sich auf diese Uhrzeit des Tages (in der Zeitzone des Termins) */
export const ALLDAY_REMIND_HOUR = 9;
/** Eine Erinnerung wird noch versandt, wenn ihr Zeitpunkt höchstens so lange zurückliegt (deckt ausgefallene Läufe der Function ab) */
export const LOOKBACK_MS = 15 * 60 * 1000;
/** Einträge im Versandvermerk werden nach so langer Zeit entfernt (länger als LOOKBACK_MS, sonst käme es zu Doppelversand) */
export const SENT_KEEP_MS = 3 * 24 * 3600 * 1000;
const MIN = 60000;
const DAY = 86400000;
const EVENT_ID_RE = /^ev_[0-9a-f]{12}$/;
const MAX_ITER = 20000;

// ---------------------------------------------------------------- Zeitzonen

const fmtCache = new Map();
function zoneFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { zoneFmt(tz); return true; } catch { return false; }
}

/** Wanduhr-Teile eines Zeitpunkts in der Zeitzone */
export function zonedParts(ms, tz) {
  const o = {};
  for (const p of zoneFmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute, ss: o.second };
}

const offsetAt = (ms, tz) => {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
};

/** Wanduhrzeit in der Zeitzone → UTC-Millisekunden (nicht existierende Zeit der Umstellung rückt vor, doppelte wählt die erste) */
export function zonedToUtc({ y, m, d, hh = 0, mm = 0 }, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offsetAt(guess, tz);
  let t = guess - o1;
  const o2 = offsetAt(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

const pad = (n) => String(n).padStart(2, "0");
const ymdStr = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
const addDaysYMD = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parseYMD = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const dayNumber = (s) => { const { y, m, d } = parseYMD(s); return Math.round(Date.UTC(y, m - 1, d) / DAY); };

function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseYMD(s);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** ISO-Zeitpunkt mit Zone → ms (auf die Minute abgerundet) oder null */
function parseInstant(s) {
  if (typeof s !== "string" || !ISO_RE.test(s)) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  if (y < 2000 || y > 2100) return null;
  return Math.floor(ms / MIN) * MIN;
}

// ---------------------------------------------------------------- Eingaben prüfen

const cleanNotes = (v) =>
  String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_NOTES);

/**
 * Termin aus einer Anfrage prüfen und in die gespeicherte Form bringen (ohne id/Stempel). Wirft 400 mit stabilem Code.
 * @param memberIds Menge der Benutzer-IDs der aktiven Mitglieder des Teams
 */
export function cleanEvent(input, memberIds) {
  const b = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const title = cleanText(b.title, MAX_TITLE);
  if (!title) throw fail(400, "cal_title", "Bitte einen Titel eingeben");
  if (b.allDay !== undefined && typeof b.allDay !== "boolean") throw fail(400, "bad_request", "Ungültige Anfrage");
  const allDay = b.allDay === true;
  const tz = b.tz === undefined || b.tz === null || b.tz === "" ? DEFAULT_TZ : b.tz;
  if (!validTimeZone(tz)) throw fail(400, "cal_tz", "Ungültige Zeitzone");

  let start, end;
  if (allDay) {
    if (!validDate(b.start)) throw fail(400, "cal_time", "Ungültiges Datum");
    end = b.end === undefined || b.end === null || b.end === "" ? b.start : b.end;
    if (!validDate(end)) throw fail(400, "cal_time", "Ungültiges Datum");
    start = b.start;
    if (end < start) throw fail(400, "cal_range", "Das Ende liegt vor dem Beginn");
    if (dayNumber(end) - dayNumber(start) + 1 > MAX_SPAN_DAYS) throw fail(400, "cal_span", `Ein Termin darf höchstens ${MAX_SPAN_DAYS} Tage dauern`, { max: MAX_SPAN_DAYS });
  } else {
    const s = parseInstant(b.start);
    if (s === null) throw fail(400, "cal_time", "Ungültige Zeitangabe");
    const e = b.end === undefined || b.end === null || b.end === "" ? s + 60 * MIN : parseInstant(b.end);
    if (e === null) throw fail(400, "cal_time", "Ungültige Zeitangabe");
    if (e < s) throw fail(400, "cal_range", "Das Ende liegt vor dem Beginn");
    if (e - s > MAX_SPAN_DAYS * DAY) throw fail(400, "cal_span", `Ein Termin darf höchstens ${MAX_SPAN_DAYS} Tage dauern`, { max: MAX_SPAN_DAYS });
    start = new Date(s).toISOString();
    end = new Date(e).toISOString();
  }

  const location = cleanText(b.location, MAX_LOCATION);
  const notes = cleanNotes(b.notes);

  let participants = [];
  if (b.participants !== undefined && b.participants !== null) {
    if (!Array.isArray(b.participants) || b.participants.length > MAX_PARTICIPANTS) throw fail(400, "cal_participant", "Ungültige Teilnehmer");
    participants = [...new Set(b.participants)];
    if (participants.some((id) => typeof id !== "string" || !memberIds.has(id))) throw fail(400, "cal_participant", "Teilnehmer müssen Mitglieder dieses Teams sein");
  }

  let reminders = [];
  if (b.reminders !== undefined && b.reminders !== null) {
    if (!Array.isArray(b.reminders) || b.reminders.some((m) => !REMINDER_MINUTES.includes(m))) throw fail(400, "cal_reminder", "Ungültige Erinnerung");
    reminders = [...new Set(b.reminders)].sort((a, c) => a - c);
  }

  let repeat = null;
  if (b.repeat !== undefined && b.repeat !== null && b.repeat !== false) {
    const r = b.repeat;
    if (typeof r !== "object" || Array.isArray(r) || !FREQS.includes(r.freq)) throw fail(400, "cal_repeat", "Ungültige Wiederholung");
    const interval = r.interval === undefined || r.interval === null ? 1 : r.interval;
    if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) throw fail(400, "cal_repeat", "Ungültige Wiederholung");
    let until = null;
    if (r.until !== undefined && r.until !== null && r.until !== "") {
      if (!validDate(r.until)) throw fail(400, "cal_repeat", "Ungültige Wiederholung");
      until = r.until;
      const startDay = allDay ? start : ymdOf(Date.parse(start), tz);
      if (until < startDay) throw fail(400, "cal_until", "Das Wiederholungsende liegt vor dem Beginn");
    }
    let count = null;
    if (r.count !== undefined && r.count !== null && r.count !== "") {
      if (!Number.isInteger(r.count) || r.count < 1 || r.count > MAX_COUNT) throw fail(400, "cal_repeat", "Ungültige Wiederholung");
      count = r.count;
    }
    repeat = { freq: r.freq, interval, until, count };
  }

  return { title, allDay, start, end, tz, location, notes, participants, reminders, repeat };
}

const ymdOf = (ms, tz) => { const p = zonedParts(ms, tz); return ymdStr(p.y, p.m, p.d); };

// ---------------------------------------------------------------- Wiederholungen auflösen

const STEP_MAX_DAYS = { daily: 1, weekly: 7, monthly: 31, yearly: 366 };

/** Datum des i-ten Vorkommens (i = 0 ist der Termin selbst); Tage, die es im Zielmonat nicht gibt (31.), rücken auf den letzten Tag */
function nthDate(a, repeat, i) {
  const k = i * repeat.interval;
  switch (repeat.freq) {
    case "daily": return addDaysYMD(a.y, a.m, a.d, k);
    case "weekly": return addDaysYMD(a.y, a.m, a.d, 7 * k);
    case "monthly": {
      const mm = a.m - 1 + k;
      const y = a.y + Math.floor(mm / 12);
      const m = (mm % 12) + 1;
      return [y, m, Math.min(a.d, daysInMonth(y, m))];
    }
    default: { // yearly
      const y = a.y + k;
      return [y, a.m, Math.min(a.d, daysInMonth(y, a.m))];
    }
  }
}

/**
 * Vorkommen eines Termins (Wiederholungen aufgelöst) im Zeitraum [fromMs, toMs).
 * mode «overlap»: Vorkommen, die den Zeitraum berühren (Kalenderansicht) · «base»: Vorkommen, deren Bezugszeit (Beginn; ganztägig 09:00) im Zeitraum liegt (Erinnerungen).
 * @returns {{i:number, startMs:number, endMs:number, baseMs:number, start:string, end:string}[]} start/end: UTC-ISO bzw. (ganztägig) Datum; endMs ist bei ganztägigen Terminen der Beginn des Folgetags
 */
export function occurrences(ev, fromMs, toMs, { mode = "overlap", limit = MAX_ITEMS } = {}) {
  const out = [];
  const tz = ev.tz || DEFAULT_TZ;
  const rep = ev.repeat;
  let startMs, endMs, spanDays = 0, anchor, wall;
  if (ev.allDay) {
    anchor = parseYMD(ev.start);
    spanDays = dayNumber(ev.end) - dayNumber(ev.start);
    startMs = zonedToUtc({ ...anchor }, tz);
    const [ey, em, ed] = addDaysYMD(anchor.y, anchor.m, anchor.d, spanDays + 1);
    endMs = zonedToUtc({ y: ey, m: em, d: ed }, tz);
  } else {
    startMs = Date.parse(ev.start);
    endMs = Date.parse(ev.end);
    const p = zonedParts(startMs, tz);
    anchor = { y: p.y, m: p.m, d: p.d };
    wall = { hh: p.hh, mm: p.mm };
  }
  const durMs = endMs - startMs;

  const make = (i) => {
    if (i === 0) {
      return ev.allDay
        ? { i, startMs, endMs, baseMs: zonedToUtc({ ...anchor, hh: ALLDAY_REMIND_HOUR }, tz), start: ev.start, end: ev.end }
        : { i, startMs, endMs, baseMs: startMs, start: ev.start, end: ev.end };
    }
    const [y, m, d] = nthDate(anchor, rep, i);
    if (ev.allDay) {
      const s = zonedToUtc({ y, m, d }, tz);
      const [ey, em, ed] = addDaysYMD(y, m, d, spanDays);
      const [ny, nm, nd] = addDaysYMD(y, m, d, spanDays + 1);
      return { i, startMs: s, endMs: zonedToUtc({ y: ny, m: nm, d: nd }, tz), baseMs: zonedToUtc({ y, m, d, hh: ALLDAY_REMIND_HOUR }, tz), start: ymdStr(y, m, d), end: ymdStr(ey, em, ed) };
    }
    const s = zonedToUtc({ y, m, d, ...wall }, tz);
    return { i, startMs: s, endMs: s + durMs, baseMs: s, start: new Date(s).toISOString(), end: new Date(s + durMs).toISOString() };
  };
  const inRange = (o) => (mode === "base" ? o.baseMs >= fromMs && o.baseMs < toMs : o.endMs > fromMs && o.startMs < toMs && (o.endMs > o.startMs || o.startMs >= fromMs));

  if (!rep) {
    const o = make(0);
    if (inRange(o)) out.push(o);
    return out;
  }
  // Zum ersten möglicherweise relevanten Vorkommen springen (zu niedrig geschätzt ist unschädlich: es wird übersprungen)
  const stepMax = STEP_MAX_DAYS[rep.freq] * rep.interval * DAY;
  const lead = mode === "base" ? 0 : durMs;
  let i = Math.max(0, Math.floor((fromMs - startMs - lead - DAY) / stepMax) - 1);
  for (let n = 0; n < MAX_ITER && out.length < limit; n++, i++) {
    if (rep.count && i >= rep.count) break;
    const o = make(i);
    if (o.startMs >= toMs && o.baseMs >= toMs) break;
    if (rep.until) {
      const day = ev.allDay ? o.start : ymdOf(o.startMs, tz);
      if (day > rep.until) break;
    }
    if (inRange(o)) out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- Erinnerungen: fällige finden

/** Schlüssel einer Erinnerung für den Versandvermerk */
export const reminderKey = (ev, occ, minutes) => `${ev.id}|${occ.start}|${minutes}`;

/**
 * Erinnerungen, deren Zeitpunkt (Bezugszeit − Vorlauf) in [now − lookback, now] liegt. Erinnerungen, deren Zeitpunkt vor dem letzten Speichern
 * des Termins lag, entfallen (sie wären beim Anlegen schon verstrichen). Wiederholungen werden aufgelöst.
 * @returns {{event:object, occ:object, minutes:number, triggerMs:number, key:string}[]}
 */
export function dueReminders(events, nowMs, { lookbackMs = LOOKBACK_MS } = {}) {
  const out = [];
  const maxLead = Math.max(...REMINDER_MINUTES) * MIN;
  for (const ev of events) {
    if (!ev?.reminders?.length) continue;
    let occs;
    try {
      occs = occurrences(ev, nowMs - lookbackMs, nowMs + maxLead + MIN, { mode: "base", limit: 200 });
    } catch (e) {
      logError("Kalender: Termin nicht auswertbar", e, { id: ev.id });
      continue;
    }
    const changedAt = Date.parse(ev.updatedAt || ev.createdAt || "") || 0;
    for (const occ of occs) {
      for (const minutes of ev.reminders) {
        const triggerMs = occ.baseMs - minutes * MIN;
        if (triggerMs > nowMs || triggerMs < nowMs - lookbackMs) continue;
        if (triggerMs < changedAt - MIN) continue;
        out.push({ event: ev, occ, minutes, triggerMs, key: reminderKey(ev, occ, minutes) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- Speicher

const eventsOf = (doc) => (Array.isArray(doc?.events) ? doc.events.filter((e) => e && typeof e === "object" && EVENT_ID_RE.test(e.id)) : []);
export async function loadEvents(store) {
  return eventsOf((await store.read(EVENTS_KEY))?.value);
}

const actorOf = (ctx) => ({ id: ctx.user.id, name: ctx.actor.name });

// ---------------------------------------------------------------- Routen

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFail) return json(e.status, { error: e.code, message: e.message, ...e.extra });
    throw e;
  }
}
const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
const notFound = () => json(404, { error: "cal_not_found", message: "Termin nicht gefunden" });

/** Importierte Outlook-Termine lassen sich im CRM nicht ändern oder löschen (Outlook ist dort führend) */
async function readonlyOutlook(deps, store, ctx, id) {
  const hit = (await OL.importedEvents(deps, store, ctx.user.id)).find((e) => e.id === id);
  return hit ? json(403, { error: "cal_readonly", message: "Dieser Termin stammt aus Outlook und kann nur dort geändert werden", reason: "outlook_readonly" }) : null;
}

/** Termine für den Aufrufer: Mitglieder sehen den Superadmin nicht als Ersteller/Bearbeiter (→ «System») */
const seen = (ctx, ev) => (ctx.isSuper ? ev : scrubEvent(ev));

const memberView = (m) => ({ id: m.id, displayName: m.displayName });

function parseRange(q) {
  const from = Date.parse(q.get("from") || "");
  const to = Date.parse(q.get("to") || "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw fail(400, "cal_range_query", "Ungültiger Zeitraum");
  if (to - from > MAX_RANGE_DAYS * DAY) throw fail(400, "cal_range_query", "Der Zeitraum ist zu gross", { max: MAX_RANGE_DAYS });
  return { from, to };
}

/**
 * @param deps { env, store (Namensraum des Teams), rootStore (globale Dokumente: users), now }
 * @returns Antwort, oder null wenn der Pfad nicht zum Kalender gehört
 */
export function route(path, method, req, deps, ctx) {
  if (path !== "/calendar" && !path.startsWith("/calendar/")) return null;
  return guard(async () => {
    const { store } = deps;

    if (path === "/calendar") {
      if (method !== "GET") return wrongMethod();
      const { from, to } = parseRange(queryOf(req));
      const members = await PUSH.teamMembers(deps, ctx);
      const events = [...(await loadEvents(store)), ...(await OL.importedEvents(deps, store, ctx.user.id))];
      const outlook = await OL.outlookEnabled(deps, store, ctx.user.id);
      const items = [];
      const used = new Set();
      let truncated = false;
      for (const ev of events) {
        let occs;
        try { occs = occurrences(ev, from, to, { limit: 500 }); } catch (e) { logError("Kalender: Termin nicht auswertbar", e, { id: ev.id }); continue; }
        for (const o of occs) {
          if (items.length >= MAX_ITEMS) { truncated = true; break; }
          items.push({ eventId: ev.id, i: o.i, start: o.start, end: o.end, allDay: Boolean(ev.allDay), sortMs: o.startMs });
          used.add(ev.id);
        }
      }
      items.sort((a, b) => a.sortMs - b.sortMs || a.eventId.localeCompare(b.eventId));
      return json(200, {
        now: new Date(deps.now).toISOString(),
        occurrences: items.map(({ sortMs, ...rest }) => rest),
        events: events.filter((e) => used.has(e.id)).map((e) => seen(ctx, e)),
        members: members.map(memberView),
        outlook,
        truncated,
      });
    }

    if (path === "/calendar/events") {
      if (method !== "POST") return wrongMethod();
      const members = await PUSH.teamMembers(deps, ctx);
      const clean = cleanEvent(parseBody(req, 16 * 1024), new Set(members.map((m) => m.id)));
      const at = new Date(deps.now).toISOString();
      const ev = { id: "ev_" + randomBytes(6).toString("hex"), ...clean, rev: 1, createdAt: at, createdBy: actorOf(ctx), updatedAt: at, updatedBy: actorOf(ctx) };
      await mutateDoc(store, EVENTS_KEY, (doc) => {
        const list = eventsOf(doc);
        if (list.length >= MAX_EVENTS) throw fail(409, "cal_too_many", `Höchstens ${MAX_EVENTS} Termine je Team`, { max: MAX_EVENTS });
        return { events: [...list, ev] };
      });
      const push = await OL.afterSave(deps, store, ev);
      return json(201, { event: seen(ctx, push.link ? { ...ev, outlook: push.link } : ev), outlook: push.status });
    }

    const m = /^\/calendar\/events\/([^/]+)$/.exec(path);
    if (!m) return json(404, { error: "not_found", message: "Nicht gefunden" });
    const id = m[1];
    if (!EVENT_ID_RE.test(id)) return notFound();

    if (method === "GET") {
      const ev = (await loadEvents(store)).find((e) => e.id === id) || (await OL.importedEvents(deps, store, ctx.user.id)).find((e) => e.id === id);
      return ev ? json(200, { event: seen(ctx, ev) }) : notFound();
    }
    if (method === "PUT") {
      const body = parseBody(req, 16 * 1024);
      if (!Number.isInteger(body.rev) || body.rev < 1) throw fail(400, "bad_request", "Ungültige Anfrage");
      const members = await PUSH.teamMembers(deps, ctx);
      const clean = cleanEvent(body, new Set(members.map((x) => x.id)));
      let result = null;
      let conflict = null;
      await mutateDoc(store, EVENTS_KEY, (doc) => {
        result = null; conflict = null;
        const list = eventsOf(doc);
        const i = list.findIndex((e) => e.id === id);
        if (i < 0) return undefined;
        const cur = list[i];
        if (cur.rev !== body.rev) { conflict = cur; return undefined; }
        result = { ...cur, ...clean, rev: cur.rev + 1, updatedAt: new Date(deps.now).toISOString(), updatedBy: actorOf(ctx) };
        const next = [...list];
        next[i] = result;
        return { events: next };
      });
      if (conflict) return json(409, { error: "cal_conflict", message: "Der Termin wurde inzwischen von jemand anderem geändert", event: seen(ctx, conflict) });
      if (!result) return (await readonlyOutlook(deps, store, ctx, id)) || notFound();
      const push = await OL.afterSave(deps, store, result);
      return json(200, { event: seen(ctx, push.link ? { ...result, outlook: push.link } : result), outlook: push.status });
    }
    if (method === "DELETE") {
      let gone = null;
      await mutateDoc(store, EVENTS_KEY, (doc) => {
        const list = eventsOf(doc);
        gone = list.find((e) => e.id === id) || null;
        return gone ? { events: list.filter((e) => e.id !== id) } : undefined;
      });
      if (!gone) return (await readonlyOutlook(deps, store, ctx, id)) || notFound();
      const del = await OL.afterDelete(deps, store, gone);
      return json(200, { ok: true, outlook: del.status });
    }
    return wrongMethod();
  });
}

// ---------------------------------------------------------------- Erinnerungen versenden (geplante Function)

/** Versandvermerk für die Schlüssel eintragen; liefert die Schlüssel, die DIESER Aufruf neu vermerkt hat (gleichzeitige Läufe: nur einer gewinnt) */
async function claimKeys(store, keys, now) {
  let claimed = [];
  await mutateDoc(store, SENT_KEY, (doc) => {
    claimed = [];
    const old = doc?.sent && typeof doc.sent === "object" ? doc.sent : {};
    const sent = {};
    let changed = false;
    for (const [k, v] of Object.entries(old)) {
      if (Number.isFinite(v) && now - v < SENT_KEEP_MS) sent[k] = v; else changed = true;
    }
    for (const k of keys) if (!(k in sent)) { sent[k] = now; claimed.push(k); changed = true; }
    return changed ? { sent } : undefined;
  });
  return new Set(claimed);
}

async function releaseKeys(store, keys, now) {
  await mutateDoc(store, SENT_KEY, (doc) => {
    const sent = { ...(doc?.sent || {}) };
    let changed = false;
    for (const k of keys) if (sent[k] === now) { delete sent[k]; changed = true; }
    return changed ? { sent } : undefined;
  });
}

const ZRH = "Europe/Zurich";
const fmtZrh = (opts) => new Intl.DateTimeFormat("de-CH", { timeZone: ZRH, ...opts });
const whenText = (ev, occ) => {
  if (ev.allDay) {
    const d = (s) => { const { y, m, d: dd } = parseYMD(s); return `${pad(dd)}.${pad(m)}.${y}`; };
    return occ.start === occ.end ? `${d(occ.start)} (ganztägig / all day)` : `${d(occ.start)} – ${d(occ.end)} (ganztägig / all day)`;
  }
  const day = fmtZrh({ day: "2-digit", month: "2-digit", year: "numeric" });
  const time = fmtZrh({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const s = new Date(occ.startMs), e = new Date(occ.endMs);
  const sameDay = day.format(s) === day.format(e);
  return `${day.format(s)} ${time.format(s)}${occ.endMs > occ.startMs ? ` – ${sameDay ? "" : day.format(e) + " "}${time.format(e)}` : ""} (${ZRH})`;
};

/** Vorlaufzeit als Text: [Deutsch, Englisch] */
export function leadText(min) {
  if (min === 0) return ["jetzt", "now"];
  if (min < 60) return [`in ${min} Min.`, `in ${min} min`];
  if (min < 1440) return [`in ${min / 60} Std.`, `in ${min / 60} h`];
  if (min < 10080) return [`in ${min / 1440} Tag${min === 1440 ? "" : "en"}`, `in ${min / 1440} day${min === 1440 ? "" : "s"}`];
  return ["in 1 Woche", "in 1 week"];
}

/**
 * Fällige Erinnerungen aller aktiven Teams versenden. Doppelversand ausgeschlossen: Der Versandvermerk wird VOR dem Versand atomar eingetragen;
 * gelingt keine einzige Zustellung (obwohl ein Weg versucht wurde), wird er zurückgenommen und der nächste Lauf versucht es erneut (innerhalb von LOOKBACK_MS).
 * @param deps { env, store (Wurzel-Store), now?: () => number, fetch?, webpush? }
 * @returns {Promise<{teams:number, due:number, sent:number}>}
 */
export async function runReminders(deps) {
  const res = { teams: 0, due: 0, sent: 0 };
  const { env } = deps;
  if (!PUSH.vapidConfig(env) && !PUSH.mailConfig(env)) return res; // kein Versandweg eingerichtet: nichts zu tun
  const now = deps.now ? deps.now() : Date.now();
  const root = deps.store;
  const teams = (await loadTeams(root, { now, cacheMs: 0 })).filter((t) => t.active !== false);
  if (!teams.length) return res;
  const users = await U.loadUsers(root, { now, cacheMs: 0 });
  for (const team of teams) {
    try {
      const store = scopedStore(root, team.id);
      const events = await loadEvents(store);
      const due = dueReminders(events, now);
      if (!due.length) continue;
      res.teams++;
      const sentDoc = (await store.read(SENT_KEY))?.value?.sent || {};
      const fresh = due.filter((d) => !(d.key in sentDoc));
      if (!fresh.length) continue;
      res.due += fresh.length;
      const claimed = await claimKeys(store, fresh.map((d) => d.key), now);
      const members = users.filter((u) => u.teamId === team.id && u.active !== false && u.role !== "superadmin");
      for (const d of fresh) {
        if (!claimed.has(d.key)) continue;
        const ev = d.event;
        const to = ev.participants?.length ? members.filter((m) => ev.participants.includes(m.id)) : members;
        if (!to.length) continue;
        const when = whenText(ev, d.occ);
        const [leadDe, leadEn] = leadText(d.minutes);
        const link = PUSH.appLink(env, `kalender/${ev.id}`);
        const r = await PUSH.deliver({ ...deps, env, store, now }, to, {
          payload: {
            t: "cal", title: PUSH.clip(PUSH.oneLine(ev.title), 80), body: PUSH.clip(`${when}${ev.location ? " · " + PUSH.oneLine(ev.location) : ""}`, 160),
            url: `/#/kalender/${ev.id}?o=${encodeURIComponent(d.occ.start)}`, tag: `cal-${ev.id}`, id: ev.id,
          },
          mail: {
            subject: `Erinnerung: ${PUSH.clip(PUSH.oneLine(ev.title), 100)} (${leadDe}) / Reminder (${leadEn})`,
            text: `${PUSH.oneLine(ev.title)}\n${when}${ev.location ? `\nOrt / Location: ${PUSH.oneLine(ev.location)}` : ""}\n${leadDe} / ${leadEn}\n${ev.notes ? `\n${PUSH.clip(ev.notes, 600)}\n` : ""}\n${link ? `Öffnen / Open: ${link}\n\n` : ""}Termin-Erinnerung des Team-Kalenders. / Reminder from the team calendar.`,
          },
          deadlineMs: 15000,
        });
        if (r.tried > 0 && r.push + r.mail === 0) await releaseKeys(store, [d.key], now);
        else res.sent += r.push + r.mail;
      }
    } catch (err) {
      logError("Kalender-Erinnerungen", err, { team: team.id });
    }
  }
  return res;
}
