// Darstellung (Branding) je Team: Logo, Farbe der Seitenleiste, Name in der Seitenleiste und im Titel des Browser-Tabs, Symbol (Favicon), Anmeldeseite.
//
// Der Superadmin sieht für sich selbst IMMER «KGC CRM» (Wortmarke, Marineblau, kein Untertitel) – auch im betretenen Team. Was er für ein Team
// einstellt, sehen nur dessen Mitglieder (Einstellungen → Darstellung; Server: GET /api/branding).
// Ein Team ohne eigene Einstellungen: KGC-CRM-Logo, Marineblau, Teamname. Das Team «SwissTech Precision Solutions» hat die bisherigen
// SwissTech-Logos als Anfangsdarstellung (preset «stps»: symbol/side/icon).
//
// Die Farbe ersetzt das Marineblau der Seitenleiste (und des Anmeldehintergrunds); Textfarben werden nach WCAG-Kontrast (mind. 4,5 : 1) gewählt.
//
// Anmeldeseite und Ladeanzeige kennen den Benutzer noch nicht: Sie zeigen die Darstellung des zuletzt angemeldeten Teams auf diesem Gerät
// (localStorage «stps-crm:branding»; bleibt beim Abmelden erhalten – dasselbe Gerät gehört meist derselben Firma). Der Superadmin speichert den Standard.
import { LS, DEFAULT_BRAND, LOGIN_BRAND } from "./config.js";
import * as api from "./api.js";

export const MAX_LOGO_BYTES = 300 * 1024;
/** Dateiendung → Medientyp der erlaubten Logos */
export const LOGO_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp" };
/** So lang darf die Data-URL im Zwischenspeicher höchstens sein (300 KB Datei = Base64 · 4/3) */
const CACHE_MAX_CHARS = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 64;
/** «Quadratisch genug» für das Symbol im Browser-Tab: Seitenverhältnis Breite/Höhe */
const SQUARE_MIN = 0.8;
const SQUARE_MAX = 1.25;

const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------ Bilder: nur Data-URLs von Bildern oder statische Dateien dieser Site

