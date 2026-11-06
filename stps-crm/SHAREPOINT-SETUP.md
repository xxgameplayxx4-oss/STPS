# SharePoint anbinden (Schritt für Schritt)

Das CRM kann sich mit **Microsoft SharePoint** verbinden – ohne dass sich jemand bei Microsoft anmelden muss. Die Anbindung läuft als eigene «App» (Anwendung ohne Benutzer, *app-only*) über Microsoft Graph.

**Das CRM bleibt das führende System.** SharePoint ist dafür da, dass

- jeden Abend (und auf Knopfdruck) eine **Excel-Datei und eine JSON-Sicherung** der CRM-Daten in einem SharePoint-Ordner landen, und
- Sie eine **Excel-Datei aus SharePoint** (z. B. die Vorlage `STPS_CRM_v.1.0`) auf Knopfdruck in das CRM **einlesen** können – mit Vorschau, ohne etwas zu löschen.

Es gibt keine automatische Rück-Synchronisation: Der Import startet nur auf Ihren Klick und zeigt vorher, was sich ändern würde.

Aufwand: ca. 20–30 Minuten, einmalig. Sie brauchen dafür die Rolle **Globaler Administrator** (oder *Anwendungsadministrator* + eine Person für die Administratorzustimmung) im Microsoft-365-Mandanten und Zugriff auf die SharePoint-Site.

---

## Übersicht

| Schritt | Wo | Ergebnis |
|---|---|---|
| 1. App registrieren | Microsoft Entra (portal.azure.com) | Mandanten-ID, Client-ID |
| 2. Client-Secret erstellen | Entra → Zertifikate & Geheimnisse | Secret-Wert |
| 3. Berechtigung vergeben | Entra + Graph Explorer | App darf genau eine Site lesen/schreiben |
| 4. Site-Adresse und Dateipfade bestimmen | SharePoint | `SP_SITE`, `SP_IMPORT_PATH`, `SP_EXPORT_FOLDER` |
| 5. Umgebungsvariablen in Netlify | Netlify | Neu deployen |
| 6. Testen | CRM → Einstellungen | «Verbindung funktioniert» |

---

## 1. App in Microsoft Entra registrieren

1. Öffnen Sie <https://entra.microsoft.com> (oder <https://portal.azure.com> → *Microsoft Entra ID*) und melden Sie sich als Administrator an.
2. **Entra ID → App-Registrierungen → Neue Registrierung**.
3. Name: `STPS CRM`.
4. Unterstützte Kontotypen: **Nur Konten in diesem Organisationsverzeichnis (nur <Ihr Mandant> – einzelner Mandant)**.
5. **Umleitungs-URI: leer lassen** (die App meldet keine Benutzer an, es gibt keine Weiterleitung).
6. **Registrieren**.
7. Auf der Übersichtsseite notieren Sie:
   - **Anwendungs-ID (Client)** → wird zu `MS_CLIENT_ID`
   - **Verzeichnis-ID (Mandant)** → wird zu `MS_TENANT_ID`

## 2. Client-Secret erstellen

1. In der App-Registrierung: **Zertifikate & Geheimnisse → Clientgeheimnisse → Neues Clientgeheimnis**.
2. Beschreibung: `STPS CRM Netlify`. Gültigkeit: **24 Monate** (das Maximum der Auswahl; kürzere Laufzeiten sind sicherer, müssen aber öfter erneuert werden).
3. **Hinzufügen** und sofort den Wert aus der Spalte **Wert** kopieren – er wird **nur jetzt** angezeigt. Das ist `MS_CLIENT_SECRET`.
   - Nicht die Spalte «Geheimnis-ID» verwenden – das ist nicht das Secret.
4. **Kalendererinnerung setzen:** Das Secret läuft ab (Datum steht in der Liste). Legen Sie sich zwei bis vier Wochen vorher eine Erinnerung in den Kalender. Läuft es ab, scheitern der Abend-Export und der Import mit der Meldung «Client-Secret abgelaufen». Dann ein neues Secret erstellen, in Netlify ersetzen und neu deployen – sonst ändert sich nichts.

## 3. Berechtigung vergeben

Die App soll **nur auf eine einzige SharePoint-Site** zugreifen dürfen, nicht auf alle. Dafür gibt es die Berechtigung **Sites.Selected**. (Wenn Ihnen das zu aufwendig ist, siehe Variante B unten.)

### Variante A (empfohlen): Sites.Selected

**3a. Berechtigung hinzufügen und zustimmen**

