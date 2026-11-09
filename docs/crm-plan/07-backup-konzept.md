# 07 – Backup-Konzept STPS CRM

Stand: Entwurf. Zielumgebung: Infomaniak Managed MySQL 8 + kleiner Linux-VPS (Node). Skripte: `stps-crm/ops/backup/`.

## 1. Entscheide

| Thema | Entscheid |
|---|---|
| Frequenz | täglich |
| Aufbewahrung | täglich 30 Tage, monatlich 10 Jahre (120 Monate) |
| Restore-Test | vierteljährlich |
| Regel | 3-2-1 inkl. verschlüsselter externer Platte |
| Rechnungen | zusätzlich PDF-Archiv |
| Offen | Aufbewahrungsregeln (OR 958f, GeBüV) mit dem Treuhänder klären |

## 2. 3-2-1-Aufbau

3 Kopien, 2 verschiedene Medien, 1 Kopie ausserhalb.

| # | Kopie | Ort / Medium | Rhythmus | Schutz |
|---|---|---|---|---|
| 1 | Produktivdaten | Infomaniak Managed MySQL | laufend | – |
| 2 | Infomaniak-DB-Snapshots | Infomaniak (gleicher Anbieter) | gemäss Anbieter-Einstellung, täglich aktivieren | Konto mit 2FA |
| 3 | Nächtlicher `mysqldump` | zweiter Standort (anderer Anbieter/Rechenzentrum, per rsync/SSH, nur Schreibrecht für Append/Upload) | täglich 02:30 | age/gpg-verschlüsselt |
| 4 | Externe Platte | USB-Platte im Büro/Tresor, LUKS-verschlüsselt | wöchentlich (manuell oder angesteckt per Skript) | LUKS + Passphrase im Tresor |

Hinweis: Snapshots bei Infomaniak fallen mit der DB aus, wenn das Konto kompromittiert wird – darum die unabhängigen Kopien 3 und 4. Der VPS hält nur eine lokale Zwischenkopie (`/var/backups/stps`), der Schlüssel zum Entschlüsseln liegt **nicht** auf dem VPS.

Ablauf nachts: `backup.sh` → Dump (`--single-transaction`, konsistent ohne Tabellensperre bei InnoDB) → gzip → Verschlüsselung → lokal `daily/` → bei erstem Lauf des Monats Kopie nach `monthly/` → Rotation → rsync zum zweiten Standort (`SYNC_TARGET`) → optional Healthcheck-Ping.

## 3. Aufbewahrung

| Ebene | Behalten | Löschung |
|---|---|---|
| `daily/` | 30 Tage | automatisch durch `backup.sh` (Datum im Dateinamen) |
| `monthly/` | 120 Monate | automatisch durch `backup.sh` |
| Infomaniak-Snapshots | gemäss Anbieter (mind. 7 Tage prüfen) | Anbieter |
| Externe Platte | Wochenstand; mind. 4 Wochenstände + alle Monatsstände des laufenden Jahres, Jahresstand zusätzlich | manuell nach Rotationsplan, zwei Platten im Wechsel |
| PDF-Archiv Rechnungen | Frist gemäss Treuhänder (Annahme 10 Jahre) | nur nach Freigabe |

Der zweite Standort spiegelt `daily/` mit `--delete` (30 Tage), `monthly/` ohne `--delete`; dort deshalb eine eigene Bereinigung (gleiche 120 Monate) einrichten oder `backup.sh` per SSH dort laufen lassen.

Datenschutz: Im Dump stehen Personendaten (Kunden, Konten). Bei der Löschung nach Fristablauf (DSG) gilt: Gelöschte Datensätze verschwinden aus Backups erst mit deren Ablauf. Die Monatssicherungen (10 Jahre) sind dafür die Grenze – mit dem Treuhänder abstimmen.

## 4. Verschlüsselung

Empfohlen: **age** (einfach, kein Keyring). gpg wird ebenfalls unterstützt (`ENCRYPTION=gpg`).

```bash
# Einmalig auf einem Büro-Rechner (NICHT auf dem VPS):
age-keygen -o stps-backup.key          # gibt "Public key: age1..." aus
```