const DATA_SRC = /^data:image\/(?:png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const FILE_SRC = /^[A-Za-z0-9][\w.-]*\.(?:svg|png)$/;
export const safeSrc = (s) => typeof s === "string" && s.length > 0 && (FILE_SRC.test(s) || (s.length <= CACHE_MAX_CHARS && DATA_SRC.test(s)));

export const squareish = (w, h) => {
  const r = Number(w) / Number(h);
  return Number.isFinite(r) && r >= SQUARE_MIN && r <= SQUARE_MAX;
};

/** Medientyp einer gewählten Datei (Typ oder Endung); "" = nicht erlaubt */
export function logoMime(file) {
  const byType = Object.values(LOGO_TYPES).includes(file?.type) ? file.type : "";
  return byType || LOGO_TYPES[String(file?.name ?? "").split(".").pop().toLowerCase()] || "";
}

// ------------------------------------------------------------ Farbe: Eingabe prüfen, lesbare Textfarben nach WCAG-Kontrast

const HEX6 = /^#[0-9a-f]{6}$/i;
/** Gespeicherte Farbe: genau «#rrggbb», sonst null (nie ungeprüfte Werte in Stile übernehmen) */
export const safeColor = (s) => (typeof s === "string" && HEX6.test(s) ? s.toLowerCase() : null);
/** Eingabe («#abc», «0B2340», «#0B2340») → «#rrggbb», sonst null */
export function parseColor(s) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
/** Anteil t der Farbe b in a */
const mix = (a, b, t) => { const y = rgb(b); return toHex(rgb(a).map((v, i) => v + (y[i] - v) * t)); };
/** Relative Leuchtdichte (WCAG 2.x) */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Kontrastverhältnis zweier Farben (1 … 21) */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Mindestkontrast für normalen Text (WCAG AA) */
export const AA = 4.5;
const WHITE = "#ffffff", DARK = "#0b1220", BLACK = "#000000";
/** Lesbare Textfarbe auf bg: Weiss oder Dunkel (das mit dem höheren Kontrast); reicht keine von beiden für AA, Schwarz bzw. Weiss */
export function textOn(bg) {
  let best = contrast(WHITE, bg) >= contrast(DARK, bg) ? WHITE : DARK;
  if (contrast(best, bg) < AA) best = contrast(BLACK, bg) > contrast(WHITE, bg) ? BLACK : WHITE;
  return best;
}
/** Zurückhaltendere Variante der Textfarbe (zu bg hin gemischt), aber nie unter AA */
function soften(fg, bg, t) {
  while (t > 0 && contrast(mix(fg, bg, t), bg) < AA) t = Math.round((t - 0.05) * 100) / 100;
  return mix(fg, bg, Math.max(t, 0));
}

/**
 * Farben der Seitenleiste (und des Anmeldehintergrunds) für die Markenfarbe; null = Standard (Marineblau, Werte aus app.css).
 * light: der Hintergrund ist hell (Text dunkel); ratio: Kontrast des Haupttexts; ink: Farbe für Schrift auf Weiss (mobile Kopfzeile).
 */
export function theme(color) {
  const bg = safeColor(color);
  if (!bg) return null;
  const fg = textOn(bg);
  const [r, g, b] = rgb(fg);
  return {
    bg, fg, light: luminance(fg) < 0.5, ratio: contrast(fg, bg),
    bg2: mix(bg, fg, 0.18), text: soften(fg, bg, 0.15), muted: soften(fg, bg, 0.35), faint: soften(fg, bg, 0.42),
    hover: `rgba(${r}, ${g}, ${b}, .09)`, active: `rgba(${r}, ${g}, ${b}, .16)`, accent: fg,
    ink: contrast(bg, WHITE) >= AA ? bg : DEFAULT_BRAND.color,
  };
}
/** CSS-Variable → Feld von theme() */
const THEME_VARS = { "--side-bg": "bg", "--side-bg-2": "bg2", "--side-strong": "fg", "--side-text": "text", "--side-muted": "muted", "--side-faint": "faint", "--side-hover": "hover", "--side-active": "active", "--side-accent": "accent", "--brand-ink": "ink" };
/** Die Standardwerte aus app.css (:root) – für Vorschau-Felder, die unabhängig von der Farbe der Seite den Standard zeigen sollen */
export const DEFAULT_THEME = Object.freeze({ bg: DEFAULT_BRAND.color, bg2: "#1d4278", fg: "#ffffff", text: "#cfd9e8", muted: "#9fb2cc", faint: "#7f95b4", hover: "rgba(255, 255, 255, .07)", active: "rgba(255, 255, 255, .13)", accent: "#5b9bff", ink: DEFAULT_BRAND.color });
/** Farben auf ein Element (Seite oder Vorschau) setzen; th = null: Standard. Über das CSSOM, damit die strenge CSP (kein Inline-Style) nicht greift. */
export function applyTheme(el, th) {
  for (const [name, key] of Object.entries(THEME_VARS)) {
    if (th) el.style.setProperty(name, th[key]); else el.style.removeProperty(name);
  }
}

// ------------------------------------------------------------ Akzent aus der Markenfarbe (Phase-1-Redesign)

/** CSS-Variablen des Akzents (--accent …); werden bei ungeeigneter Farbe entfernt, dann gilt das Standardblau aus app.css. */
const ACCENT_VARS = ["--accent", "--accent-600", "--accent-50", "--accent-ring", "--on-accent"];
/**
 * Akzentfarben aus einer Markenfarbe, oder null wenn ungeeignet (Kontrast zu Weiss < 4,5 : 1). Kontrastschutz: die Markenfarbe
 * kommt nur auf primäre Schaltfläche, Links, Fokusring und aktive Markierungen – und nur, wenn sie dort lesbar wäre.
 * @returns {{"--accent":string,"--accent-600":string,"--accent-50":string,"--accent-ring":string,"--on-accent":string}|null}
 */
export function accentVars(color) {
  const c = safeColor(color);
  if (!c || contrast(c, WHITE) < AA) return null;
  const [r, g, b] = rgb(c);
  return {
    "--accent": c,
    "--accent-600": mix(c, BLACK, 0.15),
    "--accent-50": mix(c, WHITE, 0.92),
    "--accent-ring": `rgba(${r}, ${g}, ${b}, .35)`,
    "--on-accent": "#ffffff",
  };
}

/** Akzent auf ein Element setzen (oder entfernen). color = null / ungeeignet: Standardblau aus app.css gilt wieder. */
export function applyAccent(el, color) {
  const vars = accentVars(color);
  for (const name of ACCENT_VARS) {
    if (vars) el.style.setProperty(name, vars[name]); else el.style.removeProperty(name);
  }
}

// ------------------------------------------------------------ Darstellung auflösen

/**
 * Was angezeigt wird, aus Team ({id, name}|null) und der Antwort des Servers (branding: {logo, color, displayName, symbol?, side?, icon?, width, height}|null).
 * Ohne Team (Plattform, Superadmin, neues Gerät) immer der Standard «KGC CRM».
 * @returns {{teamId:string|null, isDefault:boolean, name:string, sub:string, full:string, symbol:string, side:string, tile:boolean, icon:string, color:string|null, theme:object|null}}
 *   isDefault: kein Team (KGC CRM) · tile: Logo steht in der Seitenleiste auf einer hellen Kachel (eigene Logos sind meist für helle Hintergründe gemacht)
 */
export function resolve(team, b) {
  const d = DEFAULT_BRAND;
  if (!team) return { teamId: null, isDefault: true, name: d.name, sub: "", full: d.full, symbol: d.symbol, side: d.side, tile: false, icon: d.icon, color: null, theme: null };
  const logo = b && safeSrc(b.logo) ? b.logo : null;
  const displayName = b && typeof b.displayName === "string" ? b.displayName.trim() : "";
  const color = b ? safeColor(b.color) : null;
  const th = theme(color);
  const own = (key) => (safeSrc(b?.[key]) ? b[key] : null);
  // Seitenleiste: auf dunkler Farbe das weisse Symbol, auf heller Farbe das Symbol für helle Hintergründe
  const sideOwn = logo ? (th?.light ? own("symbol") : own("side")) : null;
  return {
    teamId: team.id,
    isDefault: false,
    name: displayName || team.name || d.name,
    sub: displayName && team.name && displayName !== team.name ? team.name : "",
    full: logo || d.full,
    symbol: logo ? own("symbol") || logo : d.symbol,
    side: logo ? sideOwn || logo : th?.light ? d.symbol : d.side,
    tile: Boolean(logo) && !sideOwn,
    icon: logo ? own("icon") || (squareish(b.width, b.height) ? logo : d.icon) : d.icon,
    color,
    theme: th,
  };
}

// ------------------------------------------------------------ Zwischenspeicher (localStorage, alles in try/catch)

/** @returns {{teamId:string|null, name:string, team:{id:string,name:string}|null, branding:object|null}|null} */
export function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS.branding) || "null");
    if (!c || typeof c !== "object") return null;
    const team = c.team && typeof c.team.id === "string" && typeof c.team.name === "string" ? { id: c.team.id, name: c.team.name } : null;
    return { teamId: team?.id ?? null, name: typeof c.name === "string" ? c.name : DEFAULT_BRAND.name, team, branding: c.branding && typeof c.branding === "object" ? c.branding : null };
  } catch { return null; }
}

