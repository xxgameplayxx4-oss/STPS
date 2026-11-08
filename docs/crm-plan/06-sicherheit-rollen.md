# 06 – Sicherheit, Rollen & Rechte (MASTERPLAN Phase 8.1/8.2)

Stand: Code-Analyse `stps-crm/netlify/functions/lib/` (Pfade unten relativ dazu). Ziel-Hosting: Infomaniak VPS + MySQL, SharePoint nur für Dokumente.

## 1. Rollenmodell (Ist)

Nur **3 Rollen** (`users.mjs:12`): `superadmin` (Plattform, kein Team), `admin` (Team-Admin), `member`. Zusatzflag `management` (Zugang zu Chat-Kanal und Dateien «Geschäftsleitung», `roles.mjs:4`). Mandantentrennung über Schlüssel-Präfix `t/<teamId>/` (`teams.mjs:23`), Team kommt immer aus dem Konto (Header `X-CRM-Team` nur für Superadmin, `accounts.mjs:201-208`).

Die MASTERPLAN-Rollen Sales Manager / Sales Rep / Backoffice / Read Only **gibt es nicht**. Die Fachdaten (Kunden, Deals, Rechnungen …) liegen in **einem** JSON-Dokument `db` pro Team; der Server kennt dort keine Module.

## 2. Rechte-Matrix (aus dem Code)

C=anlegen, R=lesen, U=ändern, D=löschen, –=kein Zugriff, (R)=nur eigene Darstellung/Sicht, «Namen» = Stempel des Superadmins werden ausgeblendet (`hide-super.mjs`).

| Modul / Route | superadmin | admin | member (mit `management`) | member |
|---|---|---|---|---|
| Fachdaten `/db` (Kunden, Lieferanten, Artikel, Deals, RFQs, Rechnungen, Positionen, Versand, Aufgaben, Zertifikate-Daten) | CRUD (gewähltes Team) | CRUD | CRUD | CRUD (**alles**, `core.mjs:146,179`) |
| Warengruppen (Einstellung) | U | U | – (nur R, `core.mjs:205`) | – (nur R) |
| Backups `/backups` | R | R | R | R (`core.mjs:150-167`, **kein Rollencheck**) |
| Excel-Import/-Export `/import-xlsx`, `/export.xlsx` | CRUD (Import überschreibt) | CRUD | CRUD | CRUD (`core.mjs:170`, kein Rollencheck) |
| SharePoint-Einrichtung/Import/Status | CRUD | – | – | – (`core.mjs:234`) |
| SharePoint-Export (Karte) | ja | ja | ja | ja (nur Team mit Anbindung) |
| Wechselkurse aktualisieren | ja | ja | – | – (`core.mjs:130`) |
| Benutzer `/users` | CRUD alle Teams | CRUD eigenes Team (kein Superadmin sichtbar) | – | – (`accounts.mjs:283`) |
| Teams `/teams` | CRUD | – | – | – (`accounts.mjs:277`) |
| Darstellung/Logo `/branding` | CRUD | CRUD | R | R (`accounts.mjs:401`) |
| Änderungsprotokoll `/audit` | R (inkl. eigener Einträge) | R | R | R (**alle Mitglieder**, `accounts.mjs:299`) |
| Team-Seite / Anwesenheit | R | R | R | R |
| Chat Kanal «team» | CRU | CRU | CRU | CRU |
| Chat Kanal «Geschäftsleitung» | CRU | CRU | CRU | – (`chat.mjs:38`) |
| Dateien (Upload/Lesen) scope team | CRD | CRD | CRD | CRD |
| Dateien scope «mgmt» | CRD | CRD | CRD | – (`files.mjs:64`) |
| Datei löschen | ja | ja | nur eigene | nur eigene (`files.mjs:129`) |
| Kalender / Outlook-Verbindung | Plattform-Status | eigener Kalender | eigener | eigener (`outlook.mjs:755`) |
| Zertifikats-Alarme (Empfänger) | – | ja | ja | – (`cert-alerts.mjs:81`) |
| Eigenes Passwort ändern | ja | ja | ja | ja |

Datensatzbezogene Regeln («nur eigene Kunden», Team-Hierarchie): **nicht vorhanden**. `ownerKey` ist nur Anzeige-/Zuweisungsfeld.

## 3. Authentifizierung (Ist)

