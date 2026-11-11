// STPS CRM – Beispieldaten im laufenden Betrieb (nur Team-Admins): HINZUFÜGEN und wieder ENTFERNEN, ohne echte Daten anzutasten.
//
//  POST /api/sample/add     fügt den Beispielsatz (sample/beispieldaten.json) dem aktuellen Team hinzu. Es wird nichts gelöscht oder überschrieben:
//                           - jeder Beispiel-Datensatz trägt `sample: true` und den Hinweis «Beispieldaten» in seinem Notizfeld,
//                           - alle IDs bekommen das Präfix «bsp-» (Kollisionen mit echten IDs ausgeschlossen), alle Querverweise werden angepasst,
//                           - Nummern (Kunden, Lieferanten, Aktivitäten, Angebote, Aufgaben, Rechnungen) liegen in einem Block UNTERHALB des Nummernkreis-Starts
//                             (z. B. Kunden 9986–9999, Rechnungen direkt unter der Startnummer): «nächste Nummer = grösste + 1, mindestens Start» bleibt dadurch unverändert,
//                             meta.lastNr wird nicht angefasst. Artikelnummern liegen in einem Block ausserhalb aller Warengruppen-Bereiche (ab 9'000'001),
//                           - Einstellungen (Warengruppen, Bankkonten, Firmendaten, Listen) bleiben unverändert; Verweise auf nicht vorhandene Warengruppen/Bankkonten/Verantwortliche werden angepasst,
//                           - Kalendertermine ohne Erinnerungen und ohne Teilnehmer (es gehen keine Benachrichtigungen an das Team),
//                           - sind schon Beispieldaten vorhanden, wird abgelehnt (409 sample_exists): nichts wird doppelt angelegt.
//  POST /api/sample/remove  löscht NUR Datensätze (und Kalendertermine) mit `sample: true`.
// Gespeichert wird versioniert wie bei jedem Schreiben (commitDb, ifMatch); bei gleichzeitiger Änderung wird neu aufgesetzt (bis 5 Versuche), sonst 409.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DB_KEY, commitDb } from "./db.mjs";
import { mutateDoc } from "./kv.mjs";
import { cleanEvent, EVENTS_KEY, MAX_EVENTS } from "./calendar.mjs";
import { stampAndDiff, appendAudit } from "./audit.mjs";
import { json, logError } from "./http.mjs";

export const SAMPLE_ID_PREFIX = "bsp-";
export const SAMPLE_WORD = "Beispieldaten";
const COLLS = ["customers", "suppliers", "rfqs", "deals", "activities", "tasks", "focus", "approvals", "articles", "invoices"];
const NR_BASE = { customers: 10000, suppliers: 20000, activities: 30000, deals: 40000, tasks: 50000 }; // wie js/config.js (NR_BASE)
const DEFAULT_INVOICE_START = 60000;
const NOTE_FIELD = { customers: "kommentar", suppliers: "notiz", rfqs: "kommentar", deals: "kommentar", activities: "notiz", tasks: "kommentar", focus: "kommentar", approvals: "entscheidung", articles: "notiz", invoices: "bemerkung" };
const ART_BLOCKS = [9e6, 8e6, 7e6, 6e6, 5e6, 4e6, 3e6, 2e6, 1e6];
const NO_TEXT_KEYS = /^(id|link|email|telefon|mobile|iban|trackingNr|trackingLink|containerNr|blAwbNr|vessel|.*Id)$/;
const EVENT_ID_RE = /^ev_[0-9a-f]{12}$/;
const isRec = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Der Beispielsatz. Liegt je nach Bündelung an verschiedenen Stellen (Quelltext, Netlify-Function mit included_files) – deshalb mehrere Kandidaten. */
export async function readSampleFile() {
  const rel = "sample/beispieldaten.json";
  const root = process.env.LAMBDA_TASK_ROOT || "";
  const cands = [
    new URL("../../../" + rel, import.meta.url), new URL("../../" + rel, import.meta.url), new URL("../" + rel, import.meta.url), new URL("./" + rel, import.meta.url),
    join(process.cwd(), rel), join(process.cwd(), "stps-crm", rel),
    ...(root ? [join(root, rel), join(root, "stps-crm", rel)] : []),
  ];
  for (const c of cands) {
    try { return JSON.parse(await readFile(c, "utf8")); } catch { /* nächster Kandidat */ }
  }
  return null;
}

