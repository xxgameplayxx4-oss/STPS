// STPS CRM – Benachrichtigungen für Team-Chat und Kalender-Erinnerungen: Web Push (VAPID) und E-Mail-Ersatz (Resend).
// Gemeinsamer Versandweg: deliver() (Chat: notifyTeam; Kalender: calendar.mjs runReminders).
//
// Umgebungsvariablen (alle optional; fehlt etwas, verschwindet die Funktion in der Oberfläche, nichts bricht):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… oder https://…)   Web Push   (Schlüssel: npx web-push generate-vapid-keys)
//   RESEND_API_KEY, MAIL_FROM (z. B. «CRM <crm@ihre-domain.ch>»)                    E-Mail für Mitglieder OHNE Push-Abo, höchstens eine Mail je Person und MAIL_THROTTLE_MS
//   APP_URL (optional; sonst die von Netlify gesetzte URL)                          Link in der E-Mail
//
// Speicherung im Namensraum des Teams:  push/<uid> = { subs: [{ endpoint, p256dh, auth, at }] }  (höchstens MAX_SUBS je Benutzer)
// Abos, die der Push-Dienst mit 404/410 ablehnt, werden sofort entfernt. Der Push-Endpunkt muss von einem bekannten Push-Dienst stammen
// (Schutz davor, dass der Server beliebige Adressen aufruft).
import { mutateDoc } from "./kv.mjs";
import { json, fail, parseBody, logError } from "./http.mjs";
import * as U from "./users.mjs";

export const MAX_SUBS = 5;
export const MAIL_THROTTLE_MS = 30 * 60 * 1000;
const SEND_DEADLINE_MS = 8000;
const PUSH_TTL_S = 60 * 60;
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
/** Hostnamen der Push-Dienste: Chrome/Android (FCM), Firefox, Edge/Windows (WNS), Safari/Apple */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|mozilla\.com|notify\.windows\.com|windows\.com|push\.apple\.com|apple\.com)$/i;

const UID_RE = /^u_[0-9a-f]{16}$/;
const pushKey = (uid) => {
  if (!UID_RE.test(uid)) throw new Error("Ungültige Benutzer-ID");
  return `push/${uid}`;
};
/** Chat-Dokument eines Benutzers im Namensraum des Teams (gelesen, letzte Mail, Sendezeiten; siehe chat.mjs) */
export const chatUserKey = (uid, channel = "team") => {
  if (!UID_RE.test(uid)) throw new Error("Ungültige Benutzer-ID");
  return `${channel === "mgmt" ? "chatm" : "chat"}/u-${uid}`; // muss zu chat.mjs keys() passen
};

// ---------------------------------------------------------------- Konfiguration