- **Passwort**: scrypt N=65536, r=8, p=1, 16 Byte Salt, Parameter pro Konto gespeichert (`users.mjs:18,33`); zeitkonstanter Vergleich; Schein-Hash bei unbekanntem Benutzer (`users.mjs:42`). Policy: 10–200 Zeichen, nicht = Benutzername, nicht = altes (`users.mjs:66`). Einmalpasswörter ~68 Bit, Pflicht-Wechsel (`mustChangePassword`, `accounts.mjs:249`).
- **Session**: zustandsloses HMAC-SHA256-Token `v2.<payload>.<sig>`, TTL 7 Tage (`session.mjs:6`), enthält uid/tokenVersion/exp. Bei **jeder** Anfrage werden Konto aktiv, tokenVersion und Team aktiv geprüft (`accounts.mjs:194-210`); Passwortwechsel/-Reset/Deaktivierung erhöhen tokenVersion → sofort ungültig. Token im Browser in `localStorage` (`js/api.js:26`).
- **Lockout**: 5 Fehlversuche / 15 min → 15 min Sperre je Benutzername **und** je IP, +500 ms Verzögerung (`login-throttle.mjs:55-58`, `accounts.mjs:23,149`). Gleiche Sperre für `/me/password`.
- **Erst-Anmeldung/Notfall**: `CRM_ADMIN_USER`+`CRM_PASSWORD` legt Superadmin an; `CRM_ADMIN_RESET` (einmalig, SHA-256 gemerkt) setzt dessen Passwort zurück, im `platform-audit` protokolliert (`accounts.mjs:39-77,129`).
- **Audit**: Datenänderungen (Feld-Diff mit Benutzer), Importe, Branding, Superadmin-Eintritt, Admin-Reset (`audit.mjs`, rollierend 2000 Einträge/Team).
- **Geheimnisse**: `CRM_SECRET` Pflicht ≥16 Zeichen (`session.mjs:7`); Outlook-Refresh-Tokens AES-verschlüsselt (`outlook.mjs:65`).
- Nicht vorhanden: MFA/SSO, Passwort-Selbstreset per E-Mail (Reset nur durch Admin), Logout-Widerruf, Login-Protokoll.

## 4. Befunde (nach Schweregrad)

### Hoch
1. **Entwicklungsmodus ist fail-open** (`devmode.mjs:140,143`; `core.mjs:73`): Ohne `CRM_PASSWORD` und solange kein Konto je angemeldet war (z. B. frische/geleerte MySQL-DB, Restore auf leere DB) ist die API **ohne Anmeldung** als Team-Admin «Pascal» bzw. Superadmin nutzbar, mit öffentlich bekanntem Schlüssel `DEV_SECRET` (`devmode.mjs:128`, `authenticate` `accounts.mjs:188`). Auf dem VPS zwingend `CRM_DEV_MODE=off` **und** `CRM_PASSWORD` setzen; Startup-Guard empfohlen (Prozess bricht ab, wenn `NODE_ENV=production` und Dev-Modus aktiv).
2. **Keine serverseitige Rechtetrennung für Fachdaten** (`core.mjs:146,179`): Jedes Mitglied kann das gesamte `db`-Dokument lesen/überschreiben, alle Backups lesen (`:150`), Excel komplett exportieren/importieren (`:170`) und das Protokoll lesen. Kein Read-Only, kein «nur eigene Kunden». Massen-Export/Datenabfluss und Manipulation durch ein einziges kompromittiertes Konto möglich. Für Go-live mindestens: Rolle `readonly` (PUT/Import → 403), Export/Backups nur `admin`/`management`, Warengruppen-Muster auf weitere Settings ausweiten; mittelfristig Modul-/Datensatzrechte (Abschnitt 5).
3. **Mandanten-/Rechte-Logik hängt an einem JSON-Blob** – bei Umzug auf MySQL (kv.mjs/store nicht Teil dieses Auftrags) müssen Team-Präfix-Isolation (`teams.mjs:16-39`) und `ifMatch`-Atomik (`mutateDoc`, genutzt in Login-Throttle, Users) 1:1 erhalten bleiben; sonst Race-Conditions bei Benutzer-/Throttle-Dokument. Testen, dass ein Team nie fremde Schlüssel erreicht.

