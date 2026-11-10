// Service Worker des CRM: App-Hülle offline verfügbar machen, Web-Push für Team-Chat und Kalender-Erinnerungen empfangen.
//
// - /api/* wird NIE zwischengespeichert und nicht angefasst (immer direkt ans Netz): Antworten enthalten Teamdaten hinter der Anmeldung
//   und sollen nach dem Abmelden nicht in einem Zwischenspeicher dieses Geräts liegen. Offline hält die App ihren letzten Stand selbst (localStorage).
// - Alles andere (gleiche Herkunft, GET): zuerst Netz, bei Fehler der Zwischenspeicher («network first»), damit neue Versionen sofort greifen.
// - Push: Chat zeigt «<Absender>: <Text>», eine Kalender-Erinnerung «<Titel>» mit Zeit und Ort; ein Klick öffnet die Seite dazu
//   (Chat bzw. den Termin #/kalender/<id>; bestehendes Fenster, sonst ein neues). Ziele sind auf diese Seiten beschränkt (GOTO).
// Version erhöhen, wenn sich das Format des Zwischenspeichers ändert (alte werden beim Aktivieren gelöscht).
const CACHE = "crm-shell-v4";
const SHELL = [
  "./",
  "index.html",
  "app.css", "cmdk.css", "kanban.css", "board.css", "slideover.css", "chat.css", "calendar.css", "docs.css", "shipments.css", "directory.css",
  "js/app.js",
  "fonts/instrument-sans-400.woff2", "fonts/instrument-sans-700.woff2", "fonts/plex-serif-400.woff2", "fonts/plex-mono-400.woff2",
  "favicon.svg", "logo-full.svg", "kgc-favicon.svg", "kgc-logo-full.svg", "kgc-logo-symbol-white.svg",
  "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/") || url.pathname === "/sw.js") return; // direkt ans Netz
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});

// ---------------------------------------------------------------- Push

/** Erlaubte Ziele einer Benachrichtigung (Entsprechung: GOTO_RE in js/push.js) */
const GOTO = /^\/#\/(?:chat|uebersicht|kalender(?:\/ev_[0-9a-f]{12}(?:\?o=[0-9A-Za-z%:.\-]{10,40})?)?)$/;
const safeUrl = (u) => (typeof u === "string" && GOTO.test(u) ? u : "/#/chat");

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const isCal = data.t === "cal" || data.t === "cert"; // Kalender und Zertifikats-Hinweise: kein Chat-Nachladen
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : isCal ? "Kalender" : "Chat";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: typeof data.tag === "string" ? data.tag.slice(0, 60) : isCal ? "cal" : "chat",
        renotify: true,
        data: { url: safeUrl(data.url) },
      }),
      // Offene Fenster sofort nachladen lassen (statt auf den nächsten Takt zu warten) – nur für den Chat
      isCal ? null : self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: "poll" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.location.origin));
      if (win) {
        win.postMessage({ type: "goto", hash: url.slice(1) });
        return win.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