/** VAPID-Einstellungen oder null (nicht oder unvollständig gesetzt) */
export function vapidConfig(env) {
  const publicKey = String(env?.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = String(env?.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = String(env?.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!B64U.test(publicKey) || !B64U.test(privateKey) || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/i.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** E-Mail-Ersatz (Resend) oder null */
export function mailConfig(env) {
  const apiKey = String(env?.RESEND_API_KEY ?? "").trim();
  const from = String(env?.MAIL_FROM ?? "").trim();
  return apiKey && from && !/[\r\n]/.test(from) ? { apiKey, from } : null;
}

async function loadWebPush(deps) {
  if (deps.webpush) return deps.webpush;
  const m = await import("web-push"); // erst bei Bedarf laden (externes Paket, siehe netlify.toml)
  return m.default ?? m;
}

// ---------------------------------------------------------------- Abos

/** Abo vom Browser (PushSubscription.toJSON()) prüfen: https, bekannter Push-Dienst, plausible Schlüssel */
export function cleanSubscription(v) {
  const s = v && typeof v === "object" ? v : {};
  const endpoint = typeof s.endpoint === "string" ? s.endpoint.trim() : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port || endpoint.length > 700 || !PUSH_HOSTS.test(url.hostname)) {
    throw fail(400, "bad_subscription", "Ungültiges Push-Abonnement");
  }
  if (!B64U.test(p256dh) || p256dh.length > 200 || !B64U.test(auth) || auth.length > 64) throw fail(400, "bad_subscription", "Ungültiges Push-Abonnement");
  return { endpoint, p256dh, auth };
}

const subsOf = (doc) => (Array.isArray(doc?.subs) ? doc.subs.filter((s) => s && typeof s.endpoint === "string") : []);

async function readSubs(store, uid) {
  return subsOf((await store.read(pushKey(uid)))?.value);
}

async function removeEndpoint(store, uid, endpoint) {
  await mutateDoc(store, pushKey(uid), (doc) => {
    const subs = subsOf(doc);
    return subs.some((s) => s.endpoint === endpoint) ? { subs: subs.filter((s) => s.endpoint !== endpoint) } : undefined;
  });
}

/** Alle aktiven Mitglieder des Teams (ohne Superadmin) */
export async function teamMembers(deps, ctx) {
  const users = await U.loadUsers(deps.rootStore, { now: deps.now, cacheMs: 5000 });
  return users.filter((u) => u.teamId === ctx.teamId && u.active !== false && u.role !== "superadmin");
}

// ---------------------------------------------------------------- Routen /api/push/*

export async function routes(path, method, req, deps, ctx) {
  const { store, env } = deps;
  const wrongMethod = () => json(405, { error: "method_not_allowed", message: "Methode nicht erlaubt" });
  const cfg = vapidConfig(env);
  // Push gibt es nur für Team-Mitglieder (der Superadmin ist keines) und nur, wenn VAPID eingerichtet ist
  const member = !ctx.isSuper;

  if (path === "/push/config") {
    if (method !== "GET") return wrongMethod();
    return json(200, { enabled: Boolean(cfg && member), publicKey: cfg && member ? cfg.publicKey : "", mail: Boolean(mailConfig(env)) });
  }
  if (!cfg || !member) return json(404, { error: "push_disabled", message: "Push-Benachrichtigungen sind nicht eingerichtet" });

  if (path === "/push/subscribe") {
    if (method !== "POST") return wrongMethod();
    const sub = cleanSubscription(parseBody(req, 4096).subscription);
    // Ein Gerät gehört genau einer Person: das Abo einer anderen Person desselben Teams mit gleichem Endpunkt entfernen
    for (const m of await teamMembers(deps, ctx)) if (m.id !== ctx.user.id) await removeEndpoint(store, m.id, sub.endpoint);
    await mutateDoc(store, pushKey(ctx.user.id), (doc) => {
      const rest = subsOf(doc).filter((s) => s.endpoint !== sub.endpoint);
      return { subs: [...rest, { ...sub, at: new Date(deps.now).toISOString() }].slice(-MAX_SUBS) };
    });
    return json(200, { ok: true });
  }
  if (path === "/push/unsubscribe") {
    if (method !== "POST") return wrongMethod();
    const endpoint = String(parseBody(req, 4096).endpoint ?? "").slice(0, 700);
    if (endpoint) await removeEndpoint(store, ctx.user.id, endpoint);
    return json(200, { ok: true });
  }
  return json(404, { error: "not_found", message: "Nicht gefunden" });
}

// ---------------------------------------------------------------- Versand

export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export const oneLine = (s) => s.replace(/\s+/g, " ").trim();

/** Wartet auf alle, höchstens SEND_DEADLINE_MS (die Function wird nach der Antwort eingefroren) */
export async function settleWithin(promises, ms = SEND_DEADLINE_MS) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  try { await Promise.race([Promise.allSettled(promises), deadline]); } finally { clearTimeout(timer); }
}

async function sendPush(deps, wp, cfg, uid, sub, payload) {
  try {
    await wp.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, TTL: PUSH_TTL_S, urgency: "normal", timeout: 6000 },
    );
    return true;
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) await removeEndpoint(deps.store, uid, sub.endpoint).catch(() => {});
    else logError("Web-Push senden", err, { status: err?.statusCode });
    return false;
  }
}

/** Link in die App (Standard: Chat); path = Teil nach «#/», z. B. «kalender/ev_…». Leer, wenn keine Adresse bekannt ist. */
export function appLink(env, path = "chat") {
  const base = String(env?.APP_URL || env?.URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s]+$/.test(base) ? `${base}/#/${path}` : "";
}

/** Eine E-Mail über Resend (reiner Text). Wirft bei Fehler. */
export async function sendMail(deps, cfg, { to, subject, text }) {
  const f = deps.fetch ?? fetch;
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [to], subject, text }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

/** Höchstens eine Mail je Person und MAIL_THROTTLE_MS: true = dieser Aufruf darf senden (und hat den Zeitpunkt vermerkt) */
async function claimMail(store, uid, now, chatUserKey) {
  let ok = false;
  let prev = 0;
  await mutateDoc(store, chatUserKey, (doc) => {
    ok = false;
    prev = Number.isFinite(doc?.mailedAt) ? doc.mailedAt : 0;
    if (now - prev < MAIL_THROTTLE_MS) return undefined;
    ok = true;
    return { ...(doc || {}), mailedAt: now };
  });
  return ok ? prev : null;
}