1. App-Registrierung → **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Anwendungsberechtigungen**.
2. Suchen Sie `Sites.Selected`, anhaken, **Berechtigungen hinzufügen**. (Es muss «Anwendungsberechtigungen» sein, nicht «Delegierte».)
3. Klicken Sie **Administratorzustimmung für <Mandant> erteilen** und bestätigen. In der Spalte «Status» erscheint ein grüner Haken.

**3b. Der App Zugriff auf die Site geben (Graph Explorer)**

`Sites.Selected` allein gibt noch keinen Zugriff auf irgendeine Site. Sie müssen der App die Site einmalig freigeben. Das geht am einfachsten im Graph Explorer:

1. Öffnen Sie <https://developer.microsoft.com/graph/graph-explorer> und melden Sie sich mit Ihrem Administratorkonto an.
2. Der Graph Explorer braucht dafür selbst Rechte: Klicken Sie auf *Berechtigungen ändern* (Reiter *Modify permissions*) und stimmen Sie **Sites.FullControl.All** (delegiert) zu, ggf. mit Administratorzustimmung. Ohne diese Zustimmung antwortet Schritt 4 mit «Access denied».
3. **Site-ID ermitteln:** Methode `GET`, URL (Host und Pfad durch Ihre ersetzen):

   ```
   https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/STPS
   ```

   Aus der Antwort kopieren Sie das Feld `id`. Es sieht so aus: `contoso.sharepoint.com,11111111-aaaa-…,22222222-bbbb-…` (drei Teile, durch Kommas getrennt – der ganze Wert ist die Site-ID).
4. **App freigeben:** Methode `POST`, URL (Site-ID einsetzen):

   ```
   https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   ```

   Request body:

   ```json
   {
     "roles": ["write"],
     "grantedToIdentities": [
       {
         "application": {
           "id": "<MS_CLIENT_ID – die Anwendungs-ID aus Schritt 1>",
           "displayName": "STPS CRM"
         }
       }
     ]
   }
   ```

   Erwartet: Status `201 Created`, in der Antwort steht die App unter `grantedToIdentitiesV2`.
5. Prüfen: `GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` listet die App mit der Rolle `write`.

`write` genügt (lesen und schreiben, aber keine Rechteverwaltung). Die App sieht danach nur diese Site.

### Variante B (einfacher, aber weniger restriktiv): Sites.ReadWrite.All

Statt `Sites.Selected` fügen Sie in Schritt 3a die Anwendungsberechtigung **`Sites.ReadWrite.All`** hinzu und erteilen die Administratorzustimmung. Schritt 3b entfällt. Nachteil: Die App kann damit **alle** SharePoint-Sites des Mandanten lesen und ändern. Nur verwenden, wenn der Mandant klein ist und das akzeptabel ist.

## 4. Site-Adresse und Dateipfade bestimmen

**`SP_SITE`** – aus der Adresse der Site im Browser:

| Adresse im Browser | `SP_SITE` |
|---|---|
| `https://contoso.sharepoint.com/sites/STPS` | `contoso.sharepoint.com:/sites/STPS` |
| `https://contoso.sharepoint.com/sites/STPS/Freigegebene Dokumente/CRM` | `contoso.sharepoint.com:/sites/STPS` (nur bis zum Sitenamen) |
| `https://contoso.sharepoint.com` (Hauptsite) | `contoso.sharepoint.com` |

Die vollständige Adresse (`https://contoso.sharepoint.com/sites/STPS`) wird ebenfalls akzeptiert.

**`SP_DRIVE`** (optional) – Name der Dokumentbibliothek. Lassen Sie die Variable weg, dann wird die Standardbibliothek der Site verwendet (heisst je nach Sprache «Dokumente», «Freigegebene Dokumente» bzw. *Documents*). Nur setzen, wenn Sie eine andere Bibliothek verwenden. Der Name muss exakt stimmen; bei einem Tippfehler listet die Fehlermeldung die vorhandenen Bibliotheken auf.

**Wo soll die Excel-Datei liegen?** Legen Sie in der Bibliothek einen Ordner an, z. B. `CRM`, und laden Sie die Excel-Datei (z. B. `STPS_CRM_v.1.0.xlsx`) dort hinein. Die Pfade sind **relativ zur Bibliothek**, ohne Bibliotheksnamen und ohne führenden Schrägstrich:

| Variable | Beispiel | Bedeutung |
|---|---|---|
| `SP_IMPORT_PATH` | `CRM/STPS_CRM_v.1.0.xlsx` | Datei, die «Aus SharePoint importieren» einliest |
| `SP_EXPORT_FOLDER` | `CRM/Export` | Ordner, in den der Export schreibt |

