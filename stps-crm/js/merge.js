// Drei-Wege-Merge der Datenbank (Basis = letzter Serverstand, local = eigene Änderungen, remote = aktueller Serverstand).
// Rein funktional (keine DOM-Abhängigkeit), damit auch in Node testbar.
import { COLLECTIONS, NR_BASE, COUNTED } from "./config.js";
import { deepEqual, clone } from "./util.js";
import { groupOfNr, nextArtNr, nextInvoiceNr, normalizeBilling } from "./billing.js";

const STAMP_KEYS = new Set(["updatedAt", "updatedBy"]);

const byId = (arr) => new Map((arr || []).map((r) => [r.id, r]));

function newer(a, b) {
  return (a?.updatedAt || "") >= (b?.updatedAt || "") ? a : b;
}

/** Feldweiser Merge eines einzelnen Datensatzes. Gleiches Feld beidseitig geändert -> lokal gewinnt (Konflikt wird gemeldet). */
function mergeRecord(b, l, r, ctx, coll) {
  const out = {};
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(r)]);
  for (const k of keys) {
    const bv = b?.[k], lv = l[k], rv = r[k];
    if (k === "contacts") {
      out.contacts = mergeContacts(bv, lv, rv, ctx, coll, l.id);
    } else if (k === "addresses") {
      out.addresses = fixSubNumbers(mergeContacts(bv, lv, rv, ctx, coll, l.id, "addresses"));
    } else if (deepEqual(lv, bv)) {
      if (rv !== undefined) out[k] = rv;
    } else if (deepEqual(rv, bv) || deepEqual(lv, rv)) {
      if (lv !== undefined) out[k] = lv;
    } else {
      if (lv !== undefined) out[k] = lv;
      if (!STAMP_KEYS.has(k)) ctx.conflicts.push({ coll, id: l.id, field: k });
    }
  }
  if (!deepEqual(l.updatedAt, b?.updatedAt) && !deepEqual(r.updatedAt, b?.updatedAt)) {
    const n = newer(l, r);
    out.updatedAt = n.updatedAt;
    out.updatedBy = n.updatedBy;
  }
  return out;
}

/** Kontaktpersonen (Unterliste) per id mergen; danach genau ein Hauptkontakt. */
function mergeContacts(b, l, r, ctx, coll, recId, field = "contacts") {
  b = b || []; l = l || []; r = r || [];
  const B = byId(b), L = byId(l), R = byId(r);
  const ids = [...r.map((c) => c.id), ...l.filter((c) => !R.has(c.id)).map((c) => c.id)];
  const out = [];
  for (const id of ids) {
    const bc = B.get(id), lc = L.get(id), rc = R.get(id);
    if (!bc) { out.push(lc && !rc ? lc : rc || lc); continue; }
    if (!lc && !rc) continue;
    if (!lc) { // lokal gelöscht
      if (!deepEqual(rc, bc)) ctx.conflicts.push({ coll, id: recId, field });
      continue;
    }
    if (!rc) { if (!deepEqual(lc, bc)) { out.push(lc); ctx.conflicts.push({ coll, id: recId, field }); } continue; }
    out.push(mergeRecord(bc, lc, rc, ctx, coll + "." + field));
  }
  if (field !== "contacts") return out; // Lieferadressen: kein Hauptkontakt
  // genau ein Hauptkontakt
  const prim = out.filter((c) => c.primary);
  if (out.length) {
    if (!prim.length) out[0].primary = true;
    else if (prim.length > 1) {
      // der in l markierte gewinnt, sonst der erste
      const keep = prim.find((c) => L.get(c.id)?.primary && !B.get(c.id)?.primary) || prim[0];
      for (const c of out) c.primary = c === keep;
    }
  }
  return out;
}