export const hasSample = (data) => COLLS.some((c) => Array.isArray(data?.[c]) && data[c].some((r) => r && r.sample === true));
const sampleCounts = (data) => Object.fromEntries(COLLS.map((c) => [c, (Array.isArray(data?.[c]) ? data[c] : []).filter((r) => r && r.sample === true).length]));

class SampleError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/**
 * Beispielsatz an die vorhandenen Daten anpassen. Rein (ohne Speicher), damit testbar.
 * @param raw   Inhalt von sample/beispieldaten.json
 * @param data  aktueller Stand der Teamdaten (wird nicht verändert)
 * @param opts  { owners: string[] (Verantwortliche des Teams) }
 * @returns {{recs: object, events: object[], counts: object}}
 */
export function buildSample(raw, data, { owners = [] } = {}) {
  const billing = isRec(data?.settings?.billing) ? data.settings.billing : {};
  const groups = Array.isArray(billing.warengruppen) ? billing.warengruppen : [];
  const banks = Array.isArray(billing.banks) ? billing.banks : [];
  const taken = (coll) => new Set((Array.isArray(data?.[coll]) ? data[coll] : []).map((r) => Number(r?.nr)).filter(Number.isFinite));

  // ---- IDs: alle IDs der Beispiel-Datensätze (auch verschachtelt: Kontakte, Adressen, Positionen, Dokumente, Ereignisse) erhalten das Präfix
  const idMap = new Map();
  const collect = (o) => {
    if (Array.isArray(o)) o.forEach(collect);
    else if (isRec(o)) {
      if (typeof o.id === "string" && o.id) idMap.set(o.id, o.id.startsWith(SAMPLE_ID_PREFIX) ? o.id : SAMPLE_ID_PREFIX + o.id);
      Object.values(o).forEach(collect);
    }
  };
  for (const c of COLLS) collect(raw[c]);
  const existingIds = new Set();
  const gather = (o) => { if (Array.isArray(o)) o.forEach(gather); else if (isRec(o)) { if (typeof o.id === "string") existingIds.add(o.id); Object.values(o).forEach(gather); } };
  for (const c of COLLS) gather(data?.[c]);
  for (const nid of idMap.values()) if (existingIds.has(nid)) throw new SampleError(409, "sample_id_collision", "Beispiel-IDs kollidieren mit vorhandenen Daten");

  // ---- Nummern: Block unterhalb des Nummernkreis-Starts, vorhandene Nummern werden übersprungen
  const nrMap = new Map(); // "coll:alt" -> neu
  const textMap = new Map(); // alte Nummer (Text) -> neue Nummer
  const invStart = Number.isInteger(Number(billing.invoiceStart)) && Number(billing.invoiceStart) > 0 ? Number(billing.invoiceStart) : DEFAULT_INVOICE_START;
  for (const c of [...Object.keys(NR_BASE), "invoices"]) {
    const base = c === "invoices" ? invStart : NR_BASE[c];
    const used = taken(c);
    const list = (raw[c] || []).slice().sort((a, b) => Number(b.nr) - Number(a.nr));
    let n = base - 1;
    for (const r of list) {
      while (used.has(n)) n--;
      if (n < 1) throw new SampleError(409, "sample_no_numbers", "Kein freier Nummernbereich für die Beispieldaten");
      nrMap.set(c + ":" + r.nr, n);
      textMap.set(String(r.nr), n);
      used.add(n);
      n--;
    }
  }
  // ---- Artikelnummern: Block ausserhalb aller Warengruppen-Bereiche und vorhandener Nummern (sonst ohne Nummer)
  const artRaw = (raw.articles || []).slice().sort((a, b) => Number(a.nr) - Number(b.nr));
  const artTaken = taken("articles");
  const ranges = groups.map((g) => [Number(g?.von), Number(g?.bis)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  let artStart = null;
  for (const s of ART_BLOCKS) {
    const lo = s + 1, hi = s + artRaw.length;
    if (!ranges.some(([a, b]) => lo <= b && hi >= a) && ![...artTaken].some((x) => x >= lo && x <= hi)) { artStart = s; break; }
  }
  const artMap = new Map(); // alte Nummer -> neue (oder null)
  artRaw.forEach((a, i) => artMap.set(Number(a.nr), artStart === null ? null : artStart + 1 + i));

  // ---- Verantwortliche, Warengruppen, Bankkonten
  const ownerMap = new Map();
  const ownerOf = (o) => {
    if (!owners.length || owners.includes(o)) return o;
    if (!ownerMap.has(o)) ownerMap.set(o, owners[ownerMap.size % owners.length]);
    return ownerMap.get(o);
  };
  const wgIds = new Set(groups.map((g) => g?.id).filter(Boolean));
  const ukIds = new Set(groups.flatMap((g) => (Array.isArray(g?.unterkategorien) ? g.unterkategorien : []).map((u) => u?.id)).filter(Boolean));
  const bankFor = (bankId, cur) => (banks.some((b) => b?.id === bankId) ? bankId : banks.find((b) => b?.waehrung === cur)?.id || "");

  const mapString = (s, key) => {
    if (idMap.has(s)) return idMap.get(s);
    if (NO_TEXT_KEYS.test(key) || !/\d{5}/.test(s)) return s;
    return s.replace(/(?<![\w'.,/-])(\d{5,6})(?![\w'])/g, (m) => (textMap.has(m) ? String(textMap.get(m)) : m));
  };
  const walk = (o, key = "") => {
    if (Array.isArray(o)) return o.map((x) => walk(x, key));
    if (isRec(o)) return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "artNr" && typeof v === "number" ? (artMap.has(v) ? artMap.get(v) : v) : walk(v, k)]));
    return typeof o === "string" ? mapString(o, key) : o;
  };

  const recs = {};
  for (const c of COLLS) {
    recs[c] = (raw[c] || []).map((src) => {
      const r = walk(src);
      if (c === "articles") r.nr = artMap.get(Number(src.nr)) ?? null;
      else if (src.nr !== undefined) r.nr = nrMap.get(c + ":" + src.nr);
      if (typeof r.owner === "string" && r.owner) r.owner = ownerOf(r.owner);
      if (Array.isArray(r.kategorien)) r.kategorien = r.kategorien.filter((k) => wgIds.has(k) || ukIds.has(k));
      if (c === "articles") {
        if (!wgIds.has(r.warengruppeId)) r.warengruppeId = "";
        if (!ukIds.has(r.unterkategorieId)) r.unterkategorieId = "";
      }
      if (c === "invoices") r.bankId = bankFor(r.bankId, r.waehrung);
      r.sample = true;
      const nf = NOTE_FIELD[c];
      if (!JSON.stringify(r).includes(SAMPLE_WORD)) r[nf] = r[nf] ? `${SAMPLE_WORD}: ${r[nf]}` : SAMPLE_WORD;
      return r;
    });
  }
  const counts = Object.fromEntries(COLLS.map((c) => [c, recs[c].length]));
  return { recs, events: Array.isArray(raw.kalender) ? raw.kalender : [], counts };
}