### Mittel
4. **Client-IP auf VPS «unknown»** (`http.mjs:40`): Es wird nur `x-nf-client-connection-ip` (Netlify) gelesen. Hinter nginx/Caddy ergibt das für alle `ip:unknown` → 5 Fehlversuche irgendeines Nutzers sperren **alle** Logins 15 min (DoS), IP-Schutz wirkungslos. Fix: Reverse-Proxy setzt Header (`proxy_set_header X-Real-IP`), `clientIp` liest ihn nur von vertrauenswürdigem Proxy; Header von aussen verwerfen.
5. **Gezielte Konto-Sperre möglich** (`login-throttle.mjs:60`): Sperre je Benutzername ohne IP-Bezug – Angreifer sperrt bekannte Namen (admin) dauerhaft. Abmildern: IP+Name kombinieren, Admin-Entsperrung, Alarm.
6. **Throttle-Eviction** (`login-throttle.mjs:77-79`): Bei >500 Einträgen werden die ältesten gelöscht, auch gesperrte → Angreifer flutet mit Zufallsnamen und hebt Sperren auf. Gesperrte Einträge nie verdrängen.
7. **Token 7 Tage, `localStorage`, kein Logout-Widerruf** (`session.mjs:6`, `accounts.mjs:254`, `js/api.js:26`): `/logout` ändert nichts; gestohlenes Token gilt bis Ablauf oder Passwortwechsel. XSS-Risiko durch strikte CSP gemindert. Empfehlung: Logout erhöht `tokenVersion`, TTL 8–12 h mit Sliding-Refresh oder HttpOnly-Cookie (SameSite=Strict) + CSRF-Schutz.
8. **Passwort-Policy schwach**: nur Länge ≥10 (`users.mjs:13,66`), keine Prüfung gegen Passwortlisten; `CRM_PASSWORD` bleibt dauerhaft in der Umgebung und ist bei gesetztem `CRM_ADMIN_RESET` ein Superadmin-Schlüssel (`accounts.mjs:129`). Nach Erst-Anmeldung `CRM_PASSWORD` **und** `CRM_ADMIN_RESET` entfernen (Dev-Modus bleibt dank echter Konten aus – trotzdem `CRM_DEV_MODE=off`).
9. **Lücken im Zugriffsprotokoll** (`audit.mjs`, nur 4 Aufrufer): nicht protokolliert werden Logins/Fehlversuche, Benutzer anlegen/Rolle ändern/Passwort-Reset/Deaktivieren, Exporte, Backup-Lesen, Dateizugriffe. Protokoll rollierend 2000 Einträge – für DSG-Nachweis zu kurz. Sicherheitsrelevante Ereignisse in eigene, unveränderbare Tabelle.
10. **Sicherheits-Header nur in `netlify.toml`**: auf dem VPS fehlen CSP/HSTS/X-Frame-Options, falls nicht im Proxy nachgebaut; HSTS ohne `includeSubDomains`.

### Niedrig
11. Superadmin sieht alle Teams ohne 4-Augen-Prinzip; «enter» wird im Team-Audit vermerkt, aber vor Mitgliedern verborgen (`audit.mjs:71`, `hide-super.mjs`) – aus DSG-Sicht (Transparenz) prüfen.
12. Keine Passwort-Selbstreset-Funktion; Reset nur durch Admin mit Klartext-Einmalpasswort in API-Antwort (`accounts.mjs:441,449`) – ok über TLS, nicht loggen.
13. `HEAD`/Fehlermeldungen: `reason`=Fehlername an Client (`api.mjs:74`) – geringe Info-Preisgabe.
14. Dateien: Whitelist PDF/PNG/JPEG/WebP mit Magic-Byte-Prüfung (`files.mjs:20-32`) – gut; Virenscan fehlt.
15. `login()` liefert bei richtigem Passwort `inactive`/`team_inactive` (`accounts.mjs:152`) – Kontostatus-Preisgabe nur nach Passwortkenntnis, vernachlässigbar.

Kein High-Befund war ein «kleiner, sicherer» Code-Fix (Dev-Modus ist beabsichtigt, Rechte-Modell ist Architekturfrage) → **keine Code-Änderungen vorgenommen**.

## 5. Empfehlung Rollen (Ziel)

