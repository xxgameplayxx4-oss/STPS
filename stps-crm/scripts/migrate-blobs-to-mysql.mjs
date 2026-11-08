#!/usr/bin/env node
// Kopiert alle Schlüssel aus Netlify Blobs (oder einer JSON-Exportdatei) nach MySQL. Idempotent (erneutes Ausführen überschreibt gleiche Inhalte).
// Quelle:  --from blobs   (NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN, Store "stps-crm")   |   --from file --file export.json
//          Exportformat: { "<key>": <json-wert> | { "$bin": "<base64>" }, ... }
// Ziel:    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
// Optionen: --dry-run (nichts schreiben, nur zählen), --prefix t/abc/ , --export out.json (Quelle als JSON-Datei sichern, ohne MySQL)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values: o } = parseArgs({ options: { from: { type: "string", default: "blobs" }, file: { type: "string" }, "dry-run": { type: "boolean" }, prefix: { type: "string", default: "" }, export: { type: "string" } } });
const isBin = (k) => /(^|\/)fbin\//.test(k);
const sha = (b) => createHash("sha256").update(b).digest("hex");
// Kanonische Bytes eines Eintrags: JSON wird neu serialisiert (Schlüsselreihenfolge bleibt), Binärdaten roh.
const canon = (kind, v) => (kind === "bin" ? v : Buffer.from(JSON.stringify(v), "utf8"));

async function* sourceEntries() {
  if (o.from === "file") {
    const data = JSON.parse(readFileSync(o.file, "utf8"));
    for (const k of Object.keys(data).sort()) {
      if (!k.startsWith(o.prefix)) continue;
      const v = data[k];
      yield v && typeof v === "object" && "$bin" in v ? { key: k, kind: "bin", value: Buffer.from(v.$bin, "base64") } : { key: k, kind: "json", value: v };
    }
    return;
  }
  const { getStore } = await import("@netlify/blobs");
  const opts = { name: "stps-crm", consistency: "strong" };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) Object.assign(opts, { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  const store = getStore(opts);
  const { blobs } = await store.list({ prefix: o.prefix });
  for (const { key } of blobs.sort((a, b) => (a.key < b.key ? -1 : 1))) {
    if (isBin(key)) {
      const b = await store.get(key, { type: "arrayBuffer" });
      if (b) yield { key, kind: "bin", value: Buffer.from(b) };
    } else {
      const v = await store.get(key, { type: "json" });
      if (v !== null) yield { key, kind: "json", value: v };
    }
  }
}

const entries = [];
for await (const e of sourceEntries()) entries.push(e);
const srcSum = createHash("sha256");
let srcBytes = 0;
for (const e of entries) { const b = canon(e.kind, e.value); srcBytes += b.length; srcSum.update(e.key + "\0" + e.kind + "\0" + sha(b) + "\n"); }
console.log(`Quelle: ${entries.length} Schlüssel (${entries.filter((e) => e.kind === "bin").length} binär), ${srcBytes} Bytes, Prüfsumme ${srcSum.digest("hex").slice(0, 16)}`);

if (o.export) {
  const out = {};
  for (const e of entries) out[e.key] = e.kind === "bin" ? { $bin: e.value.toString("base64") } : e.value;
  writeFileSync(o.export, JSON.stringify(out));
  console.log(`Export geschrieben: ${o.export}`);
  process.exit(0);
}
if (o["dry-run"]) { console.log("Trockenlauf: nichts geschrieben."); process.exit(0); }

const { createMysqlAdapter, createMysqlPool } = await import("../netlify/functions/lib/kv-mysql.mjs");
const pool = await createMysqlPool(process.env);
try {
  const db = createMysqlAdapter(pool);
  for (const e of entries) await db.rawPut(e.key, e.kind, canon(e.kind, e.value));
  // Verifikation: Anzahl und Prüfsumme je Schlüssel aus MySQL zurücklesen
  const dstSum = createHash("sha256");
  let dstCount = 0, bad = 0;
  for (const e of entries) {
    const r = await db.rawGet(e.key);
    const b = r ? (r.kind === "json" ? Buffer.from(JSON.stringify(JSON.parse(r.bytes.toString("utf8"))), "utf8") : r.bytes) : null;
    if (!r || r.kind !== e.kind || sha(b) !== sha(canon(e.kind, e.value))) { bad++; console.error(`ABWEICHUNG: ${e.key}`); continue; }
    dstCount++;
    dstSum.update(e.key + "\0" + e.kind + "\0" + sha(b) + "\n");
  }
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM kv_store WHERE k LIKE ?", [o.prefix.replace(/[\\%_]/g, "\\$&") + "%"]);
  console.log(`Ziel:   ${dstCount} verifiziert, ${bad} Abweichungen, ${n} Zeilen im Ziel (mit Präfix), Prüfsumme ${dstSum.digest("hex").slice(0, 16)}`);
  if (bad) process.exit(2);
  if (Number(n) !== entries.length) console.warn("Hinweis: Das Ziel enthält zusätzliche Schlüssel (nicht aus der Quelle).");
} finally {
  await pool.end();
}
