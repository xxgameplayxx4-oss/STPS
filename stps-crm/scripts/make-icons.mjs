#!/usr/bin/env node
// Erzeugt die App-Symbole (PWA) aus kgc-favicon.svg – Aufruf: node scripts/make-icons.mjs
// Benötigt einmalig @resvg/resvg-js (nur zum Erzeugen, keine Laufzeit-Abhängigkeit):  npm i --no-save @resvg/resvg-js
// Die erzeugten PNGs liegen unter icons/ und sind eingecheckt; dieses Skript muss nur bei geändertem Logo erneut laufen.
//   icon-192.png / icon-512.png            "any": abgerundete Kachel wie das Favicon
//   icon-maskable-192.png / -512.png       "maskable": randlos, Logo in der Sicherheitszone (80 %)
//   apple-touch-icon.png (180)             randlos (iOS rundet selbst ab)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(process.cwd(), "noop.js"));
let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch {
  console.error("@resvg/resvg-js fehlt – bitte «npm i --no-save @resvg/resvg-js» ausführen.");
  process.exit(1);
}

const src = readFileSync(join(root, "kgc-favicon.svg"), "utf8");
const BG = /<rect width="64" height="64" rx="14" fill="(#[0-9a-f]{6})"\/>/i.exec(src);
if (!BG) throw new Error("kgc-favicon.svg hat nicht die erwartete Form");
const color = BG[1];
// Alles ausser Titel und Hintergrund-Kachel = das Zeichen selbst
const glyph = src.replace(/<svg[^>]*>/, "").replace("</svg>", "").replace(/<title>.*?<\/title>/s, "").replace(BG[0], "").trim();

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
const full = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph}</g></svg>`;

mkdirSync(join(root, "icons"), { recursive: true });
const out = (name, png) => { writeFileSync(join(root, "icons", name), png); console.log("icons/" + name); };
out("icon-192.png", render(src, 192));
out("icon-512.png", render(src, 512));
out("icon-maskable-192.png", render(full(0.72), 192));
out("icon-maskable-512.png", render(full(0.72), 512));
out("apple-touch-icon.png", render(full(0.86), 180));