`superadmin` → Plattform; `admin`; `sales_manager` (Team-Daten CRUD, Berichte, Export); `sales_rep` (nur eigene Datensätze `ownerKey` = Nutzer, Team-Kunden lesen); `backoffice` (Rechnungen/Versand/Artikel CRUD, Kunden R); `readonly` (R, kein Export). Serverseitig als Matrix `rolle × modul × {C,R,U,D}` + Scope `own|team`, Prüfung in einer zentralen Funktion vor jedem Handler (heute fehlt sie). Nach MySQL-Migration Fachdaten in Tabellen statt Blob, damit Rechte je Datensatz durchsetzbar sind.

## 6. Go-live-Checkliste

- **TLS**: Let's Encrypt via Caddy/nginx, TLS ≥1.2, HTTP→HTTPS, HSTS (`max-age=31536000; includeSubDomains`), MySQL nur lokal/privat, Verbindung mit TLS.
- **Secrets**: `CRM_SECRET` = `openssl rand -hex 32`, nur in Env-Datei (chmod 600) bzw. Secret-Store, nie im Repo; Rotation planen (macht alle Sessions ungültig); DB-User mit minimalen Rechten; MS-Client-Secret mit Ablaufdatum; `CRM_PASSWORD`/`CRM_ADMIN_RESET` nach Erst-Anmeldung entfernen.
- **Dev-Modus aus**: `CRM_DEV_MODE=off`, `NODE_ENV=production`, Start-Guard, nach Deployment `GET /api/ping` darf kein `dev:true` liefern und `/api/dev/session` muss 404 geben (Monitoring-Check).
- **Header** (am Proxy): CSP wie `netlify.toml`, X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, COOP/CORP; `Cache-Control: no-store` für `/api`.
- **Rate-Limits**: Proxy-Limit (z. B. 10 req/s/IP global, 5/min auf `/api/login`), Client-IP korrekt durchreichen (Befund 4), max. Body-Grössen (bereits 5/10 MB), Fail2ban auf Proxy-Log.
- **2FA-Option**: TOTP (RFC 6238, Secret verschlüsselt pro Konto, 10 Recovery-Codes), Pflicht für `superadmin`/`admin`, optional für übrige; alternativ SSO via Microsoft Entra ID (OIDC), da M365 ohnehin im Einsatz – dann lokale Passwörter für Nutzer abschalten.
- **Passwort-Policy**: Länge ≥12, Prüfung gegen Liste häufiger/geleakter Passwörter (z. B. HIBP-k-Anonymity oder lokale Top-10k), kein Ablauf-Zwang (NIST), Sperre/Alarm bei Serienfehlern.
- **Betrieb**: automatische OS-Updates, Firewall (nur 80/443/SSH-Schlüssel), tägliche verschlüsselte DB-Backups ausserhalb des VPS (Infomaniak Backup/Swiss Backup), Restore-Test, Log-Aufbewahrung ≥6 Monate, Monitoring (Uptime, 5xx, Login-Fehler).


## Status Härtung (Nachtrag)

- Befund 1 (Dev-Modus fail-open): **behoben** – `devEnvEnabled` ist false bei NODE_ENV/CRM_ENV=production (env oder process.env) oder VPS-Betrieb (DB_DRIVER=mysql / DB_HOST); `withDevEnv` ersetzt in Produktion nie das Secret. Ohne CRM_SECRET lehnt `core.mjs` die API weiterhin ab (HTTP 500 `not_configured`; 503 wäre ein Einzeiler in core.mjs, nicht angefasst).
- Befund 4 (Client-IP «unknown»): **behoben** – `clientIp` liest mit `TRUST_PROXY=1` nur X-Real-IP / ersten X-Forwarded-For-Eintrag (Netlify-Header dann ignoriert), nginx überschreibt beide und leert `X-Nf-Client-Connection-Ip`. Unbekannte IP → `""`, Throttle dann nur je Benutzername (kein gemeinsamer Topf).
- Befund 6 (Throttle-Eviction): **behoben** – gesperrte Einträge werden nie verdrängt; Überlauf (2000) entfernt zuerst ungesperrte mit wenigsten Fehlversuchen.
- Token-Widerruf beim Logout: **offen/übersprungen** – `tokenVersion` existiert bereits; der Logout-Handler (`accounts.mjs:254`, ausserhalb des Auftrags) müsste sie erhöhen (`U.bumpTokenVersion`-artiger Aufruf). session.mjs allein genügt nicht.
- Test: `npm run test:security`.
