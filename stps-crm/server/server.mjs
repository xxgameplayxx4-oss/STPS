// STPS CRM – eigenständiger Node-Server (Infomaniak-VPS): statische Dateien + Netlify-Functions + Zeitpläne.
// Bildet netlify.toml nach: /api/* -> api.mjs, gesperrte Pfade -> 404, Sicherheits-Header, geplante Functions per setInterval.
// Start: node server/server.mjs   (PORT, HOST, ENABLE_SCHEDULES=0 zum Abschalten der Zeitpläne)
import http from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIR = path.join(ROOT, "netlify", "functions");
const PORT = Number(process.env.PORT || 8888);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// Wie [[headers]] for="/*" in netlify.toml
const SECURITY = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "strict-transport-security": "max-age=31536000",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

// Wie die 404-Redirects in netlify.toml (plus Server-/Ops-Verzeichnisse und Dotfiles, die es auf Netlify nicht gibt)
const BLOCKED = [/^\/(netlify|scripts|server|ops|node_modules)(\/|$)/, /^\/(package\.json|package-lock\.json|netlify\.toml|README\.md|SHAREPOINT-SETUP\.md|OUTLOOK-SETUP\.md)$/, /(^|\/)\.[^/]/];

const fnCache = new Map();
const loadFn = async (file) => {
  if (!fnCache.has(file)) fnCache.set(file, import(pathToFileURL(path.join(FN_DIR, file)).href));
  return fnCache.get(file);
};

const textResponse = (status, text) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY } });

async function toRequest(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    init.body = Buffer.concat(chunks);
  }
  return new Request(url, init);
}

async function sendResponse(res, r) {
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  for (const [k, v] of Object.entries(SECURITY)) headers[k] ??= v;
  res.writeHead(r.status, headers);
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
}

async function handleApi(req, res) {
  try {
    const mod = await loadFn("api.mjs");
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const r = await mod.default(await toRequest(req), { ip, geo: {}, params: {}, waitUntil() {} });
    await sendResponse(res, r);
  } catch (err) {
    console.error("[stps-crm] API-Fehler:", err);
    await sendResponse(res, new Response(JSON.stringify({ error: "server_error", message: "Interner Fehler" }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }));
  }
}

async function handleStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return sendResponse(res, textResponse(405, "Method Not Allowed"));
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return sendResponse(res, textResponse(400, "Bad Request")); }
  if (rel.includes("\0") || BLOCKED.some((re) => re.test(rel))) return sendResponse(res, textResponse(404, "Not Found"));
  let file = path.join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return sendResponse(res, textResponse(404, "Not Found"));
  let st = await stat(file).catch(() => null);
  if (st?.isDirectory()) { file = path.join(file, "index.html"); st = await stat(file).catch(() => null); }
  if (!st?.isFile()) return sendResponse(res, textResponse(404, "Not Found"));
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const headers = {
    ...SECURITY,
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": st.size,
    "last-modified": st.mtime.toUTCString(),
    "cache-control": base === "sw.js" || base === "manifest.webmanifest" || ext === ".html" ? "no-cache" : "public, max-age=300",
  };
  if (base === "sw.js") headers["service-worker-allowed"] = "/";
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://x").pathname;
    if (pathname === "/healthz") {
      // wie /api/health: «ok» nur, wenn der Speicher antwortet
      const r = await (await loadFn("api.mjs")).default(new Request(`http://${req.headers.host || "localhost"}/api/health`), {}).catch(() => null);
      return sendResponse(res, textResponse(r?.ok ? 200 : 503, r?.ok ? "ok" : "db down"));
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return await handleApi(req, res);
    await handleStatic(req, res, pathname);
  } catch (err) {
    console.error("[stps-crm] Fehler:", err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

// ---- Zeitpläne (Minimal-Cron: 5 Felder, *, Zahlen, Listen, Bereiche, Schrittweiten; UTC wie bei Netlify) ----
function parseField(spec, min, max) {
  const out = new Set();
  for (const part of spec.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepStr ? max : lo) : Number(b);
    }
    if (![lo, hi, step].every(Number.isInteger) || step < 1 || lo < min || hi > max) throw new Error(`Ungültiges Cron-Feld: ${spec}`);
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  return out;
}
export function parseCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`Cron braucht 5 Felder: ${expr}`);
  const [mi, h, dom, mo, dow] = [parseField(f[0], 0, 59), parseField(f[1], 0, 23), parseField(f[2], 1, 31), parseField(f[3], 1, 12), parseField(f[4], 0, 7)];
  if (dow.has(7)) dow.add(0);
  const domStar = f[2] === "*", dowStar = f[4] === "*";
  return (d) => {
    if (!mi.has(d.getUTCMinutes()) || !h.has(d.getUTCHours()) || !mo.has(d.getUTCMonth() + 1)) return false;
    const a = dom.has(d.getUTCDate()), b = dow.has(d.getUTCDay());
    return domStar || dowStar ? a && b : a || b; // Standard-Cron: beide eingeschränkt -> ODER
  };
}

async function startSchedules() {
  const jobs = [];
  for (const file of (await readdir(FN_DIR)).filter((f) => f.endsWith(".mjs")).sort()) {
    const mod = await loadFn(file).catch((e) => { console.error(`[stps-crm] ${file} nicht ladbar:`, e.message); return null; });
    const schedule = mod?.config?.schedule;
    if (typeof schedule !== "string") continue;
    jobs.push({ name: file, match: parseCron(schedule), run: mod.default, schedule, running: false });
  }
  const tick = () => {
    const now = new Date();
    for (const j of jobs) {
      if (!j.match(now) || j.running) continue;
      j.running = true;
      Promise.resolve().then(() => j.run(new Request("http://localhost/__scheduled"), {})).catch((e) => console.error(`[stps-crm] Zeitplan ${j.name}:`, e)).finally(() => { j.running = false; });
    }
  };
  // Auf die nächste volle Minute ausrichten, dann jede Minute prüfen
  setTimeout(() => { tick(); setInterval(tick, 60_000).unref?.(); }, 60_000 - (Date.now() % 60_000)).unref?.();
  console.log(`[stps-crm] Zeitpläne: ${jobs.map((j) => `${j.name} (${j.schedule})`).join(", ")}`);
  return jobs;
}

server.listen(PORT, HOST, async () => {
  console.log(`[stps-crm] läuft auf http://${HOST}:${PORT}`);
  if (process.env.ENABLE_SCHEDULES !== "0") await startSchedules().catch((e) => console.error("[stps-crm] Zeitpläne nicht gestartet:", e));
});

const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10_000).unref(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