/** Lieferadressen: gleichzeitig vergebene Unternummern (10000.3 doppelt) bekommen für die später genannte die nächste freie Nummer */
function fixSubNumbers(list) {
  const seen = new Set();
  let max = Math.max(0, ...list.map((a) => Number(a.sub) || 0));
  return list.map((a) => {
    if (a.sub && !seen.has(a.sub)) { seen.add(a.sub); return a; }
    return { ...a, sub: ++max };
  });
}

function mergeCollection(coll, b, l, r, ctx) {
  const B = byId(b), L = byId(l), R = byId(r);
  const order = [...(r || []).map((x) => x.id), ...(l || []).filter((x) => !R.has(x.id)).map((x) => x.id)];
  const out = [];
  for (const id of order) {
    const bx = B.get(id), lx = L.get(id), rx = R.get(id);
    if (!bx) {
      // neu angelegt (lokal und/oder remote)
      if (lx && rx) out.push(mergeRecord(undefined, lx, rx, ctx, coll));
      else out.push(clone(lx || rx));
      if (lx && !rx) ctx.addedLocal.push({ coll, id });
      continue;
    }
    if (!lx && !rx) continue;
    if (!lx) { // lokal gelöscht
      if (!deepEqual(rx, bx)) ctx.conflicts.push({ coll, id, field: "(gelöscht)" });
      continue;
    }
    if (!rx) { // remote gelöscht
      if (!deepEqual(lx, bx)) { out.push(clone(lx)); ctx.conflicts.push({ coll, id, field: "(remote gelöscht)" }); }
      continue;
    }
    out.push(mergeRecord(bx, lx, rx, ctx, coll));
  }
  return out;
}