/** Darstellung des Teams für die Anmeldeseite merken. team = null: Standard (Superadmin, Plattform). */
export function writeCache(team, b) {
  try {
    const keep = b && (!b.logo || b.logo.length <= CACHE_MAX_CHARS) ? b : b ? { logo: null, displayName: b.displayName ?? null } : null;
    const view = resolve(team, keep);
    localStorage.setItem(LS.branding, JSON.stringify({ teamId: team?.id ?? null, name: view.name, team: team ? { id: team.id, name: team.name } : null, branding: keep }));
  } catch { /* privater Modus, Speicher voll: dann gilt beim nächsten Mal der Standard */ }
}

// ------------------------------------------------------------ Zustand

let current = resolve(null, null);
let pageLabel = "";
let pageBare = false;
const listeners = new Set();
export const get = () => current;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function use(brand) {
  current = brand;
  applyDom();
  for (const fn of [...listeners]) { try { fn(brand); } catch (e) { console.error(e); } }
}

/** Darstellung der Anmeldeseite: die des zuletzt angemeldeten Teams, sonst (Standard) das SwissTech-Logo statt «KGC CRM» */
export function loginView() {
  const b = current;
  return b.isDefault ? { ...b, name: LOGIN_BRAND.name, full: LOGIN_BRAND.full, icon: LOGIN_BRAND.icon } : b;
}

