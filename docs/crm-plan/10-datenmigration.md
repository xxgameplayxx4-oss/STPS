# 10 – Datenmigration Blobs -> MySQL

Skript: `stps-crm/scripts/migrate-blobs-to-mysql.mjs` (`npm run migrate:mysql -- <Optionen>`). Idempotent: erneutes Ausführen überschreibt mit denselben Inhalten.

## Schritte
1. Schema anlegen: `db/schema.sql` auf der Ziel-DB ausführen.
2. Sicherung der Quelle als Datei: `--from blobs --export sicherung.json` (benötigt `NETLIFY_SITE_ID`, `NETLIFY_BLOBS_TOKEN`). Datei sicher aufbewahren (enthält Kundendaten).
3. Trockenlauf: `--from blobs --dry-run` oder `--from file --file sicherung.json --dry-run` zeigt Anzahl, Bytes und Prüfsumme der Quelle.
4. Probe auf lokalem Docker-MySQL mit Beispieldaten.
5. Produktiv: App kurz in den Wartungsmodus (keine Schreibzugriffe), Migration ohne `--dry-run` mit `DB_*`-Variablen, Bericht prüfen.
6. In Netlify `DB_DRIVER=mysql` und `DB_*` setzen, neu deployen, Stichproben in der App.

## Verifikation
Der Bericht nennt je Seite Anzahl Schlüssel, Bytes und eine Prüfsumme (SHA-256 über Schlüssel, Typ und Inhalts-Hash). Nach dem Schreiben wird jeder Eintrag aus MySQL zurückgelesen und verglichen; Abweichungen werden gelistet (Exit-Code 2). Quelle und Ziel müssen dieselbe Prüfsumme haben.

## Rückfall
`DB_DRIVER` entfernen und neu deployen: die App nutzt wieder Blobs (unverändert, die Migration löscht nichts). Schreibvorgänge, die nach dem Umschalten in MySQL erfolgten, sind dann nicht in Blobs; daher Wartungsfenster und bei Rückfall ggf. Export aus MySQL nachführen.

## Hinweise
Binärdaten werden an Schlüsseln mit `fbin/` erkannt. Die etags ändern sich bei der Migration (laufende Bearbeitungen im Browser müssen neu laden).
