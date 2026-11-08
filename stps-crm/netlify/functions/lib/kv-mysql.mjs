// STPS CRM – KV-Adapter auf MySQL 8 (gleiches Interface wie createBlobsAdapter in core.mjs).
// Tabelle kv_store (siehe db/schema.sql): k (Schlüssel), kind ('json'|'bin'), val (LONGBLOB), etag, updated_at.
// Optimistische Nebenläufigkeit: ifNew = INSERT (Duplikat => false); ifMatch = UPDATE ... WHERE etag = ? (0 Zeilen => false).
// Jeder Schreibvorgang vergibt ein neues etag (zufällig), damit auch identischer Inhalt ein neues etag erhält.
import { randomUUID } from "node:crypto";

const ER_DUP_ENTRY = 1062;
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** @param pool mysql2/promise Pool (oder kompatibles Objekt mit query(sql, params) => [rows|ResultSetHeader]) */
export function createMysqlAdapter(pool, { table = "kv_store" } = {}) {
  const T = "`" + table.replace(/[^a-zA-Z0-9_]/g, "") + "`";
  const upsert = async (key, kind, buf, cond) => {
    const etag = randomUUID();
    if (cond?.ifNew) {
      try {
        await pool.query(`INSERT INTO ${T} (k, kind, val, etag) VALUES (?, ?, ?, ?)`, [key, kind, buf, etag]);
        return true;
      } catch (e) {
        if (e?.errno === ER_DUP_ENTRY || e?.code === "ER_DUP_ENTRY") return false;
        throw e;
      }
    }
    if (cond?.ifMatch) {
      const [r] = await pool.query(`UPDATE ${T} SET kind = ?, val = ?, etag = ? WHERE k = ? AND etag = ?`, [kind, buf, etag, key, cond.ifMatch]);
      return r.affectedRows > 0;
    }
    await pool.query(
      `INSERT INTO ${T} (k, kind, val, etag) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE kind = VALUES(kind), val = VALUES(val), etag = VALUES(etag)`,
      [key, kind, buf, etag]);
    return true;
  };
  return {
    async read(key) {
      const [rows] = await pool.query(`SELECT val, etag FROM ${T} WHERE k = ? AND kind = 'json'`, [key]);
      return rows.length ? { value: JSON.parse(Buffer.from(rows[0].val).toString("utf8")), etag: rows[0].etag } : null;
    },
    write: (key, value, cond) => upsert(key, "json", Buffer.from(JSON.stringify(value), "utf8"), cond),
    async list(prefix) {
      const [rows] = await pool.query(`SELECT k FROM ${T} WHERE k LIKE ? ESCAPE '\\\\' ORDER BY k`, [likeEscape(prefix || "") + "%"]);
      return rows.map((r) => r.k);
    },
    async remove(key) {
      await pool.query(`DELETE FROM ${T} WHERE k = ?`, [key]);
    },
    async readBin(key) {
      const [rows] = await pool.query(`SELECT val FROM ${T} WHERE k = ? AND kind = 'bin'`, [key]);
      return rows.length ? Buffer.from(rows[0].val) : null;
    },
    async writeBin(key, bytes) {
      await upsert(key, "bin", Buffer.from(bytes), null);
    },
    // Für Migration/Verifikation (nicht Teil des Blobs-Interface)
    async rawGet(key) {
      const [rows] = await pool.query(`SELECT kind, val, etag FROM ${T} WHERE k = ?`, [key]);
      return rows.length ? { kind: rows[0].kind, bytes: Buffer.from(rows[0].val), etag: rows[0].etag } : null;
    },
    async rawPut(key, kind, bytes) {
      await upsert(key, kind, Buffer.from(bytes), null);
    },
  };
}

/** Pool aus Umgebungsvariablen: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL (1/true => TLS mit Zertifikatsprüfung). */
export async function createMysqlPool(env = process.env) {
  const mysql = await import("mysql2/promise");
  const ssl = /^(1|true|yes)$/i.test(env.DB_SSL || "") ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined;
  return mysql.createPool({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
    ssl, waitForConnections: true, connectionLimit: Number(env.DB_POOL || 4), charset: "utf8mb4", dateStrings: true,
  });
}
