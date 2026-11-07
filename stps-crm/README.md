# KGC CRM

Internes CRM, entstanden für **SwissTech Precision Solutions** (Pascal = Kunden & Closing, Liz = Lieferanten & RFQs, Marco = Admin & Freigaben). Das Produkt heisst **KGC CRM**; jedes Team kann Logo, Farbe und Namen einstellen (siehe *Darstellung je Team*), SwissTech behält seine bisherigen Logos.
Abgeleitet aus der Excel-Vorlage `STPS_CRM_v.1.0` (Kunden, Angebote, Lieferanten, Lieferantenzuordnung, Aktivitäten, Aufgaben, Übersicht/Shopfloor).

- Reines HTML/CSS/JavaScript (ES-Module), **kein Build-Schritt**, keine externen Ressourcen.
- **Deutsch und Englisch:** Oben rechts (und auf dem Anmeldebildschirm) wechselt der Schalter «DE | EN» die Sprache, ohne Neuladen und ohne dass ungespeicherte Eingaben verloren gehen. Die Wahl wird pro Browser gespeichert (`localStorage` «stps-crm:lang», Standard Deutsch). Gespeicherte Daten (Phasen, Status, Excel-/CSV-Spalten) bleiben deutsch, nur die Anzeige wird übersetzt. Texte stehen in `js/i18n/de.js` und `js/i18n/en.js`; `npm run check:i18n` prüft, dass beide Sprachen dieselben Schlüssel haben und im Code keine deutschen Texte ausserhalb der Wörterbücher stehen.
- Gemeinsame Daten über eine Netlify Function + Netlify Blobs. **Jede Person hat ein eigenes Konto** (Benutzername + Passwort, Rollen Superadmin / Team-Admin / Mitglied); mehrere **Teams** mit strikt getrennten Daten sind möglich.
- **Zusammenarbeit:** Seite *Team* (wer ist online, woran gerade gearbeitet wird, «bearbeitet gerade»), ein **Änderungsprotokoll** (wer hat was wann geändert) und der *Verlauf* pro Kunde/Lieferant.
- Mehrere Kontaktpersonen pro Kunde und Lieferant (Hauptkontakt, E-Mail/Telefon als `mailto:`/`tel:`-Links), Lieferantennotizen, Aktivitätsverlauf.
- **Outlook-Kalender:** Jeder Benutzer verbindet seinen eigenen Outlook-Kalender (Microsoft-Anmeldung, alle 15 Minuten Abgleich Outlook → Team-Kalender, optional auch CRM → Outlook; private Termine nur als «Beschäftigt») – Einrichtung durch den Administrator in [OUTLOOK-SETUP.md](OUTLOOK-SETUP.md).
- **Excel & SharePoint:** Excel-Import (Vorlage `STPS_CRM_v.1.0`) mit Vorschau, Excel-Download und optionale Anbindung an Microsoft SharePoint (stündlicher Export, Import auf Knopfdruck; Einrichtung und Import nur für den Superadmin) – siehe [SHAREPOINT-SETUP.md](SHAREPOINT-SETUP.md).
- **Oberfläche:** Befehlspalette (Strg/Cmd + K oder «/»: Kunden, Lieferanten, Artikel, Angebote, Rechnungen, Aufgaben, Aktionen), Pipeline-Board der Angebote (Umschalter «Liste | Board», Drag & Drop oder Phasenmenü) und ein einziges Seitenpanel für alle Formulare (520 px, «wide» 720 px, auf dem Handy als Blatt). Gemeinsame Design-Token stehen in `app.css`.
- **Belege (Offerte, Rechnung):** zeigen immer die Darstellung des Teams, zu dem sie gehören – eigenes Logo, sonst nur den Firmennamen (Firmenangaben, sonst Anzeigename des Teams) als Überschrift. «KGC CRM» ist der Produktname und erscheint nie auf einem Beleg (auch nicht, wenn der Superadmin das Team betreten hat).

## Deploy auf Netlify

1. **Add new site → Import from Git**, Branch `claude/stps-crm`.
2. **Base directory:** `stps-crm` (Build command leer lassen; Publish `.` und Functions `netlify/functions` kommen aus `netlify.toml`).
3. **Environment variables** (Site configuration → Environment variables):
   - `CRM_SECRET` – **Pflicht**, langer Zufallswert (mindestens 16 Zeichen, z. B. `openssl rand -hex 32`) zum Signieren der Login-Tokens. Fehlt er oder ist er zu kurz, antwortet die API mit einer Fehlermeldung (es gibt keinen Ersatzschlüssel mehr).
   - `CRM_PASSWORD` – Passwort für die **Erst-Anmeldung des Superadmins**. Wird nur gebraucht, solange es noch keine Benutzer gibt; danach hat es keine Wirkung mehr und kann aus Netlify entfernt werden – ausser für die Notfall-Wiederherstellung unter «Superadmin-Passwort vergessen».
   - `CRM_ADMIN_USER` – *optional*, Benutzername des Superadmins (Standard `admin`).
   - `CRM_ADMIN_RESET` – *optional, nur im Notfall:* Zufallswert, mit dem das Superadmin-Passwort zurückgesetzt werden kann (siehe «Superadmin-Passwort vergessen»). Normalerweise nicht gesetzt.
   - `SP_TEAM_ID` – *optional*, Team, für das die SharePoint-Anbindung gilt (siehe «Bekannte Einschränkungen»).
