// STPS CRM – Änderungsprotokoll («Letzte Änderungen») und serverseitige Stempel.
//
// Bei jedem erfolgreichen PUT /api/db vergleicht der Server den alten mit dem neuen Stand (je Tabelle, je Datensatz):
//  - createdBy/updatedBy/updatedAt werden aus dem angemeldeten Konto gesetzt (Werte vom Client zählen nicht),
//  - für jede Änderung entsteht ein Eintrag im Blob «audit» des Teams (rollierend, die letzten AUDIT_KEEP).
import { mutateDoc } from "./kv.mjs";
import { scrubAuditEntry } from "./hide-super.mjs";

export const AUDIT_KEY = "audit";
export const AUDIT_KEEP = 2000;
/** Mehr als so viele Änderungen einer Tabelle in einem Speichern (z. B. Import, «Alles löschen») → eine Sammelzeile je Aktion. */
export const BULK_THRESHOLD = 25;

const STAMP_FIELDS = new Set(["id", "createdAt", "createdBy", "updatedAt", "updatedBy"]);
const STAMPS = ["createdAt", "createdBy", "updatedAt", "updatedBy"];
const LIST_LABELS = { owners: "Team / Verantwortliche", quellen: "Quellen", aktivitaetstypen: "Aktivitätstypen", kundenstatus: "Kundenstatus" };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isRec = (r) => r !== null && typeof r === "object" && !Array.isArray(r) && typeof r.id === "string" && r.id !== "";

function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

const clip = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * @param oldData  bisheriger Stand (oder null beim allerersten Speichern)
 * @param newData  vom Client gesendeter Stand – wird direkt mit den Server-Stempeln versehen
 * @param actor    { id, displayName, name (Stempel), superadmin }
 * @returns {{data:object, entries:object[]}}
 */
export function stampAndDiff(oldData, newData, actor, nowMs) {
  const iso = new Date(nowMs).toISOString();
  const oldD = oldData && typeof oldData === "object" ? oldData : {};
  const entries = [];

  const lookup = (table, id) => {
    if (!id) return null;
    for (const d of [newData, oldD]) {
      const r = Array.isArray(d[table]) ? d[table].find((x) => x && x.id === id) : null;
      if (r) return r;
    }
    return null;
  };
  const firma = (table, id) => lookup(table, id)?.firma || "";

  const labelFor = (table, r) => {
    switch (table) {
      case "customers": case "suppliers": return clip(r.firma);
      case "deals": { const c = firma("customers", r.customerId); return clip(`${r.produkt || "Angebot"}${c ? ` (${c})` : ""}`); }
      case "rfqs": return clip(`${firma("customers", r.customerId) || "?"} ↔ ${firma("suppliers", r.supplierId) || "?"}`);
      case "activities": { const w = firma("customers", r.customerId) || firma("suppliers", r.supplierId); return clip(`${r.typ || "Aktivität"} ${r.datum || ""}${w ? ` · ${w}` : ""}`); }
      case "tasks": return clip(r.aufgabe);
      case "focus": return clip(firma("customers", r.customerId));
      case "approvals": return clip(r.thema);
      case "articles": return clip(r.bezeichnung);
      case "invoices": return clip(firma("customers", r.customerId));
      default: return clip(r.name || r.title || r.id);
    }
  };
  const refOf = (table, r) => {
    if (table === "customers" || table === "suppliers") return undefined;
    const ref = {};
    for (const k of ["customerId", "supplierId", "dealId"]) if (typeof r[k] === "string" && ID_RE.test(r[k])) ref[k] = r[k];
    return Object.keys(ref).length ? ref : undefined;
  };
  const base = (action, table) => ({
    at: iso, uid: actor.id, displayName: actor.displayName, ...(actor.superadmin ? { superadmin: true } : {}), action, table,
  });
  const entryFor = (action, table, r, fields = []) => {
    const nr = Number(r.nr);
    const ref = refOf(table, r);
    return { ...base(action, table), recordId: r.id, number: Number.isFinite(nr) && r.nr !== "" && r.nr !== null ? nr : null, label: labelFor(table, r), fields, ...(ref ? { ref } : {}) };
  };

  const tables = new Set([...Object.keys(oldD), ...Object.keys(newData)].filter((k) => Array.isArray(oldD[k]) || Array.isArray(newData[k])));
  for (const table of tables) {
    const oldArr = Array.isArray(oldD[table]) ? oldD[table] : [];
    const newArr = Array.isArray(newData[table]) ? newData[table] : [];
    const oldMap = new Map();
    for (const r of oldArr) if (isRec(r) && !oldMap.has(r.id)) oldMap.set(r.id, r);
    const seen = new Set();
    const tEntries = [];

    for (const rec of newArr) {
      if (!isRec(rec) || seen.has(rec.id)) continue;
      seen.add(rec.id);
      const o = oldMap.get(rec.id);
      if (!o) {
        const c = Date.parse(rec.createdAt);
        rec.createdAt = Number.isFinite(c) && c >= Date.UTC(2020, 0, 1) && c <= nowMs + 5 * 60000 ? new Date(c).toISOString() : iso;
        rec.createdBy = actor.name;
        rec.updatedAt = iso;
        rec.updatedBy = actor.name;
        tEntries.push(entryFor("create", table, rec));
        continue;
      }
      const fields = [...new Set([...Object.keys(rec), ...Object.keys(o)])].filter((k) => !STAMP_FIELDS.has(k) && !same(rec[k], o[k]));
      for (const k of STAMPS) { if (k in o) rec[k] = o[k]; else delete rec[k]; } // Stempel des Clients verwerfen
      if (fields.length) {
        rec.updatedAt = iso;
        rec.updatedBy = actor.name;
        tEntries.push(entryFor("update", table, rec, fields));
      }
    }
    for (const [id, o] of oldMap) if (!seen.has(id)) tEntries.push(entryFor("delete", table, o));

    if (tEntries.length > BULK_THRESHOLD) {
      for (const action of ["create", "update", "delete"]) {
        const n = tEntries.filter((e) => e.action === action).length;
        if (n) entries.push({ ...base(action, table), recordId: "", number: null, label: `${n} Einträge`, fields: [], count: n });
      }
    } else {
      entries.push(...tEntries);
    }
  }

  // Auswahllisten (Einstellungen)
  const oldLists = oldD.lists && typeof oldD.lists === "object" ? oldD.lists : {};
  const newLists = newData.lists && typeof newData.lists === "object" ? newData.lists : {};
  for (const k of new Set([...Object.keys(oldLists), ...Object.keys(newLists)])) {
    if (!same(oldLists[k], newLists[k])) entries.push({ ...base("update", "lists"), recordId: k, number: null, label: LIST_LABELS[k] || clip(k, 40), fields: [] });
  }
  // Firmenangaben, Warengruppen, MWST, Zahlungsfrist, Startnummer (settings.billing): ein Eintrag pro Speichern
  const oldBilling = oldD.settings?.billing, newBilling = newData.settings?.billing;
  if (newBilling !== undefined && oldBilling !== undefined && !same(oldBilling, newBilling)) {
    const fields = [...new Set([...Object.keys(oldBilling && typeof oldBilling === "object" ? oldBilling : {}), ...Object.keys(newBilling && typeof newBilling === "object" ? newBilling : {})])].filter((k) => !same(oldBilling?.[k], newBilling?.[k]));
    entries.push({ ...base("update", "settings"), recordId: "billing", number: null, label: "Abrechnung / Firmenangaben", fields });
  }
  return { data: newData, entries };
}