const ownerNames = (data, ctx) => {
  const from = (arr) => (Array.isArray(arr) ? arr.map((o) => (typeof o === "string" ? o : o?.name)).filter((n) => typeof n === "string" && n) : []);
  const a = from(data?.lists?.owners);
  return a.length ? a : from(ctx?.team?.settings?.owners);
};

const eventList = (doc) => (Array.isArray(doc?.events) ? doc.events : []);

async function addCalendar(store, raw, ctx, now) {
  const at = new Date(now).toISOString();
  const by = { id: ctx.user.id, name: ctx.actor.name };
  const fresh = [];
  for (const e of raw) {
    try {
      const clean = cleanEvent({ ...e, participants: [], reminders: [] }, new Set()); // ohne Erinnerungen/Teilnehmer: keine Benachrichtigungen an das Team
      const notes = clean.notes && clean.notes.includes(SAMPLE_WORD) ? clean.notes : `${SAMPLE_WORD}${clean.notes ? ": " + clean.notes : ""}`;
      fresh.push({ ...clean, notes, sample: true, rev: 1, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });
    } catch { /* ungültiger Beispieltermin: überspringen */ }
  }
  let added = 0;
  await mutateDoc(store, EVENTS_KEY, (doc) => {
    const keep = eventList(doc).filter((x) => !(x && x.sample === true)); // nur frühere Beispieltermine ersetzen
    const ids = new Set(keep.map((x) => x?.id));
    const mine = fresh.map((x) => { let id; do id = "ev_" + randomBytes(6).toString("hex"); while (ids.has(id)); ids.add(id); return { ...x, id }; });
    if (keep.length + mine.length > MAX_EVENTS) return undefined;
    added = mine.length;
    return { events: [...keep, ...mine] };
  });
  return added;
}

async function removeCalendar(store) {
  let removed = 0;
  await mutateDoc(store, EVENTS_KEY, (doc) => {
    const list = eventList(doc);
    const keep = list.filter((x) => !(x && x.sample === true));
    removed = list.length - keep.length;
    return removed ? { events: keep } : undefined;
  });
  return removed;
}

