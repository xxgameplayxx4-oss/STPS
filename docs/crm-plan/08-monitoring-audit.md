# 08 – Monitoring und Audit-Log STPS CRM

Stand: Entwurf. Zielumgebung: Infomaniak Managed MySQL 8 + VPS (Node, systemd).

## 1. Verfügbarkeit (Uptime)

- Externer Check alle 1–5 Minuten auf `https://<crm-domain>/api/health` (Antwort 200 + einfacher DB-Ping `SELECT 1`; Endpunkt falls nicht vorhanden ergänzen). Dienst: UptimeRobot, Better Stack o. ä. (extern, nicht auf dem VPS).
- Zusätzlich Check auf Zertifikat-Ablauf (< 14 Tage warnen) und auf die Startseite.
- Alarm: E-Mail an zwei Personen, bei Ausfall > 5 Min. zusätzlich SMS/Push.
- Dead-man's-switch für das Backup: `HEALTHCHECK_URL` in `backup.sh` (z. B. healthchecks.io), Alarm wenn > 26 h kein Ping.

## 2. Logs

- Node-App als systemd-Dienst: Logs im Journal (`journalctl -u stps-crm -f`). `Storage=persistent`, `SystemMaxUse=500M`, `MaxRetentionSec=90day` in `journald.conf`.
- Reverse-Proxy (nginx/Caddy): Zugriffs- und Fehlerlog, logrotate wöchentlich, 12 Wochen.
- Backup-Log: `journalctl -u stps-backup`.
- Keine Passwörter, Tokens oder vollständige Request-Bodies loggen. IP-Adressen nur so lange wie nötig (DSG).
- Auffälliges: viele 401/429 (Login-Throttle), 5xx-Serie, DB-Verbindungsfehler.

## 3. Alarme für Disk und Datenbank

| Was | Schwelle | Wie |
|---|---|---|
| Disk VPS (`/`, `/var/backups`, Archiv) | Warnung 80 %, kritisch 90 % | Cron/systemd-Timer-Skript `df`, bei Überschreitung E-Mail |
| RAM / Load VPS | Load > 2× CPUs über 15 Min. | gleiches Skript oder Netdata |
| DB-Speicher Infomaniak | 80 % des gebuchten Volumens | Infomaniak-Manager Alarm / monatliche Kontrolle `information_schema.tables` |
| DB-Verbindungen | > 80 % `max_connections` | Check `SHOW STATUS LIKE 'Threads_connected'` |
| Backup | letzter Lauf > 26 h her, Datei leer oder < 50 % der Vorgängergrösse | Healthcheck + Skript |
| Zertifikat | < 14 Tage | externer Check |
| Tabelle `audit_log` / `kv` | Wachstum > erwartet | monatliche Grössenkontrolle |

## 4. Fehlerbenachrichtigung per E-Mail

systemd `OnFailure=` ruft eine Vorlage auf, die eine Mail schickt (Beispiel):

```ini
# /etc/systemd/system/stps-notify@.service
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'systemctl status --no-pager -n 30 %i | mail -s "STPS CRM: %i fehlgeschlagen" admin@stps.example'
```

Gilt für `stps-crm.service` und `stps-backup.service` (`OnFailure=stps-notify@%n.service`). Voraussetzung: lokaler MTA (msmtp mit Infomaniak-SMTP). Für Fehler innerhalb der App (unbehandelte Exceptions) zusätzlich Sammler wie Sentry oder ein `process.on("uncaughtException")`-Hook, der eine Mail versendet (gedrosselt, max. 1 pro 10 Min.). Testmail beim Einrichten und nach jedem Quartals-Restore-Test auslösen.

## 5. Was das Audit-Log aufzeichnet (Ist-Stand aus `netlify/functions/lib/audit.mjs`)

Beim Speichern (`PUT /api/db`) vergleicht der Server alten und neuen Stand je Tabelle und Datensatz:

- **Einträge**: `at` (ISO-Zeit), `uid`, `displayName`, ggf. `superadmin`, `action` (`create` / `update` / `delete`, ausserdem `enter` bei Zutritt des Superadmins in ein Team), `table`, `recordId`, `number` (Belegnummer), `label` (z. B. Firma, «Produkt (Kunde)»), `fields` (Namen der geänderten Felder), optional `ref` (customerId/supplierId/dealId).
- **Server-Stempel** an jedem Datensatz: `createdAt/By`, `updatedAt/By` aus dem angemeldeten Konto; Werte vom Client werden verworfen.
- **Weitere Ereignisse**: Änderungen an Auswahllisten (`lists`) und an Firmenangaben/MWST/Nummernstart (`settings.billing`, mit Feldnamen).
- **Sammeleinträge**: mehr als 25 Änderungen einer Tabelle in einem Speichern (Import, «Alles löschen») → eine Zeile je Aktion mit `count`.
- **Abfrage**: `GET /api/audit` mit Filtern uid, table, recordId, related; max. 200 je Abruf. Superadmin-Einträge werden für Nicht-Superadmins anonymisiert.
- **Kontoereignisse** (Aufrufe von `appendAudit` in `accounts.mjs`) schreiben ebenfalls ins Protokoll.

### Lücken

1. **Keine Werte**: Es werden nur Feldnamen protokolliert, nicht alter/neuer Wert. Ein versehentlich geänderter Betrag ist so nicht rekonstruierbar (nur über Backup).
2. **Rollierend, nur 2000 Einträge** (`AUDIT_KEEP`): ältere Einträge werden überschrieben. Für Aufbewahrungsfragen (OR 958f / GeBüV) ungeeignet; Bulk-Importe verbrauchen wenig, aber aktive Teams erreichen die Grenze in Wochen/Monaten.
3. **Nicht manipulationssicher**: Einträge liegen in einem Dokument («audit») im gleichen Speicher wie die Daten; keine Hash-Kette, keine Schreibsperre, Admin mit DB-Zugriff kann ändern.
4. **Nur Schreibzugriffe**: Lesen, Exporte, PDF-Downloads und Dateizugriffe fehlen.
5. **Login-Ereignisse** (erfolgreich, fehlgeschlagen, Passwortänderung) sind nicht zentral im Audit-Log ersichtlich (Login-Throttle ist getrennt).
6. **Ganzer Stand pro Speichern**: Der Server vergleicht Client-Snapshots; gleichzeitige Änderungen verschiedener Personen können als Änderung der letzten Speichernden erscheinen. Fehler beim Anhängen werden bewusst abgefangen – ein Eintrag kann bei Fehler fehlen, ohne dass es auffällt.
7. **Keine IP / kein User-Agent / keine Request-ID.**
8. **Kein Alarm** bei kritischen Aktionen (Löschen vieler Datensätze, Rollenänderung).

### Empfehlung für die MySQL-Tabelle `audit_log`

Eigene Tabelle (append-only, Zeile pro Eintrag) statt rollierendem Dokument: Spalten at, uid, action, table_name, record_id, number, label, fields (JSON), ref (JSON), ip, request_id; optional `prev_hash`/`hash` (SHA-256-Kette). DB-Benutzer der App nur `INSERT, SELECT` auf `audit_log` (kein `UPDATE/DELETE`); Alt-/Neuwert wenigstens für Rechnungen und Preise; Login- und Rollenereignisse aufnehmen. Alarm bei Massenlöschungen per E-Mail.

## 6. Aufbewahrung

| Daten | Dauer | Anmerkung |
|---|---|---|
| Audit-Log (aktuelles Dokument) | letzte 2000 Einträge | heute; mit `audit_log`-Tabelle: Vorschlag 10 Jahre für buchungsrelevante Tabellen (invoices, settings.billing), 2 Jahre übrige (mit Treuhänder klären) |
| Audit-Log in Backups | 30 Tage täglich, 10 Jahre monatlich | Backups sichern das Log automatisch mit |
| Anwendungs-/Systemlogs | 90 Tage | journald/logrotate |
| Zugriffslogs Reverse-Proxy | 12 Wochen | IP-Daten, DSG |
| Monitoring-Historie | 12 Monate | Anbieter |

Quartalsweise: Audit-Log prüfen (ungewöhnliche Massenlöschungen, Superadmin-Zutritte), Alarmempfänger und Testmail kontrollieren.