- Öffentlicher Schlüssel (`age1…`) → `AGE_RECIPIENT` in `/etc/stps-backup.env`. Mehrere Empfänger (Leerzeichen getrennt) möglich: Geschäftsleitung + Notfallschlüssel.
- Private Datei `stps-backup.key`: Passwortmanager **und** ausgedruckt/auf USB im Tresor, mindestens an 2 Orten, mindestens 2 Personen wissen davon. Ohne den Schlüssel sind alle Backups wertlos.
- DB-Passwort für den Backup-Benutzer: eigener MySQL-User mit `SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES` nur auf der CRM-Datenbank.
- Env-Datei: `chmod 600 /etc/stps-backup.env`, Besitzer `stps-backup`.
- Schlüssel-Rotation: neuen Schlüssel zusätzlich als Empfänger eintragen; alte Backups bleiben mit dem alten Schlüssel lesbar – alten Schlüssel also nie vernichten, solange Backups existieren.

Beispiel `/etc/stps-backup.env`:

```
DB_HOST=xxxx.myd.infomaniak.com
DB_NAME=stps_crm
DB_USER=stps_backup
DB_PASSWORD=...
BACKUP_DIR=/var/backups/stps
AGE_RECIPIENT=age1xxxxxxxx...
SYNC_TARGET=backup@zweiter-standort.example:/srv/stps-backup/
HEALTHCHECK_URL=
```

Einrichtung: Skripte nach `/opt/stps/stps-crm/ops/backup/`, `stps-backup.service` und `.timer` nach `/etc/systemd/system/`, `systemctl enable --now stps-backup.timer`, Status mit `systemctl list-timers stps-backup.timer` und `journalctl -u stps-backup`.

## 5. Restore-Runbook

Ziel: DB nach Ausfall/Datenverlust wiederherstellen. Immer zuerst in eine **Testdatenbank** laden und prüfen.

1. **Entscheiden**: Was ist kaputt (DB, VPS, Konto)? Zeitpunkt des gewünschten Standes bestimmen. App stoppen (`systemctl stop stps-crm`), damit keine neuen Daten geschrieben werden.
2. **Aktuelle DB sichern**, falls noch lesbar (`mysqldump` oder Infomaniak-Snapshot), um nichts zusätzlich zu verlieren.
3. **Sicherung wählen**: Infomaniak-Snapshot (schnellster Weg bei DB-Defekt) oder Datei aus `daily/` / `monthly/` / zweitem Standort / externer Platte. Bei Totalausfall des VPS: Datei vom zweiten Standort oder der Platte holen.
4. **Schlüssel bereitstellen**: private age-Datei auf den Rechner legen, der den Restore ausführt (`chmod 600`).
5. **Testwiederherstellung**:
   ```bash
   export DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=stps_crm
   export AGE_IDENTITY=/pfad/stps-backup.key
   ./restore.sh /var/backups/stps/daily/stps-crm_2026-11-07.sql.gz.age
   # lädt nach stps_crm_restoretest, prüft vorab Entschlüsselung + gzip
   ```
6. **Prüfen**: Zeilenzahlen (Ausgabe des Skripts) mit Erwartung vergleichen; stichprobenweise Kunden, letzte Rechnung, Tabellen `kv` und `audit_log` (neuester Eintrag = erwarteter Zeitpunkt).
7. **Produktiv einspielen** (nur nach Schritt 6): entweder bestehende DB umbenennen/leeren und `CONFIRM_OVERWRITE=yes ./restore.sh <datei> stps_crm`, oder App auf die Restore-DB umstellen (`DB_NAME` in der App-Konfiguration).
8. **App starten**, Login testen, Stichproben in der Oberfläche, Rechnungs-PDF öffnen.
9. **Datenlücke** zwischen Backup-Zeitpunkt und Ausfall ermitteln (Audit-Log des Ausfalltags, PDF-Archiv, E-Mails) und betroffene Nutzer informieren; fehlende Rechnungen/Aufträge nacherfassen.
10. **Dokumentieren**: Vorfall, verwendete Sicherung, Dauer, Lehren (Datum, Person). Sind Personendaten abhandengekommen, Meldepflicht (DSG) mit Datenschutzverantwortlichem prüfen.

Zielwerte (zu bestätigen): RPO max. 24 h, RTO max. 4 h.

## 6. Quartalsweiser Restore-Test (Checkliste)

Termine: Januar, April, Juli, Oktober (Kalendereintrag, verantwortliche Person benannt).

