# 09 – Datenschutz nach revDSG (MASTERPLAN Phase 8.3)

> **Hinweis: Dies ist keine Rechtsberatung.** Entwurf aus technischer Sicht (Stand 2026). Vor Produktivbetrieb durch Treuhänder/Anwalt (bzw. Datenschutzberater) prüfen lassen, insbesondere Aufbewahrung, Verträge und Meldepflichten.

## 1. Ausgangslage

- B2B-CRM (Kunden, Lieferanten, Ansprechpersonen, Rechnungen, Versand, Zertifikate, Chat, Kalender). Personendaten: Name, Funktion, E-Mail, Telefon, Adresse von Ansprechpersonen; Mitarbeiterkonten (Benutzername, Anzeigename, E-Mail, Login-Zeiten, Änderungsprotokoll, Outlook-Verbindung).
- Keine besonders schützenswerten Daten vorgesehen; Freitextfelder/Chat nicht dafür verwenden (Regel in Schulung).
- Hosting: Infomaniak (CH) VPS + MySQL; SharePoint (Microsoft 365) nur für Dokumente. Kundendaten müssen nicht in der Schweiz bleiben, Standort CH ist aber der einfachste Weg (kein Drittlandtransfer für die Hauptdatenbank).
- Gilt zusätzlich die DSGVO (Kunden/Ansprechpersonen im EWR, Art. 3 Abs. 2)? Wahrscheinlich teilweise – Prüfung durch Anwalt; die Massnahmen unten genügen i. d. R. beiden.

## 2. Entwurf Bearbeitungsverzeichnis (Art. 12 revDSG)

Verantwortlicher: SwissTech Precision Solutions (Adresse, Kontakt, ggf. Datenschutzverantwortliche/r eintragen). Die Pflicht entfällt grundsätzlich bei <250 Mitarbeitenden und geringem Risiko – wird empfohlen trotzdem zu führen.

| Nr. | Bearbeitung | Zweck | Betroffene | Datenkategorien | Empfänger / Auftragsbearbeiter | Aufbewahrung | Standort | Sicherheit |
|---|---|---|---|---|---|---|---|---|
| 1 | Kunden-/Lieferantenstamm, Ansprechpersonen | Vertragsabwicklung, Kundenpflege | Ansprechpersonen Kunden/Lieferanten | Name, Funktion, E-Mail, Tel., Adresse, Notizen | Infomaniak (Hosting) | Dauer der Geschäftsbeziehung; Löschprüfung jährlich | CH | TLS, Zugriffsrollen, Backup |
| 2 | Offerten, Deals, Aufträge, Rechnungen, Versand | Vertragserfüllung, Buchhaltung | wie 1 | Geschäftsdaten, Beträge, Lieferadressen | Infomaniak; Treuhänder; ggf. Spediteure | **10 Jahre ab Ende Geschäftsjahr** (OR 958f) | CH | wie 1 |
| 3 | Zertifikate/Dokumente | Nachweis, Qualität | Ansprechpersonen, Mitarbeitende | Dokumente mit Namen | Infomaniak; Microsoft (SharePoint) | je Dokumenttyp, ggf. 10 Jahre | CH / Microsoft-Region | Zugriffsrechte SharePoint |
| 4 | Benutzerkonten, Login, Änderungsprotokoll | Zugriffsschutz, Nachvollziehbarkeit | Mitarbeitende | Benutzername, Name, E-Mail, Login-Zeit, Änderungen | Infomaniak | Konto bis Austritt; Protokoll 12 Monate (Entwurf) | CH | Hash (scrypt), Rollen |
| 5 | Chat, Aufgaben, Kalender, Outlook-Anbindung | interne Zusammenarbeit | Mitarbeitende, Termin-Teilnehmende | Nachrichten, Termine, Outlook-Token (verschlüsselt) | Infomaniak; Microsoft (Graph) | Chat 12–24 Monate (Entwurf) | CH / Microsoft | Verschlüsselung Tokens |
| 6 | Push-/E-Mail-Benachrichtigungen | Information | Mitarbeitende | E-Mail, Push-Endpunkt | Push-Dienst des Browsers, Mailversand | bis Widerruf | Drittanbieter | Opt-in |
| 7 | Backups | Verfügbarkeit | alle | Kopie von 1–5 | Infomaniak | rollierend 30 Tage App-Backup; Server-Backup definieren | CH | verschlüsselt |