Der Export legt dort an (gleicher Tag = überschreiben):

- `STPS_CRM_Export_JJJJ-MM-TT.xlsx` und `STPS_CRM_Export_JJJJ-MM-TT.json` (vollständige Sicherung)
- `STPS_CRM_aktuell.xlsx` (immer der neueste Stand)

Der Exportordner wird beim ersten Export **automatisch angelegt**, falls er fehlt (Annahme: Microsoft Graph legt fehlende Zwischenordner beim Hochladen an; andernfalls legt das CRM sie selbst an). Legen Sie ihn bei Zweifeln vorab von Hand an. Der Import-Pfad muss existieren.

Hinweis: Die Importdatei und die Exportdateien sollten **nicht dieselbe Datei** sein. `STPS_CRM_aktuell.xlsx` kann aber bewusst als Importdatei verwendet werden (Rücksicherung).

## 5. Umgebungsvariablen in Netlify

Netlify → Ihre Site → **Site configuration → Environment variables → Add a variable**. Alle Werte als *Secret* markieren, wo Netlify das anbietet (mindestens `MS_CLIENT_SECRET`).

| Variable | Pflicht | Wert |
|---|---|---|
| `MS_TENANT_ID` | ja | Verzeichnis-ID (Mandant) aus Schritt 1 |
| `MS_CLIENT_ID` | ja | Anwendungs-ID (Client) aus Schritt 1 |
| `MS_CLIENT_SECRET` | ja | Secret-**Wert** aus Schritt 2 |
| `SP_SITE` | ja | z. B. `contoso.sharepoint.com:/sites/STPS` |
| `SP_DRIVE` | nein | Bibliotheksname; weglassen = Standardbibliothek |
| `SP_IMPORT_PATH` | für Import | z. B. `CRM/STPS_CRM_v.1.0.xlsx` |
| `SP_EXPORT_FOLDER` | für Export | z. B. `CRM/Export` |
| `SP_TEAM_ID` | nein | Team-ID (`tm_…`, sichtbar in der Adresse unter Plattform → Team), für das die SharePoint-Anbindung gilt; weglassen = das erste (älteste) Team |

**Mehrere Teams:** Die SharePoint-Variablen sind global (pro Netlify-Site gibt es nur eine Anbindung). Sie gelten für genau ein Team – `SP_TEAM_ID`, sonst das erste Team. In allen anderen Teams ist SharePoint ausgeschaltet; Import, Export und der Abend-Export berühren deren Daten nie.

**Wer sieht was?** Einrichtung, Verbindungstest und Import sind dem **Superadmin** vorbehalten; Team-Admins und Mitglieder sehen die SharePoint-Diagnose nicht (der Server verweigert ihnen `/api/sharepoint/*` mit 403). Nur im SharePoint-Team (siehe `SP_TEAM_ID`) und erst wenn alles eingerichtet ist, sehen dessen Admins und Mitglieder unter Einstellungen die schlichte Karte «Excel in SharePoint» mit dem Hinweis auf den Abend-Upload, dem Zeitpunkt des letzten Uploads, dem Knopf *Jetzt nach SharePoint hochladen* und dem Link zum Ordner.

Danach **neu deployen** (Deploys → *Trigger deploy → Deploy site*). Umgebungsvariablen gelten erst für neue Deployments. Das Secret steht nur in Netlify und wird vom CRM nie angezeigt oder an den Browser geschickt.

Der Export startet jeden Abend automatisch (Netlify Scheduled Function `sharepoint-export`, Cron `0 20 * * *` = täglich 20:00 UTC = 22:00 Uhr Sommerzeit / 21:00 Uhr Winterzeit in der Schweiz). Ohne die Variablen tut er nichts. Die Scheduled Function läuft nur im veröffentlichten (Produktions-)Deploy.

## 6. Testen

1. Im CRM: **Einstellungen → Microsoft SharePoint**. Der Status zeigt «Eingerichtet»; fehlen Variablen, nennt die Karte sie.
2. **Verbindung testen**: Erwartet «Verbindung funktioniert» mit Site- und Bibliotheksname, dazu «Importdatei gefunden» und «Exportordner vorhanden/wird angelegt».
3. **Jetzt nach SharePoint exportieren**: Prüfen Sie im SharePoint-Ordner die Dateien.
4. **Aus SharePoint importieren**: Zeigt zuerst eine Vorschau mit Anzahl neu/geändert/übersprungen und Hinweisen. Erst «Übernehmen» speichert. Vorher legt der Server automatisch ein Backup an (Einstellungen → Server-Backups, Eintrag «vor Import»).

