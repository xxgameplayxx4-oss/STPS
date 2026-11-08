# 03 Anforderungen (Stand 2026-11-08)

Grundlage: MASTERPLAN Phase 2, Plan Schritte 1-3 und Code in `stps-crm/` (Netlify Functions + Blobs, Vanilla-JS). Status = was der Code heute tut. Priorität = MoSCoW für den Go-live auf Infomaniak (MySQL + VPS). Release: MVP = Go-live, R2 = danach.

## Funktionale Anforderungen

| ID | Anforderung | Status | Prio | Bemerkung (Code) |
|---|---|---|---|---|
| F-01 | Firmen- und Privatkunden verwalten (Nr., Kategorie, Status, Verantwortliche/r) | vorhanden | Must | `customers`, Status Lead/Prospect/Aktiv/Inaktiv/Verloren |
| F-02 | Mehrere Kontaktpersonen und Lieferadressen je Kunde/Lieferant | vorhanden | Must | Hauptkontakt, mailto/tel |
| F-03 | Kundenhistorie, Notizen, Aktivitäten, Dokumente | teilweise | Must | Aktivitäten/Verlauf ja; Dateien nur Bereich `files.mjs`, kein Versionsstand |
| F-04 | Lieferanten, RFQs, Lieferantenzuordnung | vorhanden | Must | `suppliers`, `rfqs` |
| F-05 | Zertifikate mit Ablaufwarnung | vorhanden | Should | `cert-alerts` (Cron) |
| F-06 | Lead-Erfassung, Qualifizierung, Zuweisung, Quelle, Konvertierung | teilweise | Should | nur Kundenstatus "Lead"; keine Quelle, kein Konvertierungs-Workflow |
| F-07 | Sales-Pipeline: Phasen, Wert, Wahrscheinlichkeit (20/40/60/80), Owner | vorhanden | Must | Liste, Kanban, Board |
| F-08 | Erwartetes Abschlussdatum und Umsatzprognose | teilweise | Should | Dashboard vorhanden; Prognose gewichtet ungeprüft |
| F-09 | Aufgaben, Wiedervorlagen, Aufgabenlog | vorhanden | Must | `tasks`, `tasklog` |
| F-10 | Kalender, Termine, Erinnerungen (Push/Mail) | vorhanden | Should | `calendar-reminders`; Push/Cron auf echter Umgebung ungetestet |
| F-11 | Outlook-Kalender-Sync pro Benutzer | teilweise | Could | implementiert, nie gegen echten Mandanten getestet |
| F-12 | Offerten: Positionen, Preise/Rabatt, Status, Druck/PDF | teilweise | Must | PDF nur per Browser-Druck (`window.print`); keine Versionierung |
| F-13 | Angebotsfreigabe (Marco) | teilweise | Should | Entität `approvals`, kein erzwungener Workflow |
| F-14 | Auftragsbestätigung und Rechnungen (ab Nr. 60000, CHF/EUR/USD, MWST, Storno statt Löschen) | vorhanden | Must | `billing`, `invoices` |
| F-15 | QR-Rechnung | teilweise | Should | `qrbill.js`, Bankabnahme offen |
| F-16 | Artikel/Warengruppen, Kategorien | vorhanden | Must | Taxonomie-Matrix noch offen |
| F-17 | Wechselkurse | vorhanden | Could | `fx-rates` (Cron) |
| F-18 | Logistik/Sendungen mit Tracking | vorhanden | Could | `shipments`; Absender-Sichtbarkeit offen |
| F-19 | Globale Suche (Ctrl+K), CSV-/Excel-Export | vorhanden | Should | |
| F-20 | Excel-Import (Vorlage v1.0) mit Vorschau/Merge | vorhanden | Must | `xlsx-import` |
| F-21 | Import aus Fremdsoftware (Altdaten) | fehlt | Must | Format unbekannt |
| F-22 | Dashboard / Kennzahlen (Pipeline, Mitarbeiter, Conversion) | teilweise | Should | Dashboard da; Conversion/Performance je Person fehlt |
| F-23 | Team-Chat, Anwesenheit | vorhanden | Could | inkl. Management-Kanal |
| F-24 | Benutzer, Rollen (Superadmin/Team-Admin/Mitglied), Einmalpasswörter | vorhanden | Must | |
| F-25 | Feingranulare Rechtematrix (EK-Preise, Löschen, Export je Rolle) | fehlt | Must | nur Admin/Management-Flag |
| F-26 | Mandanten (Teams) mit getrennten Daten, Branding je Team | vorhanden | Should | |
| F-27 | Audit-Log (wer/was/wann) | vorhanden | Must | `audit.mjs`; Aufbewahrung noch offen |
| F-28 | SharePoint-Export/-Import (Graph) | teilweise | Could | nie gegen echten Mandanten getestet |
| F-29 | DE/EN-Oberfläche | vorhanden | Should | `check:i18n` |
| F-30 | PWA / Web-Push | teilweise | Could | auf echter Umgebung ungetestet |
| F-31 | Microsoft-SSO | fehlt | Could | |
| F-32 | Produktkatalog-Preislisten, Genehmigungsstufen, Angebotsversionen | fehlt | Won't (MVP) | R2 |