## 3. Auftragsbearbeitung (Art. 9 revDSG)

- **Infomaniak (VPS, MySQL, ggf. Backup/Mail)**: Auftragsbearbeitungsvertrag (Data Processing Agreement) abschliessen/prüfen – Infomaniak stellt ihn online bereit. Inhalte: Weisungsgebundenheit, Vertraulichkeit, TOMs, Unterauftragsbearbeiter, Löschung/Rückgabe, Audit-Recht, Meldung von Verletzungen. Rechenzentren CH; Standort im Vertrag festhalten.
- **Microsoft (SharePoint/M365/Graph/Outlook)**: Microsoft Products and Services DPA im Rahmen des Volumenlizenzvertrags; Datenstandort des Tenants (Schweiz/EU) prüfen; Datenübermittlung in die USA nur auf Basis Angemessenheitsbeschluss (Swiss-US Data Privacy Framework, Zertifizierung von Microsoft prüfen) oder Standardvertragsklauseln; Transfer Impact Assessment dokumentieren. Nur Dokumente nach SharePoint, keine Stammdaten-Exporte mit Personenlisten ohne Bedarf (heutiger Excel-Export prüfen).
- Weitere: Push-Dienste, E-Mail-Versand, ggf. Wechselkurs-API (EZB, keine Personendaten). Liste Unterauftragsbearbeiter führen.
- Verträge in einem Register (Anbieter, Datum, Standort, Kündigungsfrist) ablegen.

## 4. Betroffenenrechte: Auskunft, Berichtigung, Löschung (Art. 25 ff.)

Frist Auskunft: **30 Tage**, grundsätzlich kostenlos. Prozess:
1. Anfrage entgegennehmen, Identität prüfen, im Register erfassen.
2. Suche über alle Orte: DB (Ansprechpersonen in Kunden/Lieferanten/Deals/Rechnungen), Dateien/Chat, SharePoint, Backups, Outlook-Kalender, Protokoll.
3. Auskunft als PDF/CSV (Daten, Zweck, Herkunft, Empfänger, Aufbewahrungsdauer).
4. Löschung/Berichtigung: soweit keine gesetzliche Pflicht entgegensteht. **Rechnungsrelevante Daten bleiben 10 Jahre** (OR 958f) → Sperrung/Einschränkung statt Löschung, Dokumentation der Begründung. Datenschutzdaten nach Fristende automatisch löschen.
- **Technisch heute**: keine Funktion «Person suchen/exportieren/anonymisieren». To-do für CRM: Volltextsuche über Personen, Export je Person (JSON/CSV), «Anonymisieren»-Aktion (Name/E-Mail/Tel. ersetzen, Rechnungsbezug bleibt), Löschprotokoll. Datenportabilität (Art. 28) deckt der Export ab.
- Backups: Löschung wirkt über Rotation (30 Tage); in der Auskunft/Datenschutzerklärung erwähnen.

## 5. Datensicherheit & Privacy by Design (Art. 7–8, DSV)

Massnahmen (Details und Befunde in `06-sicherheit-rollen.md`):
- Zugriffskontrolle: Rollen/Mandanten, Prinzip der minimalen Rechte (heute nur admin/member → Ausbau nötig), MFA für Admins.
- Verschlüsselung: TLS überall, Passwort-Hashing scrypt, Outlook-Tokens verschlüsselt; Verschlüsselung der DB/Backups at rest (Infomaniak Disk/Backup-Verschlüsselung prüfen).
- Protokollierung: Änderungsprotokoll vorhanden; ergänzen um Logins, Exporte, Rechteänderungen, Löschungen (DSV verlangt Protokollierung bei automatisierter Bearbeitung grosser Mengen/schützenswerter Daten – Einschätzung Anwalt); Aufbewahrung 1 Jahr, getrennt vom Produktivsystem.
- Verfügbarkeit: tägliche Backups extern, Restore-Test halbjährlich, Wiederanlaufplan.
- Datenminimierung/Voreinstellungen: nur nötige Felder, keine Freitext-Sensibeldaten, Dev-Modus/Beispieldaten nie in Produktion, Testdaten anonymisiert.
- Organisatorisch: Vertraulichkeitsverpflichtung, Schulung, Offboarding (Konto deaktivieren am letzten Tag), Gerätesicherheit.
- Datenschutz-Folgenabschätzung (Art. 22): bei diesem B2B-Umfang voraussichtlich nicht nötig; Begründung kurz dokumentieren.
- Datenschutzerklärung (Art. 19) für Kunden/Lieferanten/Webauftritt und interne Information der Mitarbeitenden (Protokollierung, Chat).