/** Titel und Symbol des Tabs für die Anmeldeseite (nur wenn sie vom Standard abweicht); applyDom() stellt sie wieder her */
export function applyLoginChrome(v) {
  if (v === current) return;
  document.title = v.name;
  setIcon(v.icon);
}

/** Beim Start: Darstellung des zuletzt angemeldeten Teams (Ladeanzeige, Anmeldeseite); ohne Zwischenspeicher der Standard */
export function init() {
  const c = readCache();
  use(c ? resolve(c.team, c.branding) : resolve(null, null));
}

/**
 * Nach der Anmeldung: Darstellung des Teams vom Server holen. team: store.getTeam() (null = Plattform).
 * Der Superadmin sieht und speichert immer den Standard «KGC CRM» (auch wenn er ein Team betritt, ohne Abruf); alle anderen ihr Team.
 * Ist der Server nicht erreichbar, bleibt die gespeicherte Darstellung desselben Teams.
 */
export async function load({ team, isSuper }) {
  if (!team || isSuper) { writeCache(null, null); use(resolve(null, null)); return; }
  let r;
  try {
    r = await api.branding(undefined, { timeout: 8000 });
  } catch {
    const c = readCache();
    use(c && c.teamId === team.id ? resolve(team, c.branding) : resolve(team, null));
    return;
  }
  setActive(team, r.branding ?? null, { isSuper });
}

/** Darstellung des eigenen Teams übernehmen (wenn sie in den Einstellungen geändert wurde). Der Superadmin behält «KGC CRM». */
export function setActive(team, b, { isSuper = false } = {}) {
  if (isSuper) { writeCache(null, null); use(resolve(null, null)); return; }
  writeCache(team, b);
  use(resolve(team, b));
}

// ------------------------------------------------------------ Anzeige

/** Lässt sich ein Logo nicht laden (beschädigt), zeigt das Bild stattdessen das Standard-Symbol (onFallback: Anpassungen dafür) */
export function withFallback(img, fallback, onFallback) {
  img.addEventListener("error", () => {
    if (img.src.endsWith(fallback)) return;
    img.src = fallback;
    onFallback?.();
  }, { once: true });
}

/** Titel der Registerkarte: «<Seite> · <Name>»; bare: nur die Seite (Belege: Vorschlag für den PDF-Dateinamen, ohne Oberflächen-Marke) */
export function setTitle(label = "", bare = false) {
  pageLabel = label;
  pageBare = Boolean(bare && label);
  document.title = pageBare ? pageLabel : pageLabel ? `${pageLabel} · ${current.name}` : current.name;
}

function setIcon(href) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
  link.type = /^data:(image\/[a-z+]+);/.exec(href)?.[1] || (href.endsWith(".png") ? "image/png" : "image/svg+xml");
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

function setMark(img, src, tile) {
  if (!img) return;
  const mark = img.closest(".brand-mark");
  if (img.getAttribute("src") !== src) { img.setAttribute("src", src); withFallback(img, DEFAULT_BRAND.side, () => mark?.classList.remove("tile")); }
  mark?.classList.toggle("tile", tile);
}

/** Farben, Ladeanzeige, Seitenleiste, Kopfzeile (schmale Ansicht), Titel und Symbol der Registerkarte */
export function applyDom() {
  const b = current;
  applyTheme(document.documentElement, b.theme);
  applyAccent(document.documentElement, b.color); // Akzent folgt der Teamfarbe, wenn der Kontrast reicht
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", b.theme?.bg ?? DEFAULT_BRAND.color);
  const boot = $("#boot-logo");
  if (boot) {
    if (boot.getAttribute("src") !== b.symbol) { boot.setAttribute("src", b.symbol); withFallback(boot, DEFAULT_BRAND.symbol); }
    boot.hidden = false;
  }
  setMark($("#brand-logo"), b.side, b.tile);
  const name = $("#brand-name");
  if (name) name.textContent = b.name;
  const sub = $("#brand-sub");
  if (sub) { sub.textContent = b.sub; sub.hidden = !b.sub; }
  const top = $(".topbar-brand");
  if (top) top.textContent = b.name;
  setIcon(b.icon);
  setTitle(pageLabel, pageBare);
}