---

## Wie der Import zusammenführt

- **Zuordnung:** Kunden und Lieferanten werden über die Nummer (Kundennr./Lieferantennr.), sonst über den Firmennamen (ohne Gross-/Kleinschreibung) erkannt. Unbekannte werden neu angelegt.
- **Gefüllte Zellen aktualisieren, leere ändern nichts.** Es wird **nie** etwas gelöscht.
- Pro Zeile ein Kontakt (Kontaktperson/E-Mail/Telefon) → Hauptkontakt; im Blatt «Kontakte» (aus dem Export) mehrere.
- Formelzellen ohne gespeicherten Wert (z. B. Nummern in einer nie in Excel geöffneten Datei) werden aus der Zeilenposition abgeleitet; solche Zeilen werden nur über den Namen zugeordnet.
- Die Beispielzeile der Vorlage (ohne Firmenname) wird übersprungen und in der Vorschau als Hinweis gemeldet.
- Dateien bis ca. 4,5 MB beim Hochladen vom Rechner (Netlify nimmt pro Anfrage rund 6 MB an); SharePoint-Dateien werden direkt auf dem Server gelesen (Limit 25 MB).

---

## Fehlerbehebung

| Meldung | Ursache und Lösung |
|---|---|
| «Keine Berechtigung – App-Berechtigung/Admin-Zustimmung prüfen» (401/403) | Schritt 3 unvollständig: Administratorzustimmung fehlt, **Sites.Selected** wurde der Site nicht zugewiesen (3b, `POST …/permissions`), oder falsche Site-ID. Für Test: Variante B. |
| «Datei/Site nicht gefunden: Site …» | `SP_SITE` falsch geschrieben. Format `host:/sites/Name`, Gross-/Kleinschreibung und Umlaute wie in der Adresse. |
| «Datei/Site nicht gefunden: SP_IMPORT_PATH …» | Datei existiert nicht in der Bibliothek, oder der Pfad enthält den Bibliotheksnamen (`Freigegebene Dokumente/…`). Pfad relativ zur Bibliothek angeben. |
| «Datei/Site nicht gefunden: Dokumentbibliothek «…» (SP_DRIVE) – vorhanden: …» | `SP_DRIVE` auf einen der aufgelisteten Namen setzen oder weglassen. |
| «Client-Secret ungültig» (AADSTS7000215) | In `MS_CLIENT_SECRET` steht die Secret-**ID** statt des **Werts**, oder das Secret wurde mit Leerzeichen kopiert. |
| «Client-Secret abgelaufen» (AADSTS7000222) | Neues Secret erstellen (Schritt 2), ersetzen, neu deployen. |
| «App nicht gefunden» (AADSTS700016) | `MS_CLIENT_ID` falsch oder App in einem anderen Mandanten. |
| «Mandant nicht gefunden» | `MS_TENANT_ID` falsch. |
| Verbindungstest grün, Export schlägt mit 403 fehl | Rolle `read` statt `write` vergeben: `PATCH …/permissions/{id}` mit `{"roles":["write"]}` oder die Freigabe neu erstellen. |
| «Microsoft ist gerade überlastet oder nicht erreichbar (HTTP 429/503/504)» | Microsoft drosselt kurz; das CRM wiederholt selbst einige Male. Später erneut versuchen. |
| «Datei ist gesperrt oder ausgecheckt» | Die Zieldatei ist in SharePoint ausgecheckt oder gesperrt. Schliessen bzw. einchecken und erneut exportieren. |
| Nächtlicher Export läuft nicht | Variablen fehlen oder wurden nach dem letzten Deploy gesetzt (neu deployen). Netlify → Logs → Functions → `sharepoint-export` zeigt «übersprungen» oder die Fehlermeldung; der Status in den Einstellungen zeigt «Letzter Export: fehlgeschlagen». |
| Import: «Daten wurden von jemand anderem geändert …» oder «Die Datei hat sich seit der Vorschau geändert …» | Jemand hat im CRM gespeichert bzw. die Datei in SharePoint ersetzt, während die Vorschau offen war. Import erneut starten. |

Weitere Hinweise:

- Das Secret wird in Fehlermeldungen und im Status nie ausgegeben.
- Wer Schreibzugriff auf den SharePoint-Ordner hat, kann die Importdatei ändern: Nur Personen, denen Sie das auch im CRM zutrauen, sollten ihn haben.