## Nichtfunktionale Anforderungen

| ID | Anforderung | Status | Prio | Bemerkung |
|---|---|---|---|---|
| N-01 | Daten in MySQL (Transaktionen, Indizes) statt JSON-Blob je Team | fehlt | Must | heute `db.mjs` + Blobs, optimistische Versionierung |
| N-02 | Betrieb als Node-Server auf VPS (statt Netlify Functions) inkl. Server-Cron | fehlt | Must | Cron: Zertifikate, Kalender, FX, Outlook, SharePoint |
| N-03 | Authentifizierung: Konten, gesalzene Passwörter, signierte Tokens, Login-Throttle | vorhanden | Must | `CRM_SECRET` Pflicht |
| N-04 | Dev-Modus (ohne Passwort) im Produktivbetrieb deaktiviert | teilweise | Must | automatisch bei gesetztem `CRM_PASSWORD`; Go-live-Check nötig |
| N-05 | Sicherheits-Header, strenge CSP, TLS/HTTPS, noindex | teilweise | Must | Header in `netlify.toml`; auf VPS (Reverse Proxy) nachbauen |
| N-06 | Backup täglich; Aufbewahrung 30 Tage + Monatssnapshot 10 Jahre | teilweise | Must | täglich/30 Tage vorhanden; Monatssnapshot und DB-Dump fehlen |
| N-07 | Restore-Test (quartalsweise, protokolliert) | fehlt | Must | |
| N-08 | Datenschutz DSG: Datenschutzerklärung, Auftragsbearbeitungsvertrag, Löschkonzept | fehlt | Must | Rechnungen 10 Jahre vs. Löschwunsch |
| N-09 | Performance: Seitenaufbau unter 2 s, Listen unter 1 s bei ca. 10'000 Datensätzen | fehlt | Should | nie gemessen; heute ganzes Dokument im Browser |
| N-10 | Verfügbarkeit mit Uptime-Monitoring und Alarm | fehlt | Should | Zielwert offen (Vorschlag 99 %) |
| N-11 | Staging-Umgebung und CI (Tests, Deploy) | teilweise | Should | 15 Testskripte vorhanden, keine CI |
| N-12 | Wartbarkeit: kein Build-Schritt, Tests, i18n-Check | vorhanden | Should | |
| N-13 | Bedienbarkeit: responsiv, Handy-Seitenpanel, Tastaturkürzel | vorhanden | Should | |
| N-14 | Schnittstellen: REST-API `/api/*`, Excel/CSV, Graph | teilweise | Could | keine dokumentierte öffentliche API |
| N-15 | Skalierung auf mehrere Teams/Benutzer | teilweise | Could | Mandantenfähig, aber Blob-Modell begrenzt |
| N-16 | Mail-Versand (System-Mails) über eigenen SMTP/Resend | teilweise | Should | Resend-Code vorhanden, Domain/Absender offen |