/** Einträge anhängen (rollierend). Fehler hier dürfen das Speichern nie verhindern – der Aufrufer fängt sie ab. */
export async function appendAudit(store, entries) {
  if (!entries.length) return;
  await mutateDoc(store, AUDIT_KEY, (doc) => ({ entries: [...(doc?.entries ?? []), ...entries].slice(-AUDIT_KEEP) }));
}

const idParam = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);

/**
 * GET /api/audit – neueste zuerst. Filter: uid, table, recordId (related=1: auch Einträge, die per ref auf den Datensatz zeigen), limit (max. 200).
 * hideSuper (Aufrufer ist kein Superadmin): Einträge des Superadmins erscheinen ohne Namen (anon: true, der Browser zeigt «System»), sein Eintritt ins Team gar nicht,
 * und ein Filter auf seine Kennung findet nichts.
 */
export async function queryAudit(store, q, { hideSuper = false } = {}) {
  const doc = (await store.read(AUDIT_KEY))?.value;
  const all = Array.isArray(doc?.entries) ? doc.entries : [];
  const uid = idParam(q.get("uid"));
  const table = /^[a-z]{2,20}$/.test(q.get("table") || "") ? q.get("table") : null;
  const recordId = idParam(q.get("recordId"));
  const related = q.get("related") === "1";
  const n = Number(q.get("limit"));
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 50;
  const out = [];
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const e = all[i];
    if (!e || typeof e !== "object") continue;
    const sup = hideSuper && e.superadmin;
    if (sup && e.action === "enter") continue;
    if (uid && (sup || e.uid !== uid)) continue;
    if (table && e.table !== table) continue;
    if (recordId && e.recordId !== recordId && !(related && (e.ref?.customerId === recordId || e.ref?.supplierId === recordId))) continue;
    out.push(sup ? scrubAuditEntry(e) : e);
  }
  return out;
}

/** Letzte n Einträge je Benutzer (für die Team-Seite) aus dem bereits geladenen Protokoll. */
export async function recentByUser(store, uids, n = 10) {
  const doc = (await store.read(AUDIT_KEY))?.value;
  const all = Array.isArray(doc?.entries) ? doc.entries : [];
  const out = Object.fromEntries(uids.map((u) => [u, []]));
  for (let i = all.length - 1; i >= 0; i--) {
    const list = out[all[i]?.uid];
    if (list && list.length < n) list.push(all[i]);
  }
  return out;
}
