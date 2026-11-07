// STPS CRM – Ablauf-Hinweise für Lieferanten-Dokumente und Zertifikate (WP-A).
// Einmal täglich (geplante Function cert-alerts.mjs): Für jedes aktive Team werden die nicht archivierten Dokumente der Lieferanten
// (db.suppliers[].dokumente[] mit «gueltigBis») geprüft. Hinweise gehen an Team-Admins und Benutzer mit Management-Kennzeichen –
// je Dokument und Gültigkeitsdatum genau einmal bei 60, 30 und 7 Tagen vor Ablauf und am Ablauftag bzw. danach («expired»).
// Doppelversand ausgeschlossen: Der Versandvermerk «certs/sent» (im Namensraum des Teams) wird VOR dem Versand atomar eingetragen und nur
// zurückgenommen, wenn der Versand an alle scheitert. Ein erneuertes Dokument (neues Datum) löst die Hinweise neu aus.
import { mutateDoc } from "./kv.mjs";
import { DB_KEY, zurichDate } from "./db.mjs";
import { loadTeams, scopedStore } from "./teams.mjs";
import * as U from "./users.mjs";
import * as PUSH from "./push.mjs";
import { canManage } from "./roles.mjs";
import { logError } from "./http.mjs";

export const SENT_KEY = "certs/sent";
/** Tage vor Ablauf, an denen je einmal erinnert wird (0 = am Ablauftag; abgelaufen zählt ebenfalls als Stufe 0) */
export const ALERT_DAYS = [60, 30, 7, 0];

const dayNum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
const fmtDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };

/**
 * Fällige Hinweise: je Dokument höchstens eine Stufe (die niedrigste erreichte; ein neu erfasstes Dokument mit 20 Tagen Restlaufzeit
 * bekommt «30», nicht zusätzlich «60»).
 * @returns {{key:string, level:number, daysLeft:number, supplierId:string, supplier:string, docId:string, name:string, typ:string, gueltigBis:string}[]}
 */
export function dueAlerts(db, today) {
  const t0 = dayNum(today);
  const out = [];
  if (t0 === null) return out;
  for (const s of Array.isArray(db?.suppliers) ? db.suppliers : []) {
    for (const d of Array.isArray(s?.dokumente) ? s.dokumente : []) {
      if (!d || typeof d !== "object" || d.archiviert || typeof d.id !== "string" || !d.id) continue;
      const v = dayNum(d.gueltigBis);
      if (v === null) continue;
      const daysLeft = v - t0;
      const level = [...ALERT_DAYS].reverse().find((n) => daysLeft <= n); // 0, 7, 30, 60
      if (level === undefined) continue;
      out.push({ key: `${d.id}|${d.gueltigBis}|${level}`, level, daysLeft, supplierId: s.id, supplier: String(s.firma || ""), docId: d.id, name: String(d.name || d.typ || ""), typ: String(d.typ || ""), gueltigBis: d.gueltigBis });
    }
  }
  return out;
}

/** Schlüssel «<Dokument>|<Datum>» aller aktuellen (nicht archivierten) Dokumente – alles andere im Versandvermerk ist veraltet */
function liveKeys(db) {
  const set = new Set();
  for (const s of Array.isArray(db?.suppliers) ? db.suppliers : [])
    for (const d of Array.isArray(s?.dokumente) ? s.dokumente : []) if (d && !d.archiviert && d.id && d.gueltigBis) set.add(`${d.id}|${d.gueltigBis}`);
  return set;
}

/** Trägt die Schlüssel atomar ein; gibt die Schlüssel zurück, die DIESER Aufruf eingetragen hat (die anderen waren schon vermerkt). Veraltete Vermerke werden entfernt. */
export async function claimAlerts(store, keys, live, now) {
  const mine = new Set();
  await mutateDoc(store, SENT_KEY, (doc) => {
    mine.clear();
    const sent = {};
    for (const [k, at] of Object.entries(doc?.sent && typeof doc.sent === "object" ? doc.sent : {})) if (live.has(k.split("|").slice(0, 2).join("|"))) sent[k] = at;
    for (const k of keys) if (!(k in sent)) { sent[k] = now; mine.add(k); }
    const same = JSON.stringify(sent) === JSON.stringify(doc?.sent ?? {});
    return same ? undefined : { sent };
  });
  return mine;
}

