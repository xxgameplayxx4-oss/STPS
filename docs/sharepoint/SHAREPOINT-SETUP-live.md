# SharePoint anbinden (Schritt für Schritt)

Das CRM kann sich mit **Microsoft SharePoint** verbinden – ohne dass sich jemand bei Microsoft anmelden muss. Die Anbindung läuft als eigene «App» (Anwendung ohne Benutzer, *app-only*) über Microsoft Graph.

**Das CRM bleibt das führende System.** SharePoint ist dafür da, dass

- jede Nacht (und auf Knopfdruck) eine **Excel-Datei und eine JSON-Sicherung** der CRM-Daten in einem SharePoint-Ordner landen, und
- Sie eine **Excel-Datei aus SharePoint** (z. B. die Vorlage `STPS_CRM_v.1.0`) auf Knopfdruck in das CRM **einlesen** können – mit Vorschau, ohne etwas zu löschen.

Der normale Import startet nur auf Ihren Klick und zeigt vorher, was sich ändern würde. In der Version **«Live-Sync»** (Branch `claude/stps-crm-live`) können Sie die Excel-Datei zusätzlich **einmal verknüpfen**; danach gleicht das CRM automatisch in beide Richtungen ab – siehe Abschnitt [Live-Sync](#live-sync-nur-version-claudestps-crm-live) weiter unten.

**Mehrere Teams:** Die SharePoint-Anbindung – auch der Live-Sync – gilt für genau **ein** Team der Site (`SP_TEAM_ID`, sonst das erste/älteste Team; siehe Schritt 5). Alle Einstellungen unten nehmen Team-Admins dieses Teams vor.

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
| 7. *(nur Live-Sync)* Excel verknüpfen | CRM → Einstellungen → Live-Sync | Änderungen fliessen in beide Richtungen |

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
4. **Kalendererinnerung setzen:** Das Secret läuft ab (Datum steht in der Liste). Legen Sie sich zwei bis vier Wochen vorher eine Erinnerung in den Kalender. Läuft es ab, scheitern der nächtliche Export und der Import mit der Meldung «Client-Secret abgelaufen». Dann ein neues Secret erstellen, in Netlify ersetzen und neu deployen – sonst ändert sich nichts.

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
| `SP_LIVE_PATH` | für Live-Sync | Pfad der Excel-Datei, die verknüpft wird, z. B. `CRM/STPS_CRM_v.1.0.xlsx`; fehlt sie, gilt `SP_IMPORT_PATH` |
| `SITE_URL` | für Live-Sync (empfohlen) | Öffentliche https-Adresse des CRM, z. B. `https://stps-crm.netlify.app` (ohne Pfad). Dorthin sendet Microsoft die Änderungsmeldungen. Fehlt sie, nimmt das CRM die von Netlify gesetzte `URL`. |
| `SP_TEAM_ID` | nein | Team-ID (`tm_…`, sichtbar in der Adresse unter Plattform → Team), für das die SharePoint-Anbindung **und der Live-Sync** gelten; weglassen = das erste (älteste) Team |

**Mehrere Teams:** Die SharePoint-Variablen sind global (pro Netlify-Site gibt es nur eine Anbindung). Sie gelten für genau ein Team – `SP_TEAM_ID`, sonst das erste Team. In allen anderen Teams ist SharePoint ausgeschaltet; Import, Export, der nächtliche Export und der Live-Sync (Webhook, Scheduled Function `live-sync-tick`) berühren deren Daten nie.

Danach **neu deployen** (Deploys → *Trigger deploy → Deploy site*). Umgebungsvariablen gelten erst für neue Deployments. Das Secret steht nur in Netlify und wird vom CRM nie angezeigt oder an den Browser geschickt.

Der nächtliche Export startet automatisch (Netlify Scheduled Function `sharepoint-export`, täglich 02:00 UTC = 03:00/04:00 Uhr Schweizer Zeit). Ohne die Variablen tut er nichts. Die Scheduled Functions (`sharepoint-export`, `live-sync-tick`) arbeiten ohne Login-Token direkt für das SharePoint-Team und laufen nur im veröffentlichten (Produktions-)Deploy.

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

## Live-Sync (nur Version «claude/stps-crm-live»)

**Ziel:** Sie legen die Excel-Datei (z. B. `STPS_CRM_v.1.0.xlsx`) **einmal** in SharePoint ab und verknüpfen sie im CRM. Danach erscheinen Änderungen im CRM **sofort in Excel**, und Änderungen in Excel (auch von Kolleginnen und Kollegen) erscheinen **innerhalb kurzer Zeit im CRM** – ohne erneutes Hochladen oder Importieren. Die Datei bleibt in SharePoint und darf dabei geöffnet sein (Excel Online oder Desktop mit AutoSave).

### Voraussetzungen

- Excel-Datei im Format der Vorlage `STPS_CRM_v.1.0` (**.xlsx**), in einer Dokumentbibliothek von SharePoint bzw. in OneDrive for Business – **nicht** lokal auf einem Rechner und nicht als .xls/.xlsm.
- Die App braucht **Schreibrechte** auf die Site: Mit Variante A genügt die Rolle `write` (Schritt 3b), mit Variante B `Sites.ReadWrite.All`. Der Live-Sync schreibt über die Excel-Arbeitsmappen-API von Microsoft Graph in die Datei und abonniert Dateiänderungen; beides nutzt dieselbe App-Berechtigung.
- Umgebungsvariablen `SP_LIVE_PATH` (Datei) und `SITE_URL` (öffentliche https-Adresse des CRM, damit Microsoft Änderungen melden kann), danach neu deployen. `CRM_SECRET` (Pflicht der Konten) sichert zugleich den Webhook ab.
- **Team:** Der Live-Sync gehört dem SharePoint-Team (`SP_TEAM_ID`, sonst das erste/älteste Team). Dessen **Team-Admins** (und der Superadmin, nachdem er das Team betreten hat) richten ihn ein, pausieren ihn und gleichen ab; **Mitglieder** sehen nur den Status. Benutzer anderer Teams sehen die Karte nicht und erhalten von den Live-Sync-Routen `403`. Zustand, Warteschlange, Protokoll und Sperre liegen im Namensraum des Teams (`t/<teamId>/live-sync…`); bestehende Live-Sync-Daten aus der Zeit vor den Konten werden bei der Migration (erste Superadmin-Anmeldung) in das erste Team verschoben.
- Eine Site mit eigener Domain oder `*.netlify.app` genügt; `localhost` und Adressen ohne HTTPS können keine Meldungen empfangen. Ohne erreichbare Adresse arbeitet der Live-Sync trotzdem, prüft die Datei aber nur alle 5 Minuten.

### Einrichten (einmalig)

1. Im CRM **Einstellungen → Live-Sync mit SharePoint-Excel**. Der Status nennt fehlende Variablen. **Verbindung testen** prüft Datei, Blätter und Webhook-Adresse.
2. **Excel verknüpfen** startet den Assistenten:
   1. *Vorschau und Erstimport:* Die Datei wird einmal eingelesen (wie der normale Import: Kunden/Lieferanten werden über Nummer bzw. Firmenname erkannt, es wird nichts gelöscht). Erst nach «Übernehmen» wird gespeichert; vorher legt der Server ein Backup an.
   2. *Blätter vorbereiten:* Jedes Blatt (Kunden, Lieferantenstamm, Angebote, Lieferanten, Aktivitäten, Aufgaben) erhält am Ende eine **ausgeblendete Spalte «CRM-ID»**. Vorhandene Zeilen werden den CRM-Datensätzen zugeordnet; fehlende Angaben werden in beide Richtungen ergänzt (leere Excel-Zellen mit CRM-Werten, CRM-Datensätze ohne Zeile ans Ende der Tabelle). Das Blatt **«Kontakte»** wird angelegt, falls es fehlt. Formeln, Formate und Ihr Layout bleiben unverändert.
   3. *Aktivieren:* Das CRM legt ein Abonnement für Änderungen an der Datei an und liest die Datei ein letztes Mal vollständig ein.
3. Die Karte zeigt jetzt **Aktiv**, den letzten Abgleich, das Ablaufdatum des Abonnements, wartende Änderungen und das Protokoll der letzten 20 Abgleiche. Mit **Live-Sync pausieren/fortsetzen** halten Sie den Abgleich an (Änderungen im CRM werden vorgemerkt), mit **Jetzt synchronisieren** stossen Sie ihn von Hand an, mit **Neu verknüpfen** wiederholen Sie die Einrichtung (z. B. nach Dateiwechsel; nichts wird doppelt angelegt).

### Wie es funktioniert

- **CRM → Excel:** Nach jedem Speichern vergleicht der Server alten und neuen Stand und schreibt nur geänderte Zellen (zeilenweise Bereiche), und zwar *nach* der Antwort an den Browser – das Speichern wird dadurch nicht langsamer. Neue Datensätze kommen in die **erste leere Zeile**; gelöschte Datensätze **leeren** ihre Zeile (es wird nichts verschoben, weil die Formeln der Vorlage auf feste Bereiche verweisen). Lieferantennotizen stehen in der Spalte «Notiz». Der Hauptkontakt steht in den vorhandenen Kontaktspalten, **alle** Kontakte im Blatt «Kontakte».
- **Excel → CRM:** Microsoft meldet Dateiänderungen an `SITE_URL/api/sharepoint/webhook` (die einzige Route ohne Anmeldung). Das CRM prüft die Meldung (geheimer Wert aus `CRM_SECRET`), liest die Blätter und führt sie über die **CRM-ID** mit der Datenbank des SharePoint-Teams zusammen – als normales, versioniertes Speichern mit Backup und Änderungsprotokoll, ausgeführt vom Systemakteur **«Excel (SharePoint)»** (erscheint so im Team-Feed und im Verlauf der Datensätze; ebenso als «erstellt/geändert von»): gefüllte Zellen aktualisieren das Feld, **geleerte Zellen leeren das Feld** (wie in Excel gemeint), Formelzellen werden nie als Eingabe gelesen. Neue Zeilen ohne CRM-ID werden neue CRM-Datensätze; ihre CRM-ID wird in Excel nachgetragen. Ob die Änderung von Ihnen stammt oder von Excel, erkennt das CRM an der Dateiversion (kein Hin-und-her).
- **Reihenfolge:** In jedem Durchlauf schreibt der Server zuerst die vorgemerkten CRM-Änderungen nach Excel und liest erst danach Excel ein. Ein veralteter Excel-Stand kann so nie eine CRM-Änderung überschreiben. Ändern CRM und Excel gleichzeitig *dieselbe Zelle*, gewinnt das CRM; verschiedene Zellen derselben Zeile bleiben beide erhalten.
- **Im Browser:** Die App fragt alle 15 s (bei sichtbarem Tab) die Versionsnummer des eigenen Teams ab (angemeldet; ein anderes Team sieht die Version nie) und lädt Änderungen aus Excel oder von Kollegen automatisch nach («Aktualisiert aus Excel»), sofern man selbst nichts Ungespeichertes hat.
- **Zeitverhalten:** CRM → Excel meist innerhalb weniger Sekunden nach dem Speichern. Excel → CRM: Excel Online/Desktop speichert per AutoSave nach Sekunden; Microsoft meldet die Änderung meist nach Sekunden bis wenigen Minuten (**keine Garantie von Microsoft**); danach braucht der Browser höchstens 15 s. Als Sicherheitsnetz prüft die Scheduled Function alle 5 Minuten.
- **Ausfälle:** Ist Microsoft nicht erreichbar oder die Datei gesperrt/ausgecheckt, **speichert das CRM trotzdem**. Die Änderungen bleiben vorgemerkt («Wartende CRM-Änderungen»), der Fehler erscheint auf Deutsch in der Karte, und alle 5 Minuten wird es erneut versucht.
- **Abonnement:** Microsoft lässt Abonnements auf Dateien nach spätestens ca. 29 Tagen auslaufen. Die Scheduled Function verlängert es automatisch (spätestens 3 Tage vor Ablauf) und legt es bei Bedarf neu an, auch nach Änderung von `SITE_URL` oder `CRM_SECRET`.

### Regeln – damit der Abgleich zuverlässig bleibt

| Bitte | Warum |
|---|---|
| Blätter nicht umbenennen oder löschen (Kunden, Lieferantenstamm, Lieferanten, Aktivitäten, Angebote, Aufgaben, Kontakte). | Blätter werden über ihren Namen gefunden. Fehlt eines, meldet die Karte «Blatt … nicht gefunden – die Struktur der Excel-Datei wurde geändert». |
| Spaltenüberschriften nicht umbenennen. Spalten einfügen, verschieben oder zusätzliche eigene Spalten anlegen ist dagegen unkritisch. | Spalten werden über die Überschrift gefunden, nicht über die Position. Eine umbenannte Spalte wird nicht mehr abgeglichen (Hinweis im Protokoll), der Rest läuft weiter. |
| Die Spalte **«CRM-ID»** (ausgeblendet) nicht ändern, löschen oder überschreiben. | Sie ordnet jede Zeile ihrem CRM-Datensatz zu. Fehlt die Spalte, hält der Abgleich an («Spalte CRM-ID fehlt – bitte neu verknüpfen»). |
| Zeilen dürfen sortiert und gefiltert werden. | Die CRM-ID wandert mit der Zeile. Beachten Sie aber: Die Nummern-Formeln der Vorlage (z. B. Kundennr.) zählen nach Zeilenposition – dasselbe gilt für Excel-Nummern nach Sortieren oder Löschen. |
| Eine Zeile in Excel zu löschen oder zu leeren löscht **nichts** im CRM. | Das CRM löscht nie automatisch. Das Protokoll weist auf «nicht (mehr) in Excel» hin; löschen Sie den Datensatz bei Bedarf im CRM (dort wird die Zeile in Excel geleert). |
| Formeln der Vorlage nicht durch Werte ersetzen. | Zellen mit Formeln (Nummern, Kunden-/Lieferantennamen per Nachschlagen, gewichtete Werte) schreibt das CRM nie. Eine durch einen Wert ersetzte Formel wird dagegen als normaler Eingabewert behandelt. |

### Grenzen und gute Gründe für Aufmerksamkeit

- **Nummern in Excel und im CRM:** Die Vorlage vergibt Nummern per Formel (`10000 + Anzahl Zeilen − 1`), das CRM vergibt sie fortlaufend und nie wieder. Weichen sie nach dem Löschen/Umsortieren ab, bleibt der Abgleich über die CRM-ID korrekt; nur die *angezeigte* Nummer in Excel kann sich vom CRM unterscheiden.
- **Vorbereitete Formelzeilen:** Die Vorlage enthält Formeln bis Zeile 204 (Kunden, Lieferanten, Lieferantenstamm), 304 (Aktivitäten, Angebote) bzw. 303 (Aufgaben). Darunter meldet das CRM beim Schreiben einen Hinweis: Formeln bitte nach unten kopieren.
- **Zahlen und Datum:** Daten werden als echte Excel-Daten (`TT.MM.JJJJ`), Chance in Prozent geschrieben; Telefonnummern und ähnliche Texte bleiben Text (Excel zeigt ggf. einen Apostroph nicht an). Texte mit führendem `=`, `+`, `-`, `@` werden als Text geschützt.
- **Mehrere Kontakte:** Pro Zeile in Kunden/Lieferantenstamm nur der Hauptkontakt; weitere Kontakte stehen im Blatt «Kontakte» und können dort bearbeitet oder ergänzt werden (Spalte «Typ», «Kundennr.»/«Lieferantennr.» oder «Firma» zur Zuordnung).
- **Last/Kosten:** Jeder offene Browser-Tab fragt alle 15 s die Version ab (ca. 240 kleine Aufrufe pro Stunde); dazu kommt die Scheduled Function alle 5 Minuten. Prüfen Sie bei Netlify-Kontingenten für Function-Aufrufe, ob das zum Tarif passt.
- **Function-Laufzeit:** Netlify beendet Functions standardmässig nach 10 s (bei Bedarf in den Netlify-Einstellungen für Functions erhöhen). Das Verknüpfen läuft deshalb in kurzen Schritten; grosse Mengen vorgemerkter Änderungen werden über mehrere Durchläufe verteilt.
- **Konfigurierte Datei geändert:** Ändern Sie `SP_LIVE_PATH`, hält der Abgleich an, bis Sie **Neu verknüpfen** ausführen.
- **Rückbau:** Live-Sync pausieren. Die Spalte «CRM-ID» und das Blatt «Kontakte» dürfen stehen bleiben oder gelöscht werden (dann bei erneutem Verknüpfen neu angelegt).

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

Live-Sync:

| Meldung / Beobachtung | Ursache und Lösung |
|---|---|
| Karte fehlt in den Einstellungen | Sie sind kein Team-Admin (Mitglieder sehen die Karte nur bei aktivem Live-Sync) oder Ihr Team ist nicht das SharePoint-Team (`SP_TEAM_ID`). |
| Karte «Nicht eingerichtet» | `SP_LIVE_PATH` (oder `SP_IMPORT_PATH`) bzw. eine der `MS_*`/`SP_SITE`-Variablen fehlt; nach dem Setzen neu deployen. |
| Verbindungstest: «Keine Berechtigung … Schreibrechte (Sites.Selected, Rolle «write»)» | Die App hat nur Leserechte (Rolle `read`) oder keine Freigabe der Site: Schritt 3b mit `write` wiederholen bzw. Rolle per `PATCH …/permissions/{id}` ändern. |
| «Sofort-Benachrichtigung: nicht aktiv» | `SITE_URL` fehlt, ist kein öffentliches `https://` oder Microsoft konnte die Adresse nicht erreichen/bestätigen, oder die App-Berechtigung erlaubt kein Abonnement. Der Abgleich läuft trotzdem, alle 5 Minuten. Die Karte nennt den Grund. |
| «Datei ist gesperrt oder ausgecheckt» | Datei in SharePoint ausgecheckt oder gesperrt: einchecken bzw. schliessen. Die vorgemerkten Änderungen werden automatisch nachgeholt. |
| «Blatt … nicht gefunden» / «Kopfzeile nicht gefunden» / «Spalte CRM-ID fehlt» | Struktur der Datei geändert (siehe Regeln). Ursprünglichen Zustand wiederherstellen (SharePoint-Versionsverlauf) oder **Neu verknüpfen**. |
| «Die konfigurierte Datei (SP_LIVE_PATH) weicht von der verknüpften Datei ab» | Pfad geändert: **Neu verknüpfen** ausführen oder den alten Pfad wieder eintragen. |
| Änderungen aus Excel erscheinen erst nach Minuten | Microsoft verzögert die Meldung gelegentlich; spätestens der 5-Minuten-Lauf holt sie. Prüfen: Karte → «Sofort-Benachrichtigung aktiv bis …». Mit «Jetzt synchronisieren» sofort abgleichen. |
| «Hinweis(e)» im Protokoll, z. B. «CRM-ID doppelt» | Das Protokoll nennt die Ursache (unbekannte Spalte, Datensatz nicht mehr in Excel, …). Wird eine Zeile kopiert, steht ihre CRM-ID doppelt: Die Zeile, die zum Datensatz passt, behält sie; eine umbenannte Kopie wird ein neuer Datensatz mit eigener CRM-ID, eine unveränderte Kopie bleibt derselbe Datensatz (löschen Sie sie bei Bedarf). |
| Nach Änderung von `CRM_SECRET` kommen keine Sofort-Meldungen | Das Abonnement wird beim nächsten 5-Minuten-Lauf mit dem neuen Geheimnis neu angelegt (oder Live-Sync kurz pausieren und fortsetzen). |

Weitere Hinweise:

- Das Secret wird in Fehlermeldungen und im Status nie ausgegeben.
- Wer Schreibzugriff auf den SharePoint-Ordner hat, kann die Importdatei ändern: Nur Personen, denen Sie das auch im CRM zutrauen, sollten ihn haben.
