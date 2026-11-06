# Outlook-Kalender anbinden (einmalige Einrichtung durch den Superadmin)

Jeder CRM-Benutzer meldet sich **selbst** mit Microsoft an (Einstellungen → «Outlook-Kalender» → **«Mit Microsoft anmelden»**) – danach erscheint
sein Outlook-Kalender im Team-Kalender. Die Anmeldung läuft über Microsoft (OAuth 2.0, Authorization-Code-Flow mit PKCE, **delegierte**
Berechtigungen). Das CRM sieht ausschliesslich den Kalender der Person, die sich anmeldet – keine Rechte auf fremde Postfächer.

**Es sind keine Netlify-Variablen nötig.** Microsoft verlangt aber immer eine App-Registrierung (kostenlos, ca. 3 Minuten). Deren
Anwendungs-ID (Client-ID) trägt der Superadmin einmal im CRM ein; ein Client-Secret braucht es nicht.

## 1. Azure-App registrieren (kostenlos, einmalig)

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → App-Registrierungen → Neue Registrierung**.
   Name z. B. «STPS CRM Outlook». Unterstützte Kontotypen: **«Konten in einem beliebigen Organisationsverzeichnis und persönliche
   Microsoft-Konten»** (dann kann sich jeder mit Geschäfts-, Schul- oder privatem Konto anmelden; Mandant im CRM = `common`).
   Eine Registrierung ist ohne Azure-Abonnement möglich.
2. **Verwalten → Authentifizierung → Plattform hinzufügen → «Mobil- und Desktopanwendungen»** → unter «Benutzerdefinierte Umleitungs-URIs»
   **exakt** eintragen: `https://kgc-crm.netlify.app/api/outlook/callback` (bzw. die eigene Domain der Site, je Adresse ein Eintrag;
   zum Testen mit `netlify dev`: `http://localhost:8888/api/outlook/callback`).
   Nicht «Web» wählen: «Web» ist ein vertraulicher Client und verlangt ein Secret; «Single-Page-Anwendung» liefert nur 24 Stunden gültige Refresh-Tokens.
   Die Plattform «Mobil- und Desktopanwendungen» ist ein **öffentlicher Client**: Der Server tauscht den Code mit PKCE (`code_verifier`) ohne
   Secret ein, und die Refresh-Tokens bleiben lange gültig (90 Tage gleitend, solange der Abgleich läuft).
3. Ebenfalls unter **Authentifizierung → Erweiterte Einstellungen → «Öffentliche Clientflows zulassen» = Ja** → Speichern.
   Ohne diese Einstellung antwortet Microsoft beim Einlösen des Codes mit `AADSTS7000218` («client_assertion or client_secret» fehlt).
4. **Verwalten → API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**:
   - `Calendars.ReadWrite` (Termine lesen und – nur bei Richtung «beide» – schreiben)
   - `User.Read` (Name und E-Mail-Adresse des Kontos anzeigen)
   - `offline_access` (dauerhafter Zugriff, damit der Abgleich ohne erneute Anmeldung läuft)

   Keine «Anwendungsberechtigungen». Alle drei lassen sich vom Benutzer selbst bestätigen. Sperrt die Firma die Benutzerzustimmung
   (`AADSTS65001`/`AADSTS90094`), muss deren Administrator die Zustimmung erteilen.
5. Auf der **Übersicht** die **Anwendungs-ID (Client)** kopieren.

## 2. Im CRM eintragen

Als Superadmin: Seite **Plattform** (oder ein Team betreten → Einstellungen) → Karte **«Outlook-Kalender»** → Feld **«Microsoft App-ID (Client-ID)»**
einfügen → **«App-ID speichern»**. Mandant leer lassen (= `common`), ausser die App ist auf ein einziges Verzeichnis beschränkt (dann dessen Mandanten-ID).
Ab sofort sehen alle Benutzer den Knopf «Mit Microsoft anmelden»; solange keine App-ID hinterlegt ist, steht dort «Outlook-Anmeldung noch
nicht freigeschaltet – bitte Administrator kontaktieren». Die Rückleit-Adresse leitet das CRM aus der Adresse ab, unter der es aufgerufen wird
(optional fest vorgeben mit `APP_URL`). Voraussetzung ist nur das bestehende `CRM_SECRET` (verschlüsselt die gespeicherten Zugriffstoken).

Der Abgleich läuft als geplante Function `outlook-sync` alle 15 Minuten.

**Optional (überschreibt die Eingabe im CRM):** Wer die App lieber über Netlify setzt, kann `OUTLOOK_CLIENT_ID` (oder `MS_CLIENT_ID` der SharePoint-App),
`MS_TENANT_ID` und – nur wenn die App als vertraulicher Client (Plattform «Web») registriert ist – `OUTLOOK_CLIENT_SECRET` (oder `MS_CLIENT_SECRET`) setzen.
Mit Secret läuft derselbe Ablauf zusätzlich mit Secret; ohne Secret als öffentlicher Client. Ein Secret wird nie zusammen mit einer im CRM eingetragenen App-ID verwendet.

