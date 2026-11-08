#!/usr/bin/env bash
# STPS CRM - verschluesselte MySQL-Sicherung (mysqldump | gzip | age/gpg) mit Rotation.
# Konfiguration ausschliesslich per Umgebung (siehe backup.env.example in der Doku 07-backup-konzept.md).
#   Pflicht:  DB_HOST DB_NAME DB_USER DB_PASSWORD  BACKUP_DIR  und (AGE_RECIPIENT | GPG_RECIPIENT)
#   Optional: DB_PORT (3306)  ENCRYPTION (age|gpg, Standard age)  KEEP_DAILY_DAYS (30)  KEEP_MONTHLY_MONTHS (120)
#             SYNC_TARGET (rsync-Ziel fuer 2. Standort, z. B. backup@host:/srv/stps-backup/)  HEALTHCHECK_URL
set -euo pipefail
umask 077

: "${DB_HOST:?DB_HOST fehlt}" "${DB_NAME:?DB_NAME fehlt}" "${DB_USER:?DB_USER fehlt}" "${DB_PASSWORD:?DB_PASSWORD fehlt}"
: "${BACKUP_DIR:?BACKUP_DIR fehlt}"
DB_PORT="${DB_PORT:-3306}"
ENCRYPTION="${ENCRYPTION:-age}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-30}"
KEEP_MONTHLY_MONTHS="${KEEP_MONTHLY_MONTHS:-120}"

case "$ENCRYPTION" in
  age) : "${AGE_RECIPIENT:?AGE_RECIPIENT fehlt (oeffentlicher age-Schluessel, age1...)}"; ext="age" ;;
  gpg) : "${GPG_RECIPIENT:?GPG_RECIPIENT fehlt}"; ext="gpg" ;;
  *) echo "ENCRYPTION muss age oder gpg sein" >&2; exit 2 ;;
esac

log() { printf '%s backup: %s\n' "$(date -Iseconds)" "$*"; }

daily_dir="$BACKUP_DIR/daily"
monthly_dir="$BACKUP_DIR/monthly"
mkdir -p "$daily_dir" "$monthly_dir"

stamp="$(date +%Y-%m-%d)"
month="$(date +%Y-%m)"
base="stps-crm_${stamp}.sql.gz.${ext}"
tmp="$daily_dir/.${base}.part"
trap 'rm -f "$tmp" "${cnf:-}"' EXIT

# Zugangsdaten nie auf der Kommandozeile (ps) zeigen: temporaere Optionsdatei.
cnf="$(mktemp)"
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "$DB_PASSWORD" "$DB_HOST" "$DB_PORT" > "$cnf"

encrypt() {
  if [ "$ENCRYPTION" = "age" ]; then
    # AGE_RECIPIENT darf mehrere Empfaenger enthalten (Leerzeichen getrennt).
    local args=() r
    for r in $AGE_RECIPIENT; do args+=(-r "$r"); done
    age "${args[@]}"
  else
    gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT"
  fi
}

# --set-gtid-purged kennt nur Oracle-MySQL; MariaDB-mysqldump bricht sonst ab.
gtid_opt=(); if mysqldump --help 2>/dev/null | grep -q -- '--set-gtid-purged'; then gtid_opt=(--set-gtid-purged=OFF); fi

log "Dump von ${DB_NAME}@${DB_HOST} startet"
mysqldump --defaults-extra-file="$cnf" --single-transaction --routines --triggers --events \
  --default-character-set=utf8mb4 "${gtid_opt[@]}" --no-tablespaces "$DB_NAME" \
  | gzip -9 | encrypt > "$tmp"

[ -s "$tmp" ] || { log "FEHLER: leere Sicherung"; exit 1; }
mv "$tmp" "$daily_dir/$base"
log "geschrieben: $daily_dir/$base ($(du -h "$daily_dir/$base" | cut -f1))"

# Monatssicherung: erste Sicherung eines Monats bleibt 120 Monate (10 Jahre).
if ! compgen -G "$monthly_dir/stps-crm_${month}-*" > /dev/null; then
  cp -p "$daily_dir/$base" "$monthly_dir/$base"
  log "Monatssicherung angelegt: $monthly_dir/$base"
fi

# Rotation anhand des Datums im Dateinamen (nicht mtime, robust gegen Kopieren).
daily_cut="$(date -d "-${KEEP_DAILY_DAYS} days" +%Y-%m-%d)"
monthly_cut="$(date -d "-${KEEP_MONTHLY_MONTHS} months" +%Y-%m-%d)"
rotate() { # Verzeichnis, Grenzdatum
  local f d
  for f in "$1"/stps-crm_*.sql.gz.*; do
    [ -e "$f" ] || continue
    d="${f##*/stps-crm_}"; d="${d:0:10}"
    if [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ "$d" < "$2" ]]; then
      rm -f -- "$f"; log "geloescht (Aufbewahrung abgelaufen): $f"
    fi
  done
}
rotate "$daily_dir" "$daily_cut"
rotate "$monthly_dir" "$monthly_cut"

# Zweiter Standort (3-2-1): Spiegel ohne --delete-Risiko fuer Monatsarchiv -> --delete nur auf daily/.
if [ -n "${SYNC_TARGET:-}" ]; then
  rsync -a --delete "$daily_dir/" "${SYNC_TARGET%/}/daily/"
  rsync -a "$monthly_dir/" "${SYNC_TARGET%/}/monthly/"
  log "Sync nach $SYNC_TARGET fertig"
fi

[ -z "${HEALTHCHECK_URL:-}" ] || curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || log "Healthcheck-Ping fehlgeschlagen"
log "fertig"