- [ ] Zufällige Sicherung wählen: eine `daily/`, im Wechsel eine `monthly/`, einmal pro Jahr eine ≥ 5 Jahre alte.
- [ ] Datei von der **externen Platte oder dem zweiten Standort** holen (nicht nur vom VPS).
- [ ] Schlüssel aus dem Tresor/Passwortmanager verwenden (prüft, dass er noch lesbar ist).
- [ ] `restore.sh` in die Testdatenbank, Dauer notieren.
- [ ] Zeilenzahlen plausibel (Kunden, Rechnungen, `kv`, `audit_log` gegenüber Produktion, Abweichung nur durch Zeitdifferenz).
- [ ] App gegen Restore-DB starten (Staging), Login, 3 Stichproben.
- [ ] PDF-Archiv: 3 zufällige Rechnungen mit DB-Datensatz abgleichen (Nummer, Betrag).
- [ ] Externe Platte: entschlüsselbar, aktuelle Stände vorhanden, freier Platz.
- [ ] Infomaniak-Snapshot-Einstellung noch aktiv; Backup-Timer lief zuletzt erfolgreich.
- [ ] Testdatenbank löschen (`DROP DATABASE ..._restoretest`), Protokoll ablegen (Datum, Person, Datei, Dauer, Ergebnis, Mängel).

## 7. PDF-Archiv für Rechnungen

Warum: Eine Rechnung muss so aufbewahrt werden, wie sie versandt wurde; spätere Änderungen an Stammdaten (Adresse, Artikeltext) dürfen sie nicht verändern.

- Beim Festschreiben/Versand einer Rechnung wird das PDF (inkl. QR-Rechnung) **unveränderlich** abgelegt: `archiv/rechnungen/<Jahr>/<Rechnungsnr>.pdf`, dazu SHA-256 in der DB (Feld bei der Rechnung, Eintrag im Audit-Log).
- Speicherort: Verzeichnis auf dem VPS, eigener Benutzer, nur anhängen (Datei nach Schreiben `chattr +i` oder Schreibrecht entziehen); Aufnahme ins nächtliche Backup (ebenfalls verschlüsselt, `rsync` zum zweiten Standort und auf die externe Platte).
- Stornos/Gutschriften: eigenes PDF, das Original bleibt bestehen.
- Monatlicher Abgleich: Anzahl PDFs je Monat = Anzahl festgeschriebener Rechnungen; Hash-Stichproben im Restore-Test.
- Zusätzlich je Jahr Export (Rechnungsjournal als CSV/PDF) für den Treuhänder.

## 8. Fragen an den STPS-Treuhänder

Rechtsgrundlagen: Art. 958f OR (Aufbewahrung Geschäftsbücher und Buchungsbelege), GeBüV (Verordnung über die Führung und Aufbewahrung der Geschäftsbücher).

1. Gilt für Rechnungen (Ausgang und Eingang) und Buchungsbelege die Frist von 10 Jahren ab Ende des Geschäftsjahres? Gibt es abweichende Fristen (MWST: 10 Jahre, Belege zu Immobilien 20 Jahre)?
2. Reicht das elektronische PDF-Archiv als Original, oder braucht es zusätzlich Papier? Ist das CRM überhaupt «Buchhaltungssystem» oder nur Fakturierung (Buchhaltung extern)?
3. Welche Anforderungen an Integrität und Nachvollziehbarkeit (GeBüV Art. 8/9: Unveränderbarkeit, Zeitstempel, Prüfbarkeit) erfüllen unser Hash-Verfahren und das Audit-Log? Braucht es einen qualifizierten Zeitstempel oder eine Signatur?
4. Dürfen die Daten bei einem Anbieter im Ausland (zweiter Standort) liegen? (MWSTG verlangt für Belege im Ausland Zugriff aus der Schweiz.)
5. Dokumentationspflicht (GeBüV Art. 10): Welche Verfahrensdokumentation (Backup-Konzept, Restore-Tests, Zugriffsrechte) wollen Sie im Prüfungsfall sehen?
6. Müssen auch Kundenstammdaten, Offerten, Lieferscheine, E-Mails aufbewahrt werden und wie lange? (Geschäftskorrespondenz vs. Buchungsbeleg.)
7. Wie sind Monatssicherungen (10 Jahre, enthalten Personendaten) mit der Löschpflicht nach DSG zu vereinbaren?
8. Format und Übergabe bei Revision/Steuerprüfung (CSV, PDF/A, Export aus dem Backup)? Ist PDF/A erforderlich?
9. Wer ist intern für die Aufbewahrung verantwortlich, und genügt der vierteljährliche Restore-Test als Nachweis?
10. Aufbewahrung der Backups selbst: Zählt die Datenbanksicherung als Aufbewahrung oder nur das PDF-Archiv/Journal?

Antworten hier eintragen und Fristen in Abschnitt 3 anpassen.