## 3. Was die Benutzer sehen und tun

- **Mit Microsoft anmelden** → Microsoft-Anmeldung → zurück in die Einstellungen; der erste Abgleich startet sofort.
- **Richtung** wählen: «Outlook → CRM» (Standard) oder «beide Richtungen». **Jetzt synchronisieren** und **Trennen** stehen daneben.
- Im Team-Kalender erscheinen Outlook-Termine mit «Outlook»-Kennzeichen und eigener Farbe; Filter **«Outlook anzeigen»**.
- **Private und vertrauliche** Outlook-Termine sehen die Kolleginnen und Kollegen nur als «Beschäftigt» (ohne Titel, Ort, Notizen, Link).
- Outlook-Termine sind im CRM nur lesbar. Das CRM erzeugt für sie **keine** Erinnerungen (Outlook erinnert selbst).

## 4. Technische Eckpunkte

- Zeitfenster: 30 Tage zurück bis 365 Tage voraus; Änderungen per Graph-Delta (`/me/calendarView/delta`), wöchentlich zusätzlich ein Vollabgleich.
  Wiederkehrende Outlook-Serien kommen als einzelne Vorkommen; Absagen und Löschungen werden übernommen.
- Richtung «beide»: Im CRM gespeicherte Termine (Ersteller, sonst erster verbundener Teilnehmer) werden im Outlook-Kalender angelegt, geändert
  und gelöscht (Kategorie «STPS CRM», **keine Einladungen** an andere). Wiederholungen werden als Serie übertragen. Bei Konflikten gewinnt die
  spätere Änderung (`lastModified`); Änderungen aus Outlook werden nie zurückgespiegelt. Wird ein verknüpfter Termin in Outlook gelöscht, bleibt er
  im CRM erhalten und ist danach nicht mehr verknüpft. Titel, Zeit und Ort werden aus Outlook übernommen, Notizen nicht (Outlook liefert nur eine Vorschau).
- Tokens: Das Refresh-Token wird je Team und Benutzer mit AES-256-GCM verschlüsselt im Blob-Store abgelegt (Schlüssel aus `CRM_SECRET`, an
  Team und Benutzer gebunden). Zugriffstoken werden nicht gespeichert. Ein Wechsel von `CRM_SECRET` macht die Verbindungen ungültig – die Benutzer
  verbinden dann erneut.
- Widerruft der Benutzer den Zugriff (z. B. unter myapps.microsoft.com), ändert sich das Passwort oder läuft die Sitzung ab, zeigt die Karte
  «Neu verbinden» an. Beim Trennen im CRM werden Token und importierte Termine gelöscht.
- Teams sind strikt getrennt: Verbindungen, Delta-Stände und Termine liegen im Namensraum des jeweiligen Teams.

## 5. Fehlerbilder

| Meldung / Code | Ursache und Abhilfe |
|---|---|
| «Rückleit-Adresse stimmt nicht» (`AADSTS50011`) | Umleitungs-URI in Azure (Plattform «Mobil- und Desktopanwendungen») weicht von `https://<adresse-der-site>/api/outlook/callback` ab (https, Domain). |
| «App nicht als öffentlicher Client eingerichtet» (`AADSTS7000218`) | Azure → Authentifizierung → «Öffentliche Clientflows zulassen» = Ja (und Umleitungs-URI unter «Mobil- und Desktopanwendungen», nicht «Web»). |
| «Client ist öffentlich, Secret mitgeschickt» (`AADSTS700025`) | Nur mit Netlify-Secret: `OUTLOOK_CLIENT_SECRET` entfernen (öffentlicher Client) oder die App als «Web» registrieren. |
| «Zustimmung fehlt» (`AADSTS65001`, `AADSTS90094`) | Administrator des Benutzer-Verzeichnisses muss den delegierten Berechtigungen zustimmen (Schritt 1.4). |
| «Nur ein Mandant» (`AADSTS50194`) | App nicht mandantenübergreifend: Kontotyp in Azure ändern oder im CRM die Mandanten-ID statt `common` eintragen. |
| «Client-Secret ungültig/abgelaufen» (`AADSTS7000215`, `AADSTS7000222`) | Nur mit Netlify-Secret: den Secret-**Wert** (nicht die ID) verwenden bzw. erneuern. |
| «App nicht gefunden» (`AADSTS700016`) | Client-ID oder Mandant falsch. |
| «Keine Berechtigung für den Kalender» (HTTP 403) | `Calendars.ReadWrite` fehlt oder wurde nicht zugestimmt; Benutzer meldet sich erneut an. |
| «Kein Exchange-Online-Postfach» | Dem Konto fehlt eine Exchange-Lizenz bzw. es ist ein reines Gastkonto. |
| Karte zeigt «Neu verbinden» | Zugriff widerrufen oder abgelaufen (oder App-ID geändert) – Benutzer wählt «Erneut anmelden». |