/**
 * Gemeinsamer Versandweg (Chat, Kalender-Erinnerungen): Push an alle Geräte jeder Person; wer kein Push-Abo hat – oder bei wem
 * keine Zustellung gelingt – und eine E-Mail-Adresse, bekommt (wenn Resend eingerichtet ist) eine Mail.
 * @param members Empfänger (aktive Mitglieder des Teams: {id, email, …}); deps.store = Namensraum des Teams (Push-Abos)
 * @param o { payload: Objekt für den Service Worker (t, title, body, url, tag, id),
 *            mail: {subject, text},
 *            claimMail?: async (m) => Vermerk | null   null = diese Person nicht anschreiben (Tempolimit); ohne: immer senden,
 *            releaseMail?: async (m, vermerk) => void   macht den Vermerk rückgängig, wenn der Versand scheitert,
 *            deadlineMs? }
 * @returns {Promise<{tried:number, push:number, mail:number}>} tried: Personen, bei denen ein Weg versucht wurde; push/mail: Personen mit gelungener Zustellung
 */
export async function deliver(deps, members, o) {
  const { env, store } = deps;
  const cfg = vapidConfig(env);
  const mail = mailConfig(env);
  const res = { tried: 0, push: 0, mail: 0 };
  if ((!cfg && !mail) || !members.length) return res;
  const wp = cfg ? await loadWebPush(deps) : null;
  const body = JSON.stringify(o.payload);

  const jobs = members.map(async (m) => {
    const subs = cfg ? await readSubs(store, m.id) : [];
    if (subs.length) {
      res.tried++;
      const oks = await Promise.all(subs.map((s) => sendPush(deps, wp, cfg, m.id, s, body)));
      if (oks.some(Boolean)) { res.push++; return; }
    }
    // Kein Push-Abo (oder keine Zustellung gelungen): E-Mail-Ersatz
    if (!mail || !m.email) return;
    const prev = o.claimMail ? await o.claimMail(m) : undefined;
    if (prev === null) return;
    if (!subs.length) res.tried++;
    try {
      await sendMail(deps, mail, { to: m.email, subject: o.mail.subject, text: o.mail.text });
      res.mail++;
    } catch (err) {
      logError("Benachrichtigungs-E-Mail senden", err);
      await o.releaseMail?.(m, prev).catch(() => {}); // nicht als gesendet vermerkt
    }
  });
  await settleWithin(jobs, o.deadlineMs);
  return res;
}

/**
 * Neue Chat-Nachricht an alle anderen Mitglieder des Teams: Push an alle ihre Geräte; wer kein Push-Abo hat und eine E-Mail-Adresse,
 * bekommt (wenn Resend eingerichtet ist und die letzte Mail länger als MAIL_THROTTLE_MS her ist) eine Mail.
 * @param msg öffentliche Nachricht {id, uid, name, text, …}
 */
export async function notifyTeam(deps, ctx, msg, { channel = "team", only = null } = {}) {
  const { env, store } = deps;
  if (!vapidConfig(env) && !mailConfig(env)) return;
  const members = (await teamMembers(deps, ctx)).filter((m) => m.id !== msg.uid && (!only || only(m))); // only: z. B. Kanal «Geschäftsleitung» nur an Berechtigte
  if (!members.length) return;
  const link = appLink(env);
  await deliver(deps, members, {
    payload: { t: "chat", title: oneLine(msg.name), body: clip(oneLine(msg.text), 140), url: "/#/chat", tag: channel === "mgmt" ? "chat-mgmt" : "chat", id: msg.id },
    mail: {
      subject: `Neue Chat-Nachricht von ${oneLine(msg.name)} / New chat message`,
      text: `${oneLine(msg.name)}:\n${clip(msg.text, 400)}\n\n${link ? `Öffnen / Open: ${link}\n\n` : ""}Sie erhalten höchstens eine solche E-Mail pro halbe Stunde. / At most one such email per 30 minutes.`,
    },
    claimMail: (m) => claimMail(store, m.id, deps.now, chatUserKey(m.id, channel)),
    releaseMail: (m, prev) => mutateDoc(store, chatUserKey(m.id, channel), (doc) => (doc?.mailedAt === deps.now ? { ...doc, mailedAt: prev } : undefined)),
  });
}
