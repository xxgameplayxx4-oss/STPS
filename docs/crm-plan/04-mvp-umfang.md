# 04 MVP-Umfang für Go-live (Infomaniak MySQL + VPS)

Stand 2026-11-08. Ziel: Das vorhandene CRM läuft produktiv für STPS (Pascal, Liz, Marco) auf Infomaniak, mit sicheren Zugängen, Backup und Altdaten. Funktionsumfang bleibt weitgehend wie heute; der Aufwand liegt in Plattform, Migration und Absicherung.

## Im MVP (in)

- Kunden, Lieferanten, Kontakte, Adressen, Aktivitäten, Aufgaben, Kalender (F-01 bis F-04, F-07, F-09, F-10)
- Pipeline (Liste/Kanban), Offerten, Auftragsbestätigung, Rechnungen mit MWST und Storno (F-12, F-14), Artikel/Kategorien (F-16)
- Excel-Import (F-20) und Altdaten-Import aus der bisherigen Software (F-21)
- Benutzer, Rollen und bestätigte Rechtematrix (F-24, F-25), Audit-Log (F-27)
- Plattform: MySQL-Speicher, Node-Server auf VPS, Server-Cron, HTTPS, Header/CSP, Dev-Modus aus (N-01 bis N-05)
- Backup täglich plus Monatssnapshot, Restore-Test einmal vor Go-live (N-06, N-07)
- Datenschutzerklärung und Auftragsbearbeitungsvertrag (N-08), Uptime-Monitoring (N-10)

## Nicht im MVP (out)

- Microsoft-SSO (F-31), Genehmigungsstufen, Angebotsversionen, Preislisten (F-32)
- Öffentliche API (N-14), Lead-Konvertierungs-Workflow mit Quellen (F-06, Vorschlag R2)

## Später (later)

- SharePoint-Anbindung (F-28) und Outlook-Sync (F-11): erst nach Azure-App-Freigabe, dann Test gegen echten Mandanten
- QR-Rechnung (F-15) nach Bankabnahme, Tracking-Seiten (F-18)
- Erweiterte Kennzahlen (F-22), Staging mit CI (N-11), Performance-Messung (N-09)
- Push/PWA produktiv verifizieren (F-30), Team-Chat bleibt bestehen, wird nicht erweitert

## Abnahmekriterien

1. Anmeldung nur mit Konto und Passwort; `/api/dev/session` existiert nicht; Superadmin-Erstpasswort ist gesetzt und geändert.
2. Jede Rolle sieht und darf nur, was die bestätigte Rechtematrix erlaubt (Stichprobentest je Rolle).
3. Alle Daten liegen in MySQL; Migrationsskript überführt die Beispiel- und Probedaten ohne Verlust (Zählung je Entität stimmt).
4. Altdaten-Probeimport in Staging/Test-Schema wurde von Pascal und Marco geprüft und freigegeben.
5. Kernfluss ohne Fehler: Kunde anlegen, Offerte, Auftragsbestätigung, Rechnung (Nr. fortlaufend ab 60000, MWST korrekt, Storno statt Löschen), PDF-Druck.
6. Tägliches Backup läuft automatisch; ein Restore in die Test-DB wurde protokolliert durchgeführt und die Daten sind vollständig.
7. Zertifikats-, Kalender- und FX-Cron laufen auf dem Server (Logeintrag je Lauf).
8. Domain mit gültigem TLS-Zertifikat erreichbar; Sicherheits-Header und CSP aktiv; Uptime-Alarm löst bei Test aus.
9. Audit-Log zeigt Änderungen mit Benutzer und Zeit.
10. Datenschutzerklärung veröffentlicht, Auftragsbearbeitungsvertrag unterzeichnet.
11. Alle vorhandenen Testskripte (`npm run test:*`) laufen gegen den MySQL-Adapter grün.

## Offene Entscheidungen für den Kunden (max. 5)

1. Welche Software nutzt STPS heute, in welchem Exportformat und mit wie vielen Datensätzen (Kunden, Lieferanten, Offerten, Rechnungen)?
2. Bestätigt ihr die Backup-Regel: täglich 30 Tage, dazu monatlicher Snapshot für 10 Jahre?
3. Welche Rechtematrix gilt (wer sieht EK-Preise, wer darf löschen, exportieren, Management-Chat, Freigaben)?
4. Welches Go-live-Datum gilt (Vertrag 23.11.?), und wer setzt `CRM_PASSWORD`/`CRM_SECRET` und schaltet den Dev-Modus ab?
5. Soll es eine Staging-Umgebung geben (zweite DB-Instanz, ca. CHF 40 statt 21 pro Monat), und unter welcher Domain und Absenderadresse läuft das CRM (z. B. crm.stps.ch)?
