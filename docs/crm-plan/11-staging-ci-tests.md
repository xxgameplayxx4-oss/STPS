# 11 – Staging, CI und Tests

## Ziel
Jede Änderung wird automatisch getestet und vor dem Live-Gang auf einer Staging-Umgebung geprüft, die der Produktion möglichst gleicht – mit **eigenen** Daten (nie die Produktions-DB).

## Staging-Varianten

| Variante | Aufbau | Vor-/Nachteile |
|---|---|---|
| **A: zweiter VPS (empfohlen)** | Kleiner Infomaniak-VPS mit identischem Setup (nginx, systemd, Node 20) + eigene MySQL-Datenbank `stps_staging`, Domain z. B. `staging.crm.example.ch`, `DB_NAME` und `CRM_SECRET` abweichend | Identisch zur Produktion (inkl. MySQL, Zeitpläne); Zusatzkosten |
| **B: Netlify-Deploy-Preview** | Pull Request erzeugt automatisch eine Vorschau-URL (Netlify-Blobs-Speicher) | Gratis und schnell für UI-Prüfung; testet aber **nicht** MySQL und den Node-Server |
| C: Staging auf dem Produktions-VPS | Zweite systemd-Instanz (anderer Port, eigene DB) | Nur Notlösung: teilt Ressourcen und Risiko |

Regeln für Staging: eigene `.env` (`/etc/stps-crm.env` auf dem Staging-Server), `ENABLE_SCHEDULES=0` solange keine echten Mails/Push versendet werden sollen (kein `RESEND_API_KEY`, keine VAPID-Schlüssel), Testdaten statt Kundendaten. Für Realitätsnähe darf ein anonymisierter Export per `npm run migrate:mysql -- --from file --file export.json` eingespielt werden.

## Branch-Flow
1. Feature-Branch `feature/<thema>` von `main` abzweigen.
2. Pull Request nach `staging` (oder direkt nach `main`, wenn klein) – GitHub-Actions-CI läuft (`.github/workflows/ci.yml`).
3. Merge nach `staging` → auf dem Staging-VPS `bash stps-crm/ops/deploy/deploy.sh staging`. Fachliche Abnahme durch Pascal/Team.
4. Merge `staging` → `main` (nach grüner CI und Abnahme).
5. Produktion: `bash stps-crm/ops/deploy/deploy.sh main`; bei Problemen Rollback laut Dokument 12.
6. `main` ist geschützt: nur per Pull Request mit grüner CI.

## CI (GitHub Actions)
Datei `.github/workflows/ci.yml`, Node 20, Arbeitsverzeichnis `stps-crm`:
- `npm ci`
- `npm run check:i18n`
- alle `npm run test:*` (werden automatisch aus `package.json` ermittelt, neue Tests laufen ohne Anpassung mit)
- MySQL-8-Service-Container mit `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`; `test:kv` prüft dann zusätzlich den MySQL-Speicher (ohne `DB_*` wird dieser Teil übersprungen).

## Testliste

| Skript | Prüft |
|---|---|
| `check:i18n` | Übersetzungsschlüssel vollständig/konsistent |
| `test:chat` | Team-Chat, Push-Logik |
| `test:files` | Datei-Ablage, Upload-Grenzen |
| `test:wp5` / `test:wpc` | Kernlogik Arbeitspakete (Benutzer, Rollen, Teams) |
| `test:calendar` | Kalender, Erinnerungen |
| `test:outlook` | Outlook-Synchronisation |
| `test:tasklog` | Aufgaben-Protokoll |
| `test:hide-super` | Ausblenden des Superadmins |
| `test:billing-docs` / `test:qrbill` | Rechnungsdokumente, QR-Rechnung |
| `test:devmode` | Entwicklungsmodus ohne Passwort |
| `test:sample` | Beispieldaten |
| `test:fx` | Wechselkurse |
| `test:shipments` | Sendungen |
| `test:kv` | Speicher-Vertrag (In-Memory und, falls `DB_*` gesetzt, MySQL) |

## Smoke-Test nach jedem Deploy (manuell, 2 Minuten)
1. `curl -fsS https://<domain>/healthz` → `ok`
2. `https://<domain>/api/ping` antwortet (JSON, `dev:false` in Produktion)
3. Anmelden, Kunde anlegen, Seite neu laden → Daten bleiben erhalten
4. `journalctl -u stps-crm -n 50` ohne Fehler; Zeitpläne beim Start aufgelistet
