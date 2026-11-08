# 12 – Go-live-Runbook Infomaniak (VPS + MySQL)

Zielbild: Nginx (TLS) → Node-Server (`stps-crm/server/server.mjs`, systemd) → Infomaniak Managed MySQL. Geplante Aufgaben laufen im Node-Prozess (keine Cron-Einträge nötig).

## 0. Zuständigkeiten
- **Kunde (Bestellung/Vertrag, Zahlungsmittel):** VPS und Managed Database bei Infomaniak bestellen und uns Zugang geben (Admin-Zugang zum Infomaniak-Manager oder SSH-Schlüssel + DB-Zugangsdaten). Auch die Domain/DNS-Verwaltung liegt beim Kunden.
- **Wir:** Einrichtung, Deployment, Migration, Betrieb.

## 1. Bestellung (Kunde)
1. VPS: Ubuntu 22.04/24.04 LTS, klein (z. B. 2 vCPU / 4 GB RAM, 40 GB SSD reicht), Standort Schweiz. Öffentlichen SSH-Schlüssel von uns hinterlegen.
2. Managed MySQL 8 (Infomaniak «Datenbank-Service»): kleine Instanz, Datenbank `stps_crm`, Benutzer mit Rechten nur auf diese DB. **Zugriff nur von der VPS-IP** erlauben (IP-Whitelist); TLS verlangen.
3. Zugangsdaten sicher übermitteln (Passwortmanager, nicht per E-Mail).

## 2. DNS
- A-Record (und AAAA) für `crm.<kundendomain>.ch` auf die VPS-IP. TTL vorher auf 300 s senken.
- Warten, bis `dig +short crm.<domain>` die IP liefert.

## 3. Server vorbereiten
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx certbot python3-certbot-nginx git ufw curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt -y install nodejs
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
sudo useradd --system --create-home --shell /usr/sbin/nologin stps
sudo mkdir -p /opt/stps && sudo chown stps:stps /opt/stps
sudo -u stps git clone <REPO-URL> /opt/stps      # Deploy-Key/Token read-only
```
Für `deploy.sh` braucht der Benutzer, der es ausführt, `sudo systemctl restart stps-crm` ohne Passwort (sudoers-Eintrag) – alternativ das Skript als Admin-Benutzer mit Schreibrecht auf `/opt/stps` starten.

## 4. Konfiguration (Env)
```bash
sudo cp /opt/stps/stps-crm/ops/deploy/.env.example /etc/stps-crm.env
sudo chown root:root /etc/stps-crm.env && sudo chmod 600 /etc/stps-crm.env
sudo nano /etc/stps-crm.env
```
Pflicht: `DB_DRIVER=mysql`, `DB_HOST/PORT/USER/PASSWORD/NAME`, `DB_SSL=1`, `CRM_SECRET` (`openssl rand -hex 32`), `APP_URL`, für die Erst-Anmeldung `CRM_PASSWORD` + `CRM_ADMIN_USER`. Optional: VAPID, Resend, Microsoft/SharePoint. Hinweis: ohne `CRM_PASSWORD` und ohne echte Konten gilt der Entwicklungsmodus (ohne Login) – in Produktion deshalb immer setzen, danach `CRM_DEV_MODE=off`.

## 5. Erstes Deployment
```bash
cd /opt/stps/stps-crm && sudo -u stps npm ci --omit=dev
sudo cp ops/deploy/stps-crm.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now stps-crm
curl -fsS http://127.0.0.1:8888/healthz          # ok
journalctl -u stps-crm -n 30 --no-pager           # Zeitpläne gelistet?
```

## 6. Nginx und TLS (Let's Encrypt)
```bash
sudo cp ops/deploy/nginx-stps-crm.conf /etc/nginx/sites-available/stps-crm
sudo sed -i 's/crm.example.ch/crm.<kundendomain>.ch/g' /etc/nginx/sites-available/stps-crm
```
Zertifikat zuerst holen (Konfiguration referenziert es): vorübergehend nur den Port-80-Block aktivieren oder `sudo certbot certonly --nginx -d crm.<domain>`; danach Site aktivieren:
```bash
sudo ln -s /etc/nginx/sites-available/stps-crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run                      # automatische Erneuerung prüfen
```
Test: `curl -I https://crm.<domain>/` (Header vorhanden), `https://crm.<domain>/api/ping`.