const conflict = () => json(409, { error: "conflict", message: "Daten wurden von jemand anderem geändert. Bitte erneut versuchen.", reason: "sample_conflict" });

async function commitWithRetry(store, ctx, now, make) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await store.read(DB_KEY);
    const out = make(cur);
    if (out.response) return { response: out.response };
    if (out.skip) return { ok: true, version: cur?.value.version ?? 0, out }; // nichts zu schreiben
    const stamped = stampAndDiff(cur?.value.data ?? null, out.data, ctx.actor, now);
    const res = await commitDb(store, cur, { data: stamped.data, by: ctx.actor.name, now });
    if (!res.ok) continue; // jemand war schneller: auf dem neuen Stand erneut aufsetzen (die Operation ist additiv bzw. betrifft nur Beispieldaten)
    try { await appendAudit(store, stamped.entries); } catch (err) { logError("Änderungsprotokoll (Beispieldaten) fehlgeschlagen", err); }
    return { ok: true, version: res.doc.version, out };
  }
  return { ok: false };
}

export async function addSample(deps, ctx) {
  const { store, now } = deps;
  const raw = await readSampleFile();
  if (!raw) return json(404, { error: "not_found", message: "Beispieldaten nicht gefunden", reason: "sample_missing" });
  const r = await commitWithRetry(store, ctx, now, (cur) => {
    const data = cur ? clone(cur.value.data) : { schema: raw.schema, meta: { createdAt: new Date(now).toISOString(), lastNr: {} }, lists: {}, settings: {} };
    if (hasSample(data)) return { response: json(409, { error: "sample_exists", message: "Beispieldaten sind bereits geladen. Entfernen Sie sie zuerst.", reason: "sample_exists" }) };
    let built;
    try { built = buildSample(raw, data, { owners: ownerNames(data, ctx) }); } catch (e) { if (e instanceof SampleError) return { response: json(e.status, { error: e.code, message: e.message, reason: e.code }) }; throw e; }
    for (const c of COLLS) data[c] = [...(Array.isArray(data[c]) ? data[c] : []), ...built.recs[c]];
    return { data, built };
  });
  if (r.response) return r.response;
  if (!r.ok) return conflict();
  let events = 0;
  if (deps.calendarOn) {
    try { events = await addCalendar(store, r.out.built.events, ctx, now); } catch (err) { logError("Beispieltermine konnten nicht angelegt werden", err); }
  }
  return json(200, { ok: true, version: r.version, counts: r.out.built.counts, events });
}

export async function removeSample(deps, ctx) {
  const { store, now } = deps;
  const r = await commitWithRetry(store, ctx, now, (cur) => {
    const data = cur ? clone(cur.value.data) : null;
    if (!data) return { data: null, removed: Object.fromEntries(COLLS.map((c) => [c, 0])), skip: true };
    const removed = sampleCounts(data);
    const ids = new Set();
    for (const c of COLLS) if (Array.isArray(data[c])) { for (const x of data[c]) if (x?.sample === true && x.id) ids.add(x.id); data[c] = data[c].filter((x) => !(x && x.sample === true)); }
    // echte Datensätze, die auf einen entfernten Beispiel-Datensatz zeigen (selbst angelegt): bleiben unverändert, werden nur gezählt
    let orphaned = 0;
    for (const c of COLLS) for (const x of data[c] || []) if (["customerId", "supplierId", "dealId", "contactId", "articleId"].some((k) => ids.has(x?.[k]))) orphaned++;
    return { data, removed, orphaned, skip: !hasSampleCounts(removed) };
  });
  if (r.response) return r.response;
  if (!r.ok) return conflict();
  let events = 0;
  if (deps.calendarOn) {
    try { events = await removeCalendar(store); } catch (err) { logError("Beispieltermine konnten nicht entfernt werden", err); }
  }
  return json(200, { ok: true, version: r.version, removed: r.out.removed, events, orphaned: r.out.orphaned || 0 });
}
const hasSampleCounts = (c) => Object.values(c).some((n) => n > 0);

/** @returns Antwort, oder null wenn der Pfad nicht zu den Beispieldaten gehört */
export async function route(path, method, req, deps, ctx) {
  if (path !== "/sample/add" && path !== "/sample/remove") return null;
  if (method !== "POST") return json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
  if (!ctx.isAdmin && !ctx.isSuper) return json(403, { error: "forbidden", message: "Nur Admins dürfen Beispieldaten hinzufügen oder entfernen", reason: "sample_admins_only" });
  return path === "/sample/add" ? addSample(deps, ctx) : removeSample(deps, ctx);
}
