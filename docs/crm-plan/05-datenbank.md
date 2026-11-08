# 05 – Datenbank (MySQL 8)

Ziel: Infomaniak managed MySQL 8. Test: lokales Docker-MySQL mit Beispieldaten (`stps-crm/db/docker-compose.yml`).

## Schema (`stps-crm/db/schema.sql`)
- **kv_store**: `k` (Schlüssel, bis 512 Zeichen, `utf8mb4_bin`), `kind` (`json`/`bin`), `val` (LONGBLOB: JSON als UTF-8 bzw. Dateibytes), `etag` (neu bei jedem Schreiben), `updated_at`.
- **audit_log**: vorbereitet für ein revisionssicheres Änderungsprotokoll (heute noch Dokument `audit` je Team im KV).

## Warum zuerst KV in MySQL?
Die App speichert Dokumente unter Schlüsseln wie `t/<team>/db`, `users`, `fbin/<id>`. Der MySQL-Adapter (`netlify/functions/lib/kv-mysql.mjs`) hat exakt dasselbe Interface wie der Blobs-Adapter (`read/write/list/remove/readBin/writeBin`) und dieselbe optimistische Nebenläufigkeit (`ifNew` = INSERT, `ifMatch` = UPDATE ... WHERE etag). So wechselt der Speicher ohne Änderung der Geschäftslogik; das Risiko bleibt klein und der Wechsel ist umkehrbar.

Umschalten: `DB_DRIVER=mysql` plus `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=1` (Infomaniak: TLS verwenden). Ohne `DB_DRIVER` bleibt alles bei Netlify Blobs (`lib/store.mjs`).

## Ausblick: relationale Tabellen
Spätere Schritte (je Bereich einzeln, mit Dual-Write und Vergleich): Konten/Teams/Benutzer, Kunden/Aufträge/Rechnungen als echte Tabellen mit Fremdschlüsseln, Audit-Log in `audit_log`, Dateien in Objektspeicher statt LONGBLOB. Der KV-Adapter bleibt dabei für übrige Dokumente bestehen.

## Lokal testen
`docker compose -f stps-crm/db/docker-compose.yml up -d`, dann
`DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=stps DB_PASSWORD=stps-test DB_NAME=stps_crm npm run test:kv`.