## 7. Datenmigration (Netlify Blobs → MySQL)
Nur falls bisher Daten auf Netlify liegen. Reihenfolge:
1. Trockenlauf: `NETLIFY_SITE_ID=… NETLIFY_BLOBS_TOKEN=… DB_…=… npm run migrate:mysql -- --dry-run`
2. Sicherung der Quelle: `npm run migrate:mysql -- --export blobs-export.json` (Datei sicher ablegen, enthält Kundendaten).
3. Schreibsperre ankündigen (alte Site nicht mehr benutzen), dann `npm run migrate:mysql` (idempotent, kann wiederholt werden; `--prefix t/<teamId>/` für einzelne Teams, `--from file --file export.json` aus einer Datei).
4. Stichproben in der neuen App: Anzahl Kunden/Dokumente, Anmeldung, Dateien öffnen.
5. Ohne Altdaten: Erst-Anmeldung mit `CRM_ADMIN_USER`/`CRM_PASSWORD`, danach `CRM_PASSWORD` aus der Env entfernen und Dienst neu starten.

## 8. Umschalten (Go-live)
1. Funktionstest laut Dokument 11 (Smoke-Test).
2. DNS der produktiven Adresse auf die VPS-IP (bzw. bei bestehender Adresse: A-Record ändern, TTL war bereits 300 s).
3. Alte Netlify-Site einige Tage unverändert lassen (Rückfallebene), Zeitpläne dort deaktivieren, damit keine Doppel-Mails/Push entstehen.
4. Nutzer informieren; installierte PWA lädt beim nächsten Öffnen neu.

## 9. Betrieb
- Updates: `bash /opt/stps/stps-crm/ops/deploy/deploy.sh main` (git pull, `npm ci --omit=dev`, Neustart, Health-Check).
- Logs: `journalctl -u stps-crm -f`, nginx: `/var/log/nginx/`.
- Backups: Infomaniak-DB-Backups aktivieren und Aufbewahrung prüfen; zusätzlich wöchentlich `mysqldump` (SSL) an einen separaten Ort. Wiederherstellung einmal testen.
- Sicherheits-Updates: `unattended-upgrades` aktivieren.

## 10. Rollback
- **Code:** `DEPLOY_REF=<vorheriger-commit> bash stps-crm/ops/deploy/deploy.sh` (der Commit wird beim Deploy ausgegeben; `git log` zeigt ihn). Das Skript prüft danach den Health-Check.
- **Daten:** DB-Backup von Infomaniak (Point-in-Time/Snapshot) zurückspielen; vorher den Dienst stoppen (`systemctl stop stps-crm`). Nach einer Migration gilt die Sicherung aus Schritt 7.2.
- **Gesamt-Rückfall:** DNS zurück auf Netlify (TTL 300 s), sofern die alte Site noch intakt ist; Änderungen, die nur in MySQL entstanden, gehen dabei verloren – Export vorher sichern.
- Danach Ursache klären, Fix über Staging (Dokument 11) neu ausrollen.

## Checkliste
- [ ] VPS + MySQL vom Kunden bestellt, IP-Whitelist gesetzt
- [ ] DNS zeigt auf VPS
- [ ] `/etc/stps-crm.env` vollständig, Rechte 600
- [ ] Dienst läuft, `/healthz` ok
- [ ] TLS aktiv, `certbot renew --dry-run` ok
- [ ] Daten migriert und stichprobenartig geprüft
- [ ] `CRM_PASSWORD` entfernt, `CRM_DEV_MODE=off`
- [ ] Backups aktiv und Wiederherstellung getestet
