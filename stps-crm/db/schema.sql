-- STPS CRM – MySQL 8 Schema (Ziel: Infomaniak managed MySQL). Idempotent.
CREATE TABLE IF NOT EXISTS kv_store (
  k          VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  kind       ENUM('json','bin') NOT NULL DEFAULT 'json',
  val        LONGBLOB NOT NULL,                 -- JSON als UTF-8-Bytes bzw. Binärdaten (Dateien)
  etag       CHAR(36) NOT NULL,                 -- neu bei jedem Schreiben (optimistische Sperre)
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (k),
  KEY idx_kv_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Revisionssicheres Änderungsprotokoll (Ausbau; heute liegt das Audit-Log noch als Dokument «audit» je Team im KV).
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  team_id    VARCHAR(64) NULL,
  user_id    VARCHAR(64) NULL,
  action     VARCHAR(64) NOT NULL,
  tbl        VARCHAR(64) NULL,
  record_id  VARCHAR(128) NULL,
  detail     JSON NULL,
  PRIMARY KEY (id),
  KEY idx_audit_team_at (team_id, at),
  KEY idx_audit_record (tbl, record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
