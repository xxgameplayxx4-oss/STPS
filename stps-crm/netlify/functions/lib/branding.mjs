// STPS CRM – Darstellung je Team: Logo (PNG/JPG/SVG/WebP), Farbe der Seitenleiste und optionaler Anzeigename.
//
// Pro Team liegt ein Dokument «branding» im Namensraum des Teams («t/<teamId>/branding»):
//   { logo: «data:<mime>;base64,…» | null, mime, width, height, color?: «#rrggbb», displayName?, updatedAt, updatedBy }
// Ohne Dokument (oder ohne logo, color und displayName) gilt die Standard-Darstellung des Teams: KGC-CRM-Logo, Standard-Marineblau,
// Teamname (der Browser kennt sie). Der Superadmin sieht für sich selbst immer «KGC CRM»; diese Einstellungen betreffen nur die Teammitglieder.
// Das Team «SwissTech Precision Solutions» (Altdaten-Team bzw. so benannt) erhält einmalig die bisherigen SwissTech-Logodateien als
// Anfangsdarstellung (preset «stps»: Verweise auf die statischen Dateien, die der Browser ohnehin ausliefert).
// «Zurücksetzen» schreibt ein leeres Dokument (kein Löschen), damit der einmalige Anfangswert nicht erneut gesetzt wird.
//
// Das Logo wird geprüft, bevor es gespeichert wird: Dateityp an den Anfangsbytes erkannt (nicht am Namen), höchstens 300 KB,
// SVG nur ohne aktive Inhalte (Skript, on*-Attribute, foreignObject, externe Verweise) – sonst wird es abgelehnt, nie «bereinigt».
import { fail, cleanText } from "./http.mjs";
import { mutateDoc } from "./kv.mjs";

export const BRANDING_KEY = "branding";
export const MAX_LOGO_BYTES = 300 * 1024;
export const MAX_LOGO_PIXELS = 4096;
export const MAX_NAME_LENGTH = 40;
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Obergrenze der Anfrage (Base64 = 4/3 der Datei, dazu der Rest des JSON) */
export const MAX_BODY_BYTES = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 4096;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/** Anfangsdarstellung des Teams «SwissTech Precision Solutions» (statische Dateien der Site) */
export const STPS_PRESET = Object.freeze({
  preset: "stps",
  logo: "logo-full.svg", // Anmeldeseite, Vorschau (heller Hintergrund)
  symbol: "logo-symbol.svg", // Ladeanzeige (heller Hintergrund)
  side: "logo-symbol-white.svg", // Seitenleiste (dunkler Hintergrund)
  icon: "favicon.svg", // Symbol im Browser-Tab
  mime: "image/svg+xml",
  displayName: "STPS CRM",
});

// ---------------------------------------------------------------- Prüfung des Bildes

const bad = (reason, message, status = 400) => fail(status, "bad_logo", message, { reason });
const tooBig = () => bad("size", "Das Logo ist zu gross (höchstens 300 KB)", 413);
const badType = () => bad("type", "Erlaubt sind PNG, JPG, SVG und WebP");
const badData = () => bad("data", "Die Bilddatei ist beschädigt oder nicht lesbar");

/** «data:<mime>;base64,<daten>» → { mime, bytes } (wirft 400/413). Der Typ im Kopf wird später mit dem Inhalt abgeglichen. */
export function parseDataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) throw badData();
  const comma = value.indexOf(",");
  const head = comma > 0 ? value.slice(5, comma).toLowerCase() : "";
  const m = /^([a-z]+\/[a-z0-9.+-]+);base64$/.exec(head);
  if (!m) throw badType();
  if (!LOGO_TYPES.includes(m[1])) throw badType();
  const b64 = value.slice(comma + 1);
  // Grösse schon vor dem Dekodieren prüfen (Base64: 3 Bytes je 4 Zeichen)
  if (Math.floor((b64.length * 3) / 4) > MAX_LOGO_BYTES + 2) throw tooBig();
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw badData();
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_LOGO_BYTES) throw tooBig();
  if (!bytes.length) throw badData();
  return { mime: m[1], bytes };
}

/** Typ und Abmessungen aus den Anfangsbytes (PNG, JPEG, WebP); null, wenn es kein solches Bild ist. */
export function sniffRaster(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString("latin1", 12, 16) === "IHDR") {
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      if (marker === 0xd9) break; // Ende des Bildes, kein Rahmen gefunden
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b[20] === 0x2f) return { mime: "image/webp", width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    return { mime: "image/webp", width: 0, height: 0 };
  }
  return null;
}