## 6. Aufbewahrung vs. Löschung

| Datenart | Frist | Grundlage / Vorschlag |
|---|---|---|
| Buchungsbelege, Rechnungen, Geschäftsbücher, Korrespondenz mit Rechnungsbezug | **10 Jahre** ab Ende des Geschäftsjahres | OR 958f; Geschäftskorrespondenz teils ebenso (Treuhänder bestätigen) |
| Offerten/Anfragen ohne Abschluss | 2–3 Jahre (Entwurf) | berechtigtes Interesse; danach löschen/anonymisieren |
| Stammdaten inaktiver Kunden | 2 Jahre nach letzter Aktivität, sofern keine Rechnungen (sonst gesperrt bis 10 Jahre) | Entwurf |
| Zertifikate/Qualitätsnachweise | gemäss Produkt-/Kundenanforderung (oft 10 Jahre) | prüfen |
| Mitarbeiterkonten | bis Austritt, danach Sperre, Löschung nach 12 Monaten (Protokoll-Referenz anonymisieren) | Entwurf |
| Änderungs-/Zugriffsprotokoll | 12 Monate | Entwurf |
| Chat | 12–24 Monate | Entwurf |
| App-Backups | 30 Tage rollierend | `db.mjs:7`; Server-Backups separat definieren |
- Technisch umzusetzen: Aufbewahrungsattribut je Datensatz («gesperrt bis»), jährlicher Löschlauf mit Bericht, Konflikt «Löschwunsch vs. 10 Jahre» → Sperrvermerk statt Löschung. Heute: Audit nur rollierend 2000 Einträge (`audit.mjs:10`), keine Löschläufe.

## 7. Verletzung der Datensicherheit – Meldung an den EDÖB (Art. 24)

- Meldepflicht: sobald voraussichtlich **hohes Risiko** für Persönlichkeit/Grundrechte der Betroffenen; **«so rasch als möglich»** an den EDÖB (Online-Meldeformular). Information der Betroffenen, wenn zu ihrem Schutz nötig oder vom EDÖB verlangt. Auftragsbearbeiter meldet dem Verantwortlichen **so rasch wie möglich** (im AVV Frist festlegen, z. B. 24 h).
- Ablauf (Entwurf): 1) Erkennen/Eindämmen (Konten sperren, `tokenVersion` erhöhen, `CRM_SECRET` rotieren, Zugang trennen); 2) Beweise sichern (Logs, DB-Snapshot); 3) Risiko bewerten (Datenarten, Anzahl, Verschlüsselung); 4) Entscheid Meldung innert 24–72 h, Dokumentation auch bei Nicht-Meldung; 5) Meldung EDÖB / Betroffene / ggf. DSGVO-Aufsicht (72 h) ; 6) Nachbearbeitung.
- Intern: Verantwortliche Person, Notfallkontakte, Vorlage Meldeformular, jährliche Übung.

## 8. Offene Punkte / To-do

1. Verantwortliche/n Datenschutz benennen; Bearbeitungsverzeichnis finalisieren.
2. AVV Infomaniak und Microsoft DPA prüfen/ablegen; Datenstandort M365-Tenant klären.
3. Lösch- und Aufbewahrungskonzept mit Treuhänder abstimmen (OR 958f).
4. Funktionen: Personensuche/-export/-anonymisierung, erweitertes Protokoll, Löschlauf.
5. Datenschutzerklärung und Mitarbeiterinformation.
6. Prüfen, ob DSGVO anwendbar ist (EU-Kunden) → ggf. Vertretung/Zusatzpflichten.
