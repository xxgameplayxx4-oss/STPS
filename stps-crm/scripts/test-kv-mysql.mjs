#!/usr/bin/env node
// Prüft den KV-Vertrag: immer gegen den In-Memory-Store; gegen MySQL nur mit DB_HOST/DB_USER/DB_NAME (sonst Überspringen).
// Aufruf: node scripts/test-kv-mysql.mjs  (npm run test:kv)   Lokale DB: docker compose -f db/docker-compose.yml up -d
import { readFileSync } from "node:fs";
import { createMemoryStore } from "../netlify/functions/lib/core.mjs";
import { createMysqlAdapter, createMysqlPool } from "../netlify/functions/lib/kv-mysql.mjs";
import { open } from "../netlify/functions/lib/store.mjs";
import { runContract } from "./lib/kv-contract.mjs";
import assert from "node:assert/strict";

await runContract(createMemoryStore(), "In-Memory");

// open(): Standard = Blobs-Adapter (Funktionen vorhanden), DB_DRIVER=mysql = MySQL-Adapter
for (const env of [{}, { DB_DRIVER: "mysql" }]) {
  const s = open(env);
  for (const f of ["read", "write", "list", "remove", "readBin", "writeBin"]) assert.equal(typeof s[f], "function");
}
console.log("ok  store.open() liefert das vollständige Interface");

const { DB_HOST, DB_USER, DB_NAME } = process.env;
if (!DB_HOST || !DB_USER || !DB_NAME) {
  console.log("--  MySQL-Test übersprungen (DB_HOST/DB_USER/DB_NAME nicht gesetzt)");
  process.exit(0);
}
const pool = await createMysqlPool(process.env);
try {
  const ddl = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
  for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) await pool.query(stmt);
  await runContract(createMysqlAdapter(pool), "MySQL");
} finally {
  await pool.end();
}