4. *Optional:* SharePoint-Anbindung (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SP_SITE`, `SP_IMPORT_PATH`, `SP_EXPORT_FOLDER`, optional `SP_DRIVE`) – Schritt für Schritt in [SHAREPOINT-SETUP.md](SHAREPOINT-SETUP.md). Ohne diese Variablen bleibt die Funktion ausgeschaltet; die App läuft wie bisher.
5. *Optional:* Chat- und Kalender-Benachrichtigungen (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; E-Mail-Ersatz `RESEND_API_KEY`, `MAIL_FROM`) – siehe «Chat, Benachrichtigungen, App». Ohne diese Variablen bleibt die Funktion ausgeschaltet.
6. Deploy. Netlify Blobs braucht keine weitere Einrichtung.

## Entwicklungsmodus (ohne Passwort)

In der Entwicklungsphase soll das CRM **kein Passwort** verlangen. Deshalb gilt: **Ist `CRM_PASSWORD` nicht gesetzt**, läuft der Server im Entwicklungsmodus (Code: `netlify/functions/lib/devmode.mjs`):

- Es gibt keine Anmeldeseite. `GET /api/dev/session` liefert eine Sitzung; Anfragen ohne gültiges Token laufen als Pascal (Team-Admin). `CRM_SECRET` ist dann optional – fehlt es, gilt ein fester interner Entwicklungs-Schlüssel.
- Gibt es noch keine Konten, wird das Team **SwissTech Precision Solutions** mit den Konten `admin` (Superadmin), `Pascal` (Team-Admin), `Liz` und `Marco` (Mitglieder, Geschäftsleitung) angelegt. Ihre Passwörter sind zufällig und unbekannt.
- Oben erscheint dauerhaft der Hinweis «Entwicklungsmodus – ohne Passwort. Nur Beispieldaten verwenden.»; in der Kopfzeile wechselt ein **Rollenwechsler** (admin / Pascal / Liz / Marco) die Rolle. «admin» betritt das Team als Superadmin.
- **Ist `CRM_PASSWORD` gesetzt, ändert sich nichts:** Anmeldung ist Pflicht, `/api/dev/session` existiert nicht, der Entwicklungs-Schlüssel wird nie akzeptiert. Ebenso bleibt die Anmeldung Pflicht, sobald sich je ein echtes Konto angemeldet hat (z. B. nach der Erst-Anmeldung, wenn `CRM_PASSWORD` später entfernt wurde), oder wenn `CRM_DEV_MODE=off` gesetzt ist.
- **Vor dem Produktivbetrieb `CRM_PASSWORD` (und `CRM_SECRET`) setzen** – sonst ist die Site offen. Test: `npm run test:devmode`.

## Erste Einrichtung

1. **Superadmin anmelden:** Mit `CRM_ADMIN_USER` (Standard `admin`) und `CRM_PASSWORD` anmelden. Die App verlangt sofort ein eigenes Passwort (mindestens 10 Zeichen). Danach landet der Superadmin auf der Seite **Plattform**; `CRM_PASSWORD` ist ab jetzt wirkungslos.
2. **Team «SwissTech Precision Solutions»:** Wurde das CRM schon vor der Einführung der Konten benutzt, legt die Migration beim allerersten Superadmin-Login automatisch dieses Team an und verschiebt die vorhandenen Daten (Datenbank, Backups, SharePoint-Metadaten) hinein – nichts geht verloren. Bei einer neuen Installation das Team unter *Plattform → Team anlegen* erstellen.
3. **Pascal als Team-Admin anlegen:** *Plattform →* Team *→ Benutzer → Benutzer*: Benutzername `pascal`, Anzeigename «Pascal», Rolle *Team-Admin*, Verantwortlich-Name (ownerKey) `Pascal`. Das angezeigte **Einmalpasswort** erscheint nur jetzt (mit «Kopieren») und wird Pascal auf sicherem Weg übergeben; er muss es beim ersten Login durch ein eigenes ersetzen.
4. **Liz und Marco anlegen:** Pascal meldet sich an und erstellt unter *Einstellungen → Benutzer verwalten* Liz (`liz`, Rolle *Mitglied*, Verantwortlich `Liz`) und Marco (`marco`, *Mitglied*, Verantwortlich `Marco`) und gibt ihnen deren Einmalpasswörter weiter.

Der Verantwortlich-Name entscheidet, wie eine Person in den Auswahllisten «Verantwortlich/Owner» heisst und wer bei neuen Einträgen vorgeschlagen wird. Die Liste «Team / Verantwortliche» folgt den aktiven Mitgliedern automatisch, solange sie nicht von Hand angepasst wurde; bestehende Datensätze behalten ihren Namen.

## Superadmin-Passwort vergessen

Das Superadmin-Passwort lässt sich ohne die App zurücksetzen – ohne Daten zu löschen und ohne andere Konten anzufassen:

1. In Netlify (Site configuration → Environment variables) `CRM_ADMIN_RESET` auf einen **neuen, zufälligen Wert** setzen (z. B. `openssl rand -hex 16`) und `CRM_PASSWORD` auf das gewünschte Einmalpasswort (mindestens 10 Zeichen). Danach **neu deployen**.
2. Mit `CRM_ADMIN_USER` (Standard `admin`) und `CRM_PASSWORD` anmelden. Der Server setzt das Passwort dieses Superadmin-Kontos auf `CRM_PASSWORD` zurück, verlangt beim Login ein **neues eigenes Passwort** und meldet alle bisherigen Sitzungen dieses Kontos ab.
3. Neues Passwort setzen, danach `CRM_ADMIN_RESET` (und `CRM_PASSWORD`) in Netlify **wieder entfernen**.

Jeder `CRM_ADMIN_RESET`-Wert wirkt **genau einmal**: Sein SHA-256-Hash wird im Blob «admin-reset-used» gespeichert; bei einem späteren Notfall braucht es einen neuen Wert. Ohne gesetzte Variable (oder bei leerem Wert) hat das Verfahren keine Wirkung; Team-Konten werden nie zurückgesetzt. Jedes Zurücksetzen steht im Blob «platform-audit» (Zeit, Konto, IP-Adresse) und im Function-Log.

## Konten, Rollen, Teams

| Rolle | Darf |
|---|---|
| **Superadmin** (ein Konto, nur über `CRM_PASSWORD` einrichtbar) | Teams anlegen, umbenennen, deaktivieren; Benutzer in jedem Team anlegen und verwalten; ein Team **betreten** (Support). Gehört keinem Team an. |
| **Team-Admin** | Benutzer des **eigenen** Teams anlegen, ändern (Name, Rolle, Verantwortlich), deaktivieren und deren Passwort zurücksetzen. Der letzte aktive Admin eines Teams kann nicht entfernt oder herabgestuft werden; man kann sich nicht selbst deaktivieren oder zurücksetzen. |
| **Mitglied** | Arbeitet mit den Daten des eigenen Teams, sieht die Team-Seite und das Änderungsprotokoll, ändert das eigene Passwort. |

- **Teams sind strikt getrennt:** Jedes Team hat eigene Daten, Backups, Änderungsprotokoll und Anwesenheit (`t/<teamId>/…` im Blob-Store). Die Team-Zugehörigkeit kommt immer aus dem Konto auf dem Server – nie vom Browser.
- **Superadmin betritt ein Team:** Auf der Plattform *Betreten* (oder der Team-Wechsler oben). Dann erscheint die Leiste «**Superadmin-Ansicht: <Team>**» mit «Team verlassen». Das Betreten und alle Änderungen werden im Team-Protokoll als *Superadmin* vermerkt; der Superadmin erscheint nur dann in der Anwesenheitsliste, wenn er das Team betreten hat. Ohne betretenes Team gibt es für ihn keine Teamdaten, nur die Plattform.
- **Einmalpasswörter:** Neue und zurückgesetzte Konten erhalten ein zufälliges Einmalpasswort (`xxxx-xxxx-xxxx`), das beim nächsten Login geändert werden muss. Bis dahin sind alle anderen Funktionen gesperrt.
- **Deaktivieren, Zurücksetzen, Passwortwechsel** melden das Konto auf allen Geräten ab (Token-Version); bei einem deaktivierten Team gilt das für alle seine Mitglieder. Die Sperre greift auf dem Server innerhalb weniger Sekunden.

## Darstellung je Team (Logo, Farbe, Name)

- **Superadmin: immer «KGC CRM».** Seitenleiste, Titel, Symbol, Farbe und Anmeldeseite des Superadmins sind immer die Standard-Darstellung (Wortmarke, Marineblau, kein Untertitel) – auch im betretenen Team. Was er für ein Team einstellt, sehen nur dessen Mitglieder.
- **Standard eines Teams ohne Einstellungen:** KGC-CRM-Logo (`kgc-logo-full.svg` für helle Hintergründe, `kgc-logo-symbol-white.svg` = KGC-Monogramm für die dunkle Seitenleiste, `kgc-favicon.svg`), Standard-Marineblau und der **Teamname** (Seitenleiste, Titel des Browser-Tabs).
- **Einstellungen → «Darstellung»:** Team-Admins (eigenes Team) und der Superadmin (jedes Team: *Plattform → Team*, oder im betretenen Team) stellen **Logo**, **Farbe** und **Anzeigename** ein, mit Vorschau (Anmeldeseite, Seitenleiste), «Standardfarbe» und «Zurücksetzen» (Logo, Farbe und Name zurück auf den Standard). Mitglieder sehen die Karte nur lesend; die API verweigert ihnen jede Änderung (403).
- **Farbe:** Farbwähler oder Hex-Eingabe (`#rrggbb`, auch `#abc`). Sie ersetzt das Marineblau der Seitenleiste und des Anmeldehintergrunds. Die **Schriftfarbe wird automatisch nach WCAG-Kontrast** gewählt (weiss oder dunkel, Haupt-, Neben- und Hinweistexte mindestens 4,5 : 1; mobile Kopfzeile bleibt lesbar); auf heller Farbe erscheint das KGC-Symbol bzw. das SwissTech-Symbol für helle Hintergründe. Die Farbe wird über CSS-Variablen im CSSOM gesetzt (keine Inline-Styles, die strenge CSP bleibt). Ungültige Farben lehnt der Server mit 400 `bad_color` ab.
- **Logo (Prüfung auf dem Server):** PNG, JPG, SVG oder WebP, höchstens **300 KB**, Rasterbilder höchstens 4096 × 4096 Pixel; der Inhalt muss zum Typ passen. **SVG wird abgelehnt** (nie «bereinigt» gespeichert), wenn es Skripte, `on*`-Ereignisse, `foreignObject`/`iframe`/`object`/`embed`, `@import`, `<!ENTITY>`, externe `href`/`url(...)` oder CSS-Escapes enthält. Bilder erscheinen ausschliesslich als `<img>` (Data-URL, CSP `img-src 'self' data:`), SVG führt dort nie Code aus.
- **Speicherung:** Blob `t/<teamId>/branding` = `{logo, mime, width, height, color?, displayName?, updatedAt, updatedBy}`. API: `GET /api/branding` (jede angemeldete Person, nur das eigene Team), `PUT /api/branding` (`{logo?, color?, displayName?}`; `color: ""` = Standardfarbe) und `DELETE /api/branding` (nur Admin bzw. Superadmin); der Superadmin kann dasselbe unter `/api/teams/<teamId>/branding` für jedes Team. Änderungen stehen im Team-Protokoll (Bereich «Darstellung»: Logo / Farbe / Anzeigename geändert, Darstellung zurückgesetzt).
- **SwissTech:** Das Team «SwissTech Precision Solutions» (das Altdaten-Team der Migration, auch nach einer Umbenennung) bekommt beim ersten Zugriff einmalig die bisherigen Logo-Dateien (`logo-full.svg`, `logo-symbol-white.svg`, `favicon.svg`) und den Namen «STPS CRM» (Untertitel: Teamname) als Anfangsdarstellung, Marineblau; nach einem Zurücksetzen kommt sie nicht wieder. Solche Vorgaben (`preset`) verweisen auf Dateien der Site, nicht auf Bilddaten im Blob.
- **Wo es erscheint (Teammitglieder):** Seitenleiste (Logo + Name, Farbe), Ladeanzeige, Anmeldeseite, Titel der Registerkarte («<Seite> · <Name>»), Farbe der Browserleiste und Symbol (Favicon; das Team-Logo nur, wenn es annähernd quadratisch ist, sonst das KGC-Symbol). Die Anmeldeseite kennt die Person noch nicht und zeigt deshalb die Darstellung des **zuletzt angemeldeten Teams auf diesem Gerät** (Logo, Farbe, Name; `localStorage` «stps-crm:branding», `{teamId, name, Logo ≤ 300 KB}`; bleibt beim Abmelden erhalten, fehlt er oder ist er unbrauchbar: KGC CRM). Der Superadmin speichert immer den Standard.

## Zusammenarbeit

- **Team** (Menü): pro Person online/offline, aktuelle Seite («Kunde 10003 · Müller AG»), Badge «bearbeitet gerade» sobald ein Formular offen ist, *Hingehen* springt zur selben Seite; dazu die letzten 10 Änderungen je Person und ein Gesamt-Feed mit Filtern (Person, Bereich). Der Browser meldet sich alle 30 s (nur bei sichtbarem Tab); wer 2 Minuten nichts meldet, gilt als offline.
- **Kopfzeile:** kleine Avatare der gerade Online-Kolleg:innen; auf der Detailseite eines Kunden/Lieferanten der Hinweis «Liz ist auch hier / bearbeitet gerade».
- **Änderungsprotokoll:** Bei jedem Speichern vergleicht der Server den alten und den neuen Stand und protokolliert pro Datensatz *wer, wann, was* (angelegt/geändert/gelöscht, Feldnamen – keine Werte). Mehr als 25 Änderungen einer Tabelle auf einmal (z. B. Import) werden zu einem Eintrag zusammengefasst. Es bleiben die letzten 2000 Einträge pro Team. Die Stempel *erstellt/geändert von* setzt der Server aus dem Konto; vom Browser gesendete Stempel werden nicht übernommen. Ein Fehler im Protokoll verhindert nie das Speichern.
- **Verlauf** (Kunden-/Lieferantendetail): Änderungen am Datensatz selbst und an seinen Angeboten, Zuordnungen, Aktivitäten und Aufgaben. Angebote haben keine eigene Detailseite; ihre Änderungen erscheinen im Verlauf des Kunden.

## Kalender, Termin-Erinnerungen

- **Aufgaben & Aktivitäten** (ein Menüpunkt, `#/aufgaben-aktivitaeten`): gemeinsame Liste über die unverändert gespeicherten Sammlungen `tasks` und `activities` (keine Datenmigration; Excel/CSV/SharePoint unverändert). Reiter *Offen* (nicht erledigt, nach Fälligkeit), *Erledigt*, *Verlauf* (alles, neueste zuerst); Filter Typ (To-do + Aktivitätstypen), Owner, Status; Suche; Häkchen setzt erledigt/offen; «Aufgabe»/«Aktivität» öffnen das jeweilige Formular im Seitenpanel. Die alten Adressen `#/aufgaben` (→ Offen) und `#/aktivitaeten` (→ Verlauf) leiten weiter. Offene Einträge mit Frist erscheinen im Kalender.
- **Kalender** (Menü «Kalender», nur Servermodus): Monatsraster und Liste (anstehend / vergangen), Tagesübersicht unter dem Raster. Klick auf einen Tag legt einen Termin an (auf dem Handy wählt er zuerst den Tag, «Termin hinzufügen» steht darunter), Klick auf einen Termin öffnet ihn im Seitenpanel zum Ändern oder Löschen. Termine tragen den Akzent der Teamfarbe; Aufgaben-, Rechnungs-Fälligkeiten und Follow-ups aus dem CRM erscheinen grau und schreibgeschützt (abschaltbar) und führen zum Datensatz. Strikt je Team (der Superadmin sieht das betretene Team), Daten unter `t/<teamId>/cal/…`.
- **Termin:** Titel, Datum mit Start-/Endzeit oder ganztägig (bis 31 Tage), Ort, Notizen, Teilnehmer (Mitglieder des Teams; ohne Auswahl gilt der Termin für das ganze Team), Wiederholung (täglich/wöchentlich/monatlich/jährlich, alle *n*, bis Datum oder nach Anzahl) und mehrere Erinnerungen (zum Beginn, 5/10/15/30 Min., 1/2 Std., 1/2 Tage, 1 Woche vorher). Zeiten werden als UTC-ISO gespeichert und im Browser in dessen Zeitzone angezeigt; Wiederholungen rechnet der Server in der Zeitzone des Termins (Standard Europe/Zurich), «jeden Mittwoch 09:00» bleibt also über die Sommerzeit hinweg 09:00. Ganztägige Termine erinnern ab 09:00 Uhr. Änderungen gelten für die ganze Serie; gleichzeitiges Bearbeiten wird über eine Versionsnummer (`rev`) erkannt (409). Alle Mitglieder des Teams dürfen Termine anlegen, ändern und löschen.
  API: `GET /api/calendar?from=<ISO>&to=<ISO>` (höchstens 400 Tage; liefert die aufgelösten Vorkommen, die Termine und die Mitglieder des Teams), `GET|PUT|DELETE /api/calendar/events/<id>`, `POST /api/calendar/events`.
- **Erinnerungen:** Die geplante Function `calendar-reminders.mjs` läuft alle 5 Minuten (`*/5 * * * *`), löst die Wiederholungen aller aktiven Teams auf und verschickt fällige Erinnerungen über denselben Versandweg wie der Chat (`push.mjs`): Web Push an alle Geräte der Teilnehmer, sonst – oder wenn kein Push gelingt – E-Mail über Resend (Zeiten in Europe/Zurich, deutsch und englisch). Doppelversand ist ausgeschlossen: Der Vermerk `t/<teamId>/cal/sent` wird vor dem Versand atomar eingetragen (gleichzeitige Läufe: nur einer sendet) und nach 3 Tagen bereinigt; scheitert jede Zustellung, wird er zurückgenommen und der nächste Lauf versucht es erneut. Eine Erinnerung wird noch bis 15 Minuten nach ihrem Zeitpunkt nachgeholt (ausgefallene Läufe), danach nicht mehr; Erinnerungen, deren Zeitpunkt beim Speichern des Termins schon vorbei war, entfallen. Ein Klick auf die Meldung öffnet den Termin (`#/kalender/<id>`). Ohne VAPID-Schlüssel *und* ohne Resend tut die Function nichts. **Keine neuen Umgebungsvariablen** – es gelten `VAPID_*`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` (siehe nächster Abschnitt). Die Zeit der Function ist UTC; ein Lauf alle 5 Minuten bedeutet, dass eine Erinnerung bis zu 5 Minuten später eintreffen kann.
- **Dateien (WP-A):** `/api/files` (`lib/files.mjs`): hochladen (`POST ?name=&scope=team|mgmt`, rohe Bytes), herunterladen (`GET /api/files/<id>`), löschen. Die Dateien liegen im Blob-Namensraum des Teams (`t/<teamId>/fbin/<id>`, Angaben in `fmeta/<id>`) – andere Teams finden sie nicht (404). Höchstens 10 MB (Netlify Functions nehmen je Anfrage praktisch nur ca. 6 MB an: grössere Dateien scheitern dann mit einem Fehler der Plattform); erlaubt sind PDF, PNG, JPG, WEBP, erkannt an den ersten Bytes (nicht am Namen); Dateinamen werden bereinigt, der Download ist immer ein Anhang mit `nosniff`. Bereich `mgmt` (Chat «Geschäftsleitung») ist nur für Team-Admins/Management-Kennzeichen hochlad- und herunterladbar – der Server prüft das bei jeder Anfrage (403). Datensätze speichern nur den Verweis `{id, name, type, size}`. Im Lokalen Modus (ohne API) liegen Dateien bis 2 MB als Data-URL in `settings.localFiles` der lokalen Datenbank (mit Warnung).
- **Lieferanten-Dokumente (WP-A):** Typ (ISO 9001/14001/13485, Kalibrierzertifikat, Sonstiges), Datei oder Link, ausgestellt am, gültig bis, Intervall in Monaten (schlägt die nächste Fälligkeit vor). «Erneuert» archiviert das alte Dokument (`archiviert: true`) und legt das neue an. Die Übersicht zeigt abgelaufene und innerhalb von 60 Tagen ablaufende Dokumente. Die geplante Function `cert-alerts.mjs` (täglich 06:00 UTC, Logik `lib/cert-alerts.mjs`) benachrichtigt Team-Admins und Management-Benutzer über `deliver()` (Push, sonst E-Mail) je Dokument einmal bei 60, 30 und 7 Tagen vor Ablauf und bei Ablauf; Versandvermerk `t/<teamId>/certs/sent` (vor dem Versand atomar eingetragen, bei gescheiterter Zustellung zurückgenommen, veraltete Einträge werden bereinigt). Keine neuen Umgebungsvariablen.
- **Tests:** `npm run test:calendar` prüft Anlegen/Ändern/Löschen, Validierung, Team-Trennung, Wiederholungen (Sommerzeit, Monatsende, Schaltjahr), Erinnerungen und Doppelversand-Schutz gegen den In-Memory-Store.

## Chat, Benachrichtigungen, App

- **Chat** (Menü «Chat»): ein Kanal je Team. Strikt getrennt: Die API nimmt das Team immer aus dem Konto (der Superadmin wählt es wie überall über «Team betreten»), die Daten liegen im Namensraum `t/<teamId>/chat/…`. Reiner Text (höchstens 2000 Zeichen, wird beim Anzeigen escaped, kein HTML), eigene Nachrichten rechts in der Teamfarbe, Name und Uhrzeit bei den anderen. Speicherung in Segmenten zu 100 Nachrichten (höchstens 50 Segmente = 5000 Nachrichten je Team, ältere werden gelöscht), «Ältere laden» blättert zurück; höchstens 20 Nachrichten pro Minute und Person. Der Browser fragt alle 5 s (Chat offen) bzw. 30 s/90 s (nur Zähler, Tab sichtbar/im Hintergrund) ab; das Menü zeigt die Zahl ungelesener Nachrichten (je Person gemerkt).
  API: `GET /api/chat?since=<id>|before=<id>&limit=&peek=1`, `POST /api/chat {text, cid}`, `POST /api/chat/read {upTo}`.
- **App installieren (PWA):** `manifest.webmanifest` + `sw.js` + Symbole unter `icons/` (erzeugt aus `kgc-favicon.svg` mit `node scripts/make-icons.mjs`, braucht einmalig `npm i --no-save @resvg/resvg-js`). Der Service Worker hält die App-Hülle offline bereit (erst Netz, dann Zwischenspeicher); `/api/*` wird nie zwischengespeichert.
- **Web Push:** Einstellungen → Benachrichtigungen (und Hinweisleiste im Chat) → «Benachrichtigungen aktivieren». Der Server schickt bei jeder neuen Nachricht eine Meldung an alle anderen Mitglieder des Teams mit Push-Abo (ebenso bei fälligen Termin-Erinnerungen, siehe oben); ein Klick öffnet den Chat bzw. den Termin. Abos, die der Push-Dienst mit 404/410 ablehnt, werden entfernt; beim Abmelden wird das Abo dieses Geräts gelöst. **iPhone/iPad:** Push gibt es nur für die zum Home-Bildschirm hinzugefügte App (iOS 16.4+) – in Safari erscheint der Hinweis «Zum Home-Bildschirm hinzufügen».
- **E-Mail-Ersatz:** Mitglieder ohne Push-Abo (oder bei denen kein Push zugestellt werden konnte), aber mit E-Mail-Adresse (Benutzerverwaltung, optionales Feld), erhalten über Resend eine kurze Mail – bei Chat-Nachrichten höchstens eine pro Person und 30 Minuten, Termin-Erinnerungen werden einzeln verschickt.
- **Umgebungsvariablen** (alle optional; fehlt etwas, verschwindet die jeweilige Funktion):
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` – Schlüsselpaar für Web Push, erzeugen mit `npx web-push generate-vapid-keys`. Den privaten Schlüssel geheim halten und nicht mehr ändern (sonst müssen alle Geräte neu aktivieren).
  - `VAPID_SUBJECT` – Kontakt, `mailto:crm@ihre-domain.ch` (oder `https://…`).
  - `RESEND_API_KEY`, `MAIL_FROM` – E-Mail-Ersatz über [Resend](https://resend.com), z. B. `CRM <crm@ihre-domain.ch>` (Absenderdomain bei Resend verifizieren).
  - `APP_URL` – *optional*, Adresse der Site für den Link in der Mail (sonst die von Netlify gesetzte `URL`).
- **Tests:** `npm run test:chat` prüft Chat, Team-Trennung, Push und E-Mail gegen den In-Memory-Store.

## Lokal entwickeln

```bash
cd stps-crm
npm install
npx netlify dev          # statische Seite + /api/* mit lokalem Blobs-Sandbox
```

`CRM_SECRET` (mindestens 16 Zeichen) und `CRM_PASSWORD` dafür in einer `.env`-Datei (ist in `.gitignore`) oder per `netlify env:set` setzen; die erste Anmeldung läuft wie unter «Erste Einrichtung».

Ohne API (z. B. `python3 -m http.server` oder `npx serve`) startet die App im **Lokalen Modus**: Daten liegen nur im `localStorage` dieses Browsers, ein gelbes Banner weist darauf hin.

## Daten, Speichern, Backups

- Die gesamte Datenbank eines Teams ist **ein JSON-Dokument** (`t/<teamId>/db`) im Blob-Store `stps-crm` mit Versionsnummer. Der Client speichert entprellt nach jeder Änderung (Anzeige oben rechts: *Gespeichert / Speichert… / Fehler*) und hält einen Zwischenspeicher im Browser.
- **Gleichzeitige Änderungen:** Das Speichern prüft die Version (`409` bei Konflikt). Die App führt die Änderungen dann automatisch auf Datensatz-/Feldebene zusammen und meldet es («Daten wurden von jemand anderem geändert …»). Ändern zwei Personen *dasselbe Feld*, gewinnt die eigene Eingabe. Doppelt vergebene Nummern werden beim lokal neu angelegten Datensatz auf die nächste freie gesetzt. Änderungen anderer werden alle 45 s bzw. beim Zurückkehren in den Tab übernommen.
- **Nummern** (Kunden ab 10000, Lieferanten 20000, Aktivitäten 30000, Angebote 40000, Aufgaben 50000) werden fortlaufend vergeben und nie wiederverwendet; jeder Datensatz hat zusätzlich eine interne UUID.
- **Server-Backups:** Pro Team und Tag wird der letzte Stand als `backup-JJJJ-MM-TT` gesichert (30 Tage rollierend). Einstellungen → Server-Backups: herunterladen oder wiederherstellen (`GET /api/backups`, `GET /api/backups/<datum>`).
- **Import-Backups:** Vor jedem Excel-Import (Datei oder SharePoint) sichert der Server den bisherigen Stand zusätzlich als `backup-JJJJ-MM-TT-import-HHMMSS` (gleiche 30 Tage; in der Liste mit «vor Import» markiert).
- **Einstellungen → Datensicherung:** komplette Datenbank als JSON exportieren/importieren (ersetzt alles) sowie jede Tabelle als CSV (UTF-8 mit BOM, Semikolon – öffnet direkt im Schweizer Excel). Empfehlung: regelmässig ein JSON-Export zusätzlich ablegen.
- **Beispieldaten:** Einstellungen → «Beispieldaten laden» (nur bei leerer Datenbank).
- **Vollständige Beispieldaten (nur Entwicklungsmodus):** `npm run dev` → Einstellungen → «Vollständige Beispieldaten laden» → «Ersetzen». Lädt `sample/beispieldaten.json` (9 Kunden, 6 Lieferanten, Artikel, Deals, Rechnungen, Chat). Alternativ: Einstellungen → JSON-Import mit dieser Datei.
- Auswahllisten (Team, Quellen, Aktivitätstypen, Kundenstatus) sind unter Einstellungen editierbar; Phasen, Prioritäten und Status mit Berechnungslogik stehen in `js/config.js`.

## Excel & SharePoint

- **Einstellungen → Excel:** *Excel-Datei importieren* liest das Layout der Vorlage `STPS_CRM_v.1.0` (Blätter Kunden, Lieferantenstamm, Lieferanten, Aktivitäten, Angebote, Aufgaben) sowie die eigenen Exporte. Es wird **zusammengeführt**: Kunden/Lieferanten werden über die Nummer, sonst über den Firmennamen erkannt, gefüllte Zellen überschreiben, leere ändern nichts, **gelöscht wird nie**. Vor dem Speichern zeigt eine Vorschau pro Tabelle neu/geändert/übersprungen und Hinweise. Hochladen: bis ca. 4,5 MB (Netlify-Limit pro Anfrage). *Als Excel herunterladen* schreibt alle Tabellen im Vorlagen-Layout (Hauptkontakt in den Originalspalten, dazu «Weitere Kontakte» und ein Blatt «Kontakte»).
- **Einstellungen → Microsoft SharePoint** (nur für den **Superadmin**, im Servermodus und nach Einrichtung): Verbindung testen, *Aus SharePoint importieren* (Datei `SP_IMPORT_PATH`, gleiche Vorschau), *Jetzt nach SharePoint exportieren*. Der Export legt `STPS_CRM_Export_JJJJ-MM-TT.xlsx/.json` und `STPS_CRM_aktuell.xlsx` in `SP_EXPORT_FOLDER` ab und läuft zusätzlich jede Stunde (Netlify Scheduled Function `sharepoint-export`, Cron `0 * * * *`, jeweils zur vollen Stunde; die Datei des Tages und `STPS_CRM_aktuell.xlsx` werden dabei überschrieben).
- **Für Teammitglieder und Team-Admins** gibt es SharePoint-Einstellungen und -Diagnose nicht (der Server antwortet auf `/api/sharepoint/*` mit 403). Nur im Team mit der SharePoint-Anbindung (`SP_TEAM_ID`) und nur wenn alles eingerichtet ist, erscheint unter Einstellungen die schlichte Karte «Excel in SharePoint»: Hinweis auf den automatischen Abend-Upload, «Zuletzt hochgeladen», der Knopf *Jetzt nach SharePoint hochladen* und der Link *SharePoint-Ordner öffnen*. Dafür dienen `GET /api/sharepoint/summary` und `POST /api/sharepoint/export`; alle übrigen SharePoint-Routen sind dem Superadmin vorbehalten (der unauthentifizierte Webhook ausgenommen). Das CRM bleibt das führende System; es gibt keine automatische Rück-Synchronisation.
- Technik: Microsoft Graph mit Client-Credentials (kein Benutzer-Login), Token nur auf dem Server. Die Excel-Verarbeitung nutzt das npm-Paket `exceljs` (in `netlify.toml` als `external_node_modules` eingetragen, weil es nicht ins ESM-Bundle passt).

## Sicherheit

- **Konten statt gemeinsamem Passwort:** Jede Person meldet sich mit eigenem Benutzernamen und Passwort an. Passwörter werden nie im Klartext gespeichert, sondern mit **scrypt** (N=65536, r=8, p=1, pro Konto eigenes Salz; Parameter stehen beim Hash und lassen sich später erhöhen). Mindestlänge 10 Zeichen, kein Passwort darf dem Benutzernamen gleichen. Passwort-Hashes verlassen den Server nie (keine API-Antwort enthält sie).
- **Login-Schutz:** 5 Fehlversuche innerhalb von 15 Minuten sperren den Benutzernamen *und* die IP-Adresse für 15 Minuten (auch mit richtigem Passwort; Meldung «Zu viele Fehlversuche …»). Die Fehlermeldung verrät nie, ob der Benutzername existiert («Benutzername oder Passwort falsch»); unbekannte Namen kosten dieselbe Rechenzeit.
- **Sitzungen:** Signierte Tokens (HMAC-SHA-256 mit `CRM_SECRET`), **7 Tage** gültig. Bei jeder Anfrage prüft der Server Konto, Aktiv-Status, Token-Version und Team-Status – Deaktivieren, Zurücksetzen und Passwortwechsel wirken deshalb sofort (wenige Sekunden Cache). *Alle* abmelden: `CRM_SECRET` ändern und neu deployen.
- **Autorisierung auf dem Server:** Rollen und Team-Zugehörigkeit werden bei jeder Anfrage aus dem Konto bestimmt. Der Header `X-CRM-Team` wird ausschliesslich beim Superadmin beachtet; bei allen anderen wird er ignoriert, ein gefälschter Wert öffnet keine fremden Daten.
- **Transport und Auslieferung:** HTTPS erzwingt Netlify; zusätzlich `Strict-Transport-Security`, eine strenge Content-Security-Policy (nur `'self'`, kein Inline-Skript/-Style), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`. API-Antworten sind `Cache-Control: no-store`. Die Daten liegen in Netlify Blobs und sind nie öffentlich abrufbar; Quellcode der Function, `package.json` u. ä. werden nicht ausgeliefert.
- **Optional zusätzlich (Netlify-Bezahlpläne):** Site-Passwort («Visitor access control») oder IP-Einschränkung vor der ganzen Site.

## Projektstruktur

```
index.html, app.css, cmdk.css, kanban.css, board.css, slideover.css, chat.css, calendar.css, favicon.svg, robots.txt
manifest.webmanifest, sw.js, icons/  installierbare App (PWA), Service Worker (App-Hülle, Push)
logo-*.svg, favicon.svg  SwissTech-Logos (Anfangsdarstellung des Teams «SwissTech Precision Solutions»)  ·  kgc-logo-full.svg, kgc-logo-symbol-white.svg, kgc-favicon.svg  Standard «KGC CRM»
js/i18n/   de · en (Wörterbücher) · server-text (englische Fassung der Import-/SharePoint-Hinweise des Servers)  ·  js/i18n.js  t() · tn() · Sprachwahl · Schalter «DE | EN»
scripts/check-i18n.mjs  Prüfung der Wörterbücher (npm run check:i18n)  ·  scripts/test-chat.mjs  Chat-/Push-Tests (npm run test:chat)  ·  scripts/test-calendar.mjs  Kalender-/Erinnerungs-Tests (npm run test:calendar)  ·  scripts/test-tasklog.mjs  Listenlogik Aufgaben & Aktivitäten (npm run test:tasklog)  ·  scripts/make-icons.mjs  App-Symbole erzeugen
js/        config · tasklog (gemeinsame Liste über tasks + activities, Reiter, Kalender-Fristen) · util · store (Datenschicht, Sync, Konto) · merge · api · model · forms · ui · slideover (Seitenpanel) · table · csv · seed · auth (Login, Passwortwechsel) · presence (Anwesenheit) · chat (Chat-Zustand, Abfrage) · push (Service Worker, Benachrichtigungen) · branding (Logo, Farbe, Name, Titel, Symbol) · app
js/views/  dashboard · customers · suppliers · deals · rfqs · tasklog (Aufgaben & Aktivitäten) · chat · calendar · team · users · platform · settings · branding (Karte «Darstellung») · sharepoint · sections · common
netlify/functions/api.mjs          Function  (/api/*)
netlify/functions/lib/core.mjs     reine API-Logik (Routing, Versionsprüfung, Backups; Konten über accounts.mjs)
netlify/functions/lib/accounts.mjs Anmeldung, Prüfung jeder Anfrage, Routen /me /users /teams /team /audit /presence
netlify/functions/lib/users.mjs        Konten (scrypt, Einmalpasswörter, Rollen-Regeln)   · session.mjs  Tokens
netlify/functions/lib/teams.mjs        Teams, Namensraum «t/<teamId>/…», Migration der Altdaten
netlify/functions/lib/chat.mjs         Team-Chat (Segmente, ungelesen, Tempolimit)   · push.mjs  Web Push (VAPID), E-Mail-Ersatz (Resend), Abos, gemeinsamer Versandweg
netlify/functions/lib/calendar.mjs     Team-Kalender: Termine, Wiederholungen (Zeitzonen), Erinnerungen   · calendar-reminders.mjs  geplante Function (alle 5 Min.)
netlify/functions/lib/audit.mjs        Stempel + Änderungsprotokoll   · presence.mjs  Anwesenheit   · login-throttle.mjs  Sperre
netlify/functions/lib/branding.mjs     Darstellung je Team: Logo-Prüfung (Typ, Grösse, SVG ohne aktive Inhalte), Farbe, Blob «branding», SwissTech-Anfangsdarstellung
netlify/functions/lib/db.mjs       Datenbank-Schlüssel, Backups, versioniertes Speichern
netlify/functions/lib/xlsx-import.mjs  Excel einlesen (Vorlage) und mit der Datenbank zusammenführen
netlify/functions/lib/xlsx-export.mjs  Excel im Vorlagen-Layout + JSON-Sicherung erzeugen
netlify/functions/lib/graph.mjs        Microsoft-Graph-Client (Token, Dateien lesen/schreiben)
netlify/functions/lib/sharepoint.mjs   SharePoint-Status, -Import, -Export (Metadaten im Blob «sharepoint-meta»)
netlify/functions/sharepoint-export.mjs  Scheduled Function: stündlicher Export
netlify/functions/lib/files.mjs, cert-alerts.mjs, roles.mjs  Dateien (/api/files) · Ablauf-Hinweise für Zertifikate (cert-alerts.mjs: täglich) · gemeinsame Rollenprüfung
SHAREPOINT-SETUP.md                Einrichtung der SharePoint-Anbindung (Entra, Berechtigungen, Netlify)
OUTLOOK-SETUP.md                   Einrichtung der Outlook-Kalender-Anbindung (Azure-App, App-ID im CRM eintragen)
netlify.toml                       Publish/Functions, Sicherheits-Header, CSP (nur 'self'), X-Robots-Tag
```

## Hinweise

- Im **Lokalen Modus** (ohne API) gibt es keine Konten; dort bleibt die Auswahl «Ich bin» (Standard-Verantwortlicher, Stempel) – sie ist keine Zugriffskontrolle.
- Die Kennzahl «Lieferanten aktiv» zählt Lieferanten mit Status *Aktiv* (die Excel-Vorlage zählte alle erfassten Lieferanten). Alle übrigen Kennzahlen entsprechen den Formeln der Vorlage; die Definition steht jeweils im Tooltip der Kachel.

## Bekannte Einschränkungen

- **SharePoint ist global:** `MS_*`/`SP_*` sind Umgebungsvariablen der ganzen Netlify-Site und gelten für genau **ein** Team (`SP_TEAM_ID`, sonst das erste/älteste Team). Alle anderen Teams haben keine SharePoint-Anbindung.
- **SwissTech-spezifische Vorgaben:** Der Wochenfokus-Text «Shopfloor» (Pascal / Liz / Marco, `SHOPFLOOR_AGENDA`), die Standard-Verantwortlichen und die Phasen in `js/config.js` sind für SwissTech formuliert und gelten für alle Teams gleich.
- **Teams werden nicht gelöscht**, nur deaktiviert (die Daten bleiben erhalten).
- **Superadmin-Passwort vergessen:** Es gibt keinen Weg über die App, aber das Verfahren mit `CRM_ADMIN_RESET` (siehe oben) setzt es zurück. Das Konto wird dabei über den Benutzernamen `CRM_ADMIN_USER` gefunden; wurde dieser Wert seit der Einrichtung geändert, muss er für das Zurücksetzen wieder dem ursprünglichen Namen entsprechen.
- **«Serverfehler» beim Start:** Meldet die App beim Start einen Serverfehler, hilft «Abmelden» (verwirft die gespeicherte Sitzung) und eine neue Anmeldung. Die eigentliche Ursache samt Stack steht im Function-Log (Netlify → Logs → Functions → `api`, Zeilen mit `[stps-crm]`); die Antwort nennt zusätzlich die Fehlerart (Feld `reason`). Sitzungen und Daten früherer Versionen werden gelesen und fehlende Felder ergänzt – ein unbrauchbares Token führt immer zur Anmeldeseite (401), nie zu einem Serverfehler.
- **Angebote haben keine eigene Detailseite;** ihr Verlauf erscheint beim Kunden.