function mergeLists(b, l, r, ctx) {
  const out = {};
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(l || {}), ...Object.keys(r || {})]);
  for (const k of keys) {
    const bv = b?.[k], lv = l?.[k], rv = r?.[k];
    let v;
    if (deepEqual(lv, bv)) v = rv;
    else if (deepEqual(rv, bv) || deepEqual(lv, rv)) v = lv;
    else { v = lv; ctx.conflicts.push({ coll: "lists", id: k, field: k }); }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Einstellungen (settings.billing): feldweise wie die Auswahllisten; ganze Listen (Warengruppen) zählen als ein Wert. */
function mergeSettings(b, l, r, ctx) {
  const out = { ...(r || {}), ...(l || {}) };
  // Wechselkurse (settings.fx): als Ganzes – wer sie geändert hat, gewinnt (beide: lokal)
  if (r?.fx !== undefined || l?.fx !== undefined) out.fx = deepEqual(l?.fx, b?.fx) ? r?.fx : l?.fx;
  const bb = b?.billing, lb = l?.billing, rb = r?.billing;
  if (lb || rb) {
    const merged = {};
    for (const k of new Set([...Object.keys(bb || {}), ...Object.keys(lb || {}), ...Object.keys(rb || {})])) {
      const bv = bb?.[k], lv = lb?.[k], rv = rb?.[k];
      let v;
      if (deepEqual(lv, bv)) v = rv;
      else if (deepEqual(rv, bv) || deepEqual(lv, rv)) v = lv;
      else { v = lv; ctx.conflicts.push({ coll: "settings", id: "billing", field: k }); }
      if (v !== undefined) merged[k] = v;
    }
    out.billing = normalizeBilling(merged);
  }
  return out;
}

/** Doppelt vergebene Rechnungs-/Artikelnummern: der lokal neu angelegte Datensatz bekommt die nächste freie Nummer (Artikel: innerhalb seiner Warengruppe). */
function fixBillingNumbers(db, ctx) {
  const local = (coll) => new Set(ctx.addedLocal.filter((x) => x.coll === coll).map((x) => x.id));
  // Rechnungen
  const li = local("invoices");
  const start = db.settings?.billing?.invoiceStart;
  const seenI = new Set(db.invoices.filter((x) => !li.has(x.id)).map((x) => x.nr));
  let lastI = Math.max(Number(db.meta.lastNr?.invoices) || 0, ...db.invoices.map((x) => Number(x.nr) || 0));
  for (const rec of db.invoices) {
    if (!li.has(rec.id)) continue;
    if (seenI.has(rec.nr)) {
      const old = rec.nr;
      rec.nr = nextInvoiceNr([], start, lastI);
      lastI = rec.nr;
      ctx.renumbered.push({ coll: "invoices", id: rec.id, from: old, to: rec.nr });
    }
    seenI.add(rec.nr);
  }
  db.meta.lastNr = { ...(db.meta.lastNr || {}), invoices: lastI };
  // Artikel
  const la = local("articles");
  const gruppen = db.settings?.billing?.warengruppen || [];
  const seenA = new Set(db.articles.filter((x) => !la.has(x.id)).map((x) => x.nr));
  for (const rec of db.articles) {
    if (!la.has(rec.id)) continue;
    if (rec.nr !== null && rec.nr !== undefined && seenA.has(rec.nr)) {
      const g = groupOfNr(gruppen, rec.nr) || gruppen.find((x) => x.id === rec.warengruppeId);
      const next = g ? nextArtNr(db.articles, g) : null;
      if (next !== null) {
        const old = rec.nr;
        rec.nr = next;
        ctx.renumbered.push({ coll: "articles", id: rec.id, from: old, to: next });
      }
    }
    seenA.add(rec.nr);
  }
}

/** Doppelt vergebene Nummern: den lokal neu angelegten Datensatz auf die nächste freie Nummer setzen. */
function fixNumbers(db, ctx) {
  for (const coll of Object.keys(NR_BASE)) {
    const seen = new Map();
    const local = new Set(ctx.addedLocal.filter((x) => x.coll === coll).map((x) => x.id));
    let max = Math.max(NR_BASE[coll] - 1, db.meta.lastNr?.[coll] ?? 0, ...db[coll].map((x) => x.nr || 0));
    // zuerst die nicht-lokalen Datensätze registrieren, damit diese ihre Nummer behalten
    for (const rec of db[coll]) if (!local.has(rec.id)) seen.set(rec.nr, rec.id);
    for (const rec of db[coll]) {
      if (!local.has(rec.id)) continue;
      if (seen.has(rec.nr)) {
        const old = rec.nr;
        rec.nr = ++max;
        ctx.renumbered.push({ coll, id: rec.id, from: old, to: rec.nr });
      }
      seen.set(rec.nr, rec.id);
    }
    db.meta.lastNr = { ...(db.meta.lastNr || {}), [coll]: Math.max(max, db.meta.lastNr?.[coll] ?? 0) };
  }
}

/**
 * @returns {{ db: object, conflicts: Array, renumbered: Array }}
 */
export function mergeDb(base, local, remote) {
  base = base || {};
  const ctx = { conflicts: [], renumbered: [], addedLocal: [] };
  const out = { ...clone(remote), schema: Math.max(local.schema || 1, remote.schema || 1) };
  for (const coll of COLLECTIONS) out[coll] = mergeCollection(coll, base[coll], local[coll], remote[coll], ctx);
  out.lists = mergeLists(base.lists, local.lists, remote.lists, ctx);
  out.settings = mergeSettings(base.settings, local.settings, remote.settings, ctx);
  // Zähler: jeweils das Maximum
  const lastNr = {};
  for (const k of COUNTED) {
    lastNr[k] = Math.max(base.meta?.lastNr?.[k] ?? 0, local.meta?.lastNr?.[k] ?? 0, remote.meta?.lastNr?.[k] ?? 0);
  }
  out.meta = { ...(remote.meta || {}), ...(local.meta || {}), lastNr };
  fixNumbers(out, ctx);
  fixBillingNumbers(out, ctx);
  return { db: out, conflicts: ctx.conflicts, renumbered: ctx.renumbered };
}
