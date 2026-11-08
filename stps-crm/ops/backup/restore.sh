#!/usr/bin/env bash
# STPS CRM - Wiederherstellung aus einer verschluesselten Sicherung.
# Aufruf: restore.sh <sicherung.sql.gz.age|.gpg> [Zieldatenbank]
#   Pflicht-Umgebung: DB_HOST DB_USER DB_PASSWORD, bei age: AGE_IDENTITY (Pfad zur privaten Schluesseldatei)
#   Ohne Zieldatenbank wird in "<DB_NAME>_restoretest" geladen (gefahrlos). Produktiv nur mit CONFIRM_OVERWRITE=yes.
set -euo pipefail
umask 077

file="${1:?Aufruf: restore.sh <sicherung> [zieldatenbank]}"
: "${DB_HOST:?DB_HOST fehlt}" "${DB_USER:?DB_USER fehlt}" "${DB_PASSWORD:?DB_PASSWORD fehlt}"
DB_PORT="${DB_PORT:-3306}"
target="${2:-${DB_NAME:-stps}_restoretest}"
[ -r "$file" ] || { echo "Datei nicht lesbar: $file" >&2; exit 2; }

if [ -n "${DB_NAME:-}" ] && [ "$target" = "$DB_NAME" ] && [ "${CONFIRM_OVERWRITE:-}" != "yes" ]; then
  echo "Ziel ist die Produktionsdatenbank. Zum Ueberschreiben CONFIRM_OVERWRITE=yes setzen." >&2
  exit 3
fi
if [[ ! "$target" =~ ^[A-Za-z0-9_]+$ ]]; then echo "Ungueltiger Datenbankname" >&2; exit 2; fi

cnf="$(mktemp)"
trap 'rm -f "$cnf"' EXIT
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "$DB_PASSWORD" "$DB_HOST" "$DB_PORT" > "$cnf"

decrypt() {
  case "$file" in
    *.age) : "${AGE_IDENTITY:?AGE_IDENTITY fehlt (private Schluesseldatei)}"; age -d -i "$AGE_IDENTITY" "$file" ;;
    *.gpg) gpg --batch --decrypt "$file" ;;
    *) echo "Unbekannte Endung (erwartet .age oder .gpg)" >&2; return 2 ;;
  esac
}

# Integritaet vorab pruefen, bevor irgendetwas geschrieben wird.
echo "Pruefe Entschluesselung und gzip ..."
decrypt | gzip -t

echo "Lade in Datenbank ${target} auf ${DB_HOST} ..."
mysql --defaults-extra-file="$cnf" -e "CREATE DATABASE IF NOT EXISTS \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
decrypt | gunzip | mysql --defaults-extra-file="$cnf" "$target"

echo "Kontrolle (Zeilen je Tabelle):"
mysql --defaults-extra-file="$cnf" -N -e "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema='${target}' ORDER BY table_name"
echo "Wiederherstellung abgeschlossen: ${target}"