export async function releaseAlerts(store, keys, now) {
  await mutateDoc(store, SENT_KEY, (doc) => {
    const sent = { ...(doc?.sent || {}) };
    let changed = false;
    for (const k of keys) if (sent[k] === now) { delete sent[k]; changed = true; }
    return changed ? { sent } : undefined;
  });
}

const levelDe = (a) => (a.daysLeft < 0 ? `abgelaufen am ${fmtDay(a.gueltigBis)}` : a.daysLeft === 0 ? "läuft heute ab" : `läuft in ${a.daysLeft} Tagen ab (${fmtDay(a.gueltigBis)})`);
const levelEn = (a) => (a.daysLeft < 0 ? `expired on ${fmtDay(a.gueltigBis)}` : a.daysLeft === 0 ? "expires today" : `expires in ${a.daysLeft} days (${fmtDay(a.gueltigBis)})`);
const line = (a) => `- ${PUSH.oneLine(a.supplier)}: ${PUSH.oneLine(a.name)} – ${levelDe(a)} / ${levelEn(a)}`;

/** Empfänger: aktive Team-Admins und Benutzer mit Management-Kennzeichen des Teams (nie der Superadmin) */
export const recipients = (users, teamId) => users.filter((u) => u.teamId === teamId && u.active !== false && u.role !== "superadmin" && canManage(u));

/**
 * Einmal täglich für alle aktiven Teams ausführen.
 * @param deps { env, store (Wurzel-Store), now?: () => number, fetch?, webpush? }
 * @returns {Promise<{teams:number, due:number, sent:number}>}
 */
export async function runCertAlerts(deps) {
  const res = { teams: 0, due: 0, sent: 0 };
  const { env } = deps;
  if (!PUSH.vapidConfig(env) && !PUSH.mailConfig(env)) return res; // kein Versandweg eingerichtet: nichts zu tun, nichts vermerkt
  const now = deps.now ? deps.now() : Date.now();
  const root = deps.store;
  const today = zurichDate(new Date(now));
  const teams = (await loadTeams(root, { now, cacheMs: 0 })).filter((t) => t.active !== false);
  if (!teams.length) return res;
  const users = await U.loadUsers(root, { now, cacheMs: 0 });
  for (const team of teams) {
    try {
      const store = scopedStore(root, team.id);
      const db = (await store.read(DB_KEY))?.value?.data;
      const due = dueAlerts(db, today);
      const sentDoc = (await store.read(SENT_KEY))?.value?.sent || {};
      const fresh = due.filter((a) => !(a.key in sentDoc));
      if (!fresh.length) { // nur aufräumen, wenn Vermerke veraltet sind
        if (Object.keys(sentDoc).length) await claimAlerts(store, [], liveKeys(db), now);
        continue;
      }
      res.teams++;
      res.due += fresh.length;
      const claimed = await claimAlerts(store, fresh.map((a) => a.key), liveKeys(db), now);
      const items = fresh.filter((a) => claimed.has(a.key)).sort((a, b) => a.daysLeft - b.daysLeft);
      const to = recipients(users, team.id);
      if (!items.length || !to.length) continue;
      const expired = items.filter((a) => a.daysLeft < 0).length;
      const title = expired ? `Zertifikate: ${expired} abgelaufen` : "Zertifikate laufen bald ab";
      const link = PUSH.appLink(env, "uebersicht");
      const r = await PUSH.deliver({ ...deps, env, store, rootStore: root, now }, to, {
        payload: {
          t: "cert", title, body: PUSH.clip(items.slice(0, 3).map((a) => `${PUSH.oneLine(a.supplier)}: ${PUSH.oneLine(a.name)} (${a.daysLeft < 0 ? "abgelaufen" : a.daysLeft === 0 ? "heute" : a.daysLeft + " T."})`).join(" · "), 160),
          url: "/#/uebersicht", tag: "certs", id: "certs",
        },
        mail: {
          subject: `${title} (${items.length}) / Certificates ${expired ? "expired" : "expiring soon"}`,
          text: `${items.map(line).join("\n")}\n\n${link ? `Öffnen / Open: ${link}\n\n` : ""}Ablauf-Hinweis für Lieferanten-Dokumente. / Expiry notice for supplier documents.`,
        },
        deadlineMs: 20000,
      });
      if (r.tried > 0 && r.push + r.mail === 0) await releaseAlerts(store, items.map((a) => a.key), now);
      else res.sent += r.push + r.mail;
    } catch (err) {
      logError("Zertifikats-Hinweise", err, { team: team.id });
    }
  }
  return res;
}