// Aktive Inhalte in SVG: Elemente, die Code ausführen oder Fremdes laden
const SVG_BAD_ELEMENT = /<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe|embed|object|audio|video|link|handler|listener)(?=[\s/>])/i;
const TAG = /<[A-Za-z][^\s>/]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
const EVENT_ATTR = /[\s"'/]on[a-z]+\s*=/i;
const HREF_ATTR = /(?:^|[\s"'/])(?:[\w-]+:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_PARTS = /<style[\s>][\s\S]*?<\/style\s*>|[\s"']style\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const SAFE_HREF =/^\s*(?:#|data:image\/(?:png|jpeg|webp|gif);base64,)/i;

/** Grund, warum ein SVG-Text nicht akzeptiert wird (null = in Ordnung) */
export function svgProblem(text) {
  if (!/<svg[\s>]/i.test(text)) return "data";
  if (SVG_BAD_ELEMENT.test(text)) return "svg";
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text) || /<\?xml-stylesheet/i.test(text)) return "svg";
  if (/javascript\s*:/i.test(text) || /data\s*:\s*text\/html/i.test(text) || /@import/i.test(text)) return "svg";
  // url(...) nur als Verweis auf eine Definition im selben Bild (url(#farbverlauf)); alles andere lädt Fremdes
  if (/url\(\s*(?!['"]?\s*#)/i.test(text)) return "svg";
  // CSS-Escapes (u\72l(...), \68ttp) tarnen Verweise vor der Prüfung oben; echte Logos brauchen sie in Stilen nicht
  for (const css of text.match(CSS_PARTS) ?? []) if (css.includes("\\")) return "svg";
  for (const tag of text.match(TAG) ?? []) {
    if (EVENT_ATTR.test(tag)) return "svg";
    for (const m of tag.matchAll(HREF_ATTR)) if (!SAFE_HREF.test(m[1] ?? m[2] ?? m[3] ?? "")) return "svg";
  }
  return null;
}

/** Abmessungen aus dem Wurzelelement (viewBox, sonst width/height); null, wenn nicht ermittelbar */
export function svgSize(text) {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
  const num = (name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`, "i").exec(root);
    return m ? Number(m[1]) : 0;
  };
  const vb = /\sviewBox\s*=\s*["']\s*(-?[0-9.]+)[\s,]+(-?[0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(root);
  const w = vb ? Number(vb[3]) : num("width");
  const h = vb ? Number(vb[4]) : num("height");
  return w > 0 && h > 0 ? { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 } : null;
}

/** Prüft ein hochgeladenes Logo (Data-URL) und liefert, was gespeichert wird: { logo, mime, width, height } (wirft 400/413). */
export function validateLogo(dataUrl) {
  const { mime, bytes } = parseDataUrl(dataUrl);
  let size;
  if (mime === "image/svg+xml") {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw badData(); }
    const why = svgProblem(text);
    if (why === "data") throw badData();
    if (why) throw bad("svg", "Die SVG-Datei enthält aktive Inhalte (Skripte, Ereignisse oder externe Verweise) und wird nicht akzeptiert");
    size = svgSize(text);
  } else {
    const found = sniffRaster(bytes);
    if (!found || found.mime !== mime) throw badType(); // Inhalt passt nicht zum angegebenen Typ
    if (!found.width || !found.height) throw badData();
    if (found.width > MAX_LOGO_PIXELS || found.height > MAX_LOGO_PIXELS) throw bad("dimensions", "Das Bild ist zu gross (höchstens 4096 × 4096 Pixel)");
    size = { width: found.width, height: found.height };
  }
  return { logo: `data:${mime};base64,${bytes.toString("base64")}`, mime, width: size?.width ?? null, height: size?.height ?? null };
}

export function cleanDisplayName(v) {
  if (v !== undefined && v !== null && typeof v !== "string") throw fail(400, "bad_request", "Ungültige Anfrage");
  return cleanText(v, MAX_NAME_LENGTH);
}

/** «#abc» / «#0B2340» → «#aabbcc» / «#0b2340»; "" = Standardfarbe (Wert entfernen); sonst 400 bad_color */
export function cleanColor(v) {
  if (typeof v !== "string") throw fail(400, "bad_request", "Ungültige Anfrage");
  const s = v.trim();
  if (s === "") return "";
  const m = COLOR.exec(s);
  if (!m) throw fail(400, "bad_color", "Ungültige Farbe (Beispiel: #0b2340)");
  const h = m[1].toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
}
const validColor = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/.test(c) ? c : null);

// ---------------------------------------------------------------- Dokument

/** Was der Browser bekommt (nie mehr als gespeichert ist); null = Standard-Darstellung */
export function publicBranding(doc) {
  if (!doc || typeof doc !== "object") return null;
  const logo = typeof doc.logo === "string" && (doc.logo.startsWith("data:image/") || (doc.preset === "stps" && doc.logo === STPS_PRESET.logo)) ? doc.logo : null;
  const displayName = typeof doc.displayName === "string" && doc.displayName ? doc.displayName : null;
  const color = validColor(doc.color);
  if (!logo && !displayName && !color) return null;
  const out = { logo, mime: logo ? doc.mime ?? null : null, width: logo ? doc.width ?? null : null, height: logo ? doc.height ?? null : null, displayName, color };
  if (logo && doc.preset === "stps") Object.assign(out, { preset: "stps", symbol: STPS_PRESET.symbol, side: STPS_PRESET.side, icon: STPS_PRESET.icon });
  out.updatedAt = doc.updatedAt ?? null;
  out.updatedBy = doc.updatedBy ?? null;
  return out;
}

const seedDoc = (now) => ({ ...STPS_PRESET, updatedAt: new Date(now).toISOString(), updatedBy: "System" });

/** Anfangsdarstellung einmalig setzen: nur wenn es noch kein Dokument gibt (auch nicht ein zurückgesetztes). */
export async function seedBranding(store, now = Date.now()) {
  return (await store.write(BRANDING_KEY, seedDoc(now), { ifNew: true })) === true;
}

/** Aktuelles Dokument des Teams. seed: das SwissTech-Team (teams.mjs: isLegacyTeam) bekommt vorher die Anfangsdarstellung, falls es noch keine hat. */
export async function readBranding(store, { seed = false, now = Date.now() } = {}) {
  let cur = await store.read(BRANDING_KEY);
  if (!cur && seed) {
    await seedBranding(store, now);
    cur = await store.read(BRANDING_KEY);
  }
  return cur?.value ?? null;
}

/**
 * Logo, Farbe und/oder Anzeigename ändern. patch: { logo?: Data-URL, color?: "#rrggbb" ("" = Standardfarbe), displayName?: string ("" = Teamname verwenden) }.
 * @returns {{doc:object, changed:{logo:boolean, name:boolean, color:boolean}}}
 */
export async function updateBranding(store, patch, actor, { seed = false, now = Date.now() } = {}) {
  const hasLogo = patch.logo !== undefined && patch.logo !== null;
  const hasName = patch.displayName !== undefined && patch.displayName !== null;
  const hasColor = patch.color !== undefined && patch.color !== null;
  if (!hasLogo && !hasName && !hasColor) throw fail(400, "bad_request", "Bitte ein Logo, eine Farbe oder einen Anzeigenamen angeben");
  const next = hasLogo ? validateLogo(patch.logo) : null;
  const name = hasName ? cleanDisplayName(patch.displayName) : null;
  const color = hasColor ? cleanColor(patch.color) : null;
  await readBranding(store, { seed, now }); // Anfangsdarstellung zuerst, damit sie beim reinen Namenswechsel erhalten bleibt
  let changed = { logo: false, name: false, color: false };
  const { value } = await mutateDoc(store, BRANDING_KEY, (cur) => {
    const base = cur && typeof cur === "object" ? cur : {};
    const doc = { ...base };
    changed = { logo: false, name: false, color: false };
    if (next) {
      for (const k of ["preset", "symbol", "side", "icon"]) delete doc[k]; // eigenes Logo ersetzt die Anfangsdarstellung
      Object.assign(doc, next);
      changed.logo = true;
    }
    if (hasName && (doc.displayName ?? "") !== name) {
      if (name) doc.displayName = name; else delete doc.displayName;
      changed.name = true;
    }
    if (hasColor && (validColor(doc.color) ?? "") !== color) {
      if (color) doc.color = color; else delete doc.color;
      changed.color = true;
    }
    if (!changed.logo && !changed.name && !changed.color) return undefined;
    doc.updatedAt = new Date(now).toISOString();
    doc.updatedBy = actor.name;
    return doc;
  });
  return { doc: value, changed };
}

/** Zurück zur Standard-Darstellung: Logo, Farbe und Anzeigename (leeres Dokument statt Löschen, siehe oben) */
export async function resetBranding(store, actor, { now = Date.now() } = {}) {
  let had = false;
  await mutateDoc(store, BRANDING_KEY, (cur) => {
    had = Boolean(publicBranding(cur));
    return { logo: null, mime: null, updatedAt: new Date(now).toISOString(), updatedBy: actor.name };
  });
  return had;
}
