#!/usr/bin/env bash
# Aktualisiert das STPS CRM auf dem VPS. Aufruf als Benutzer "stps" im Repo: bash stps-crm/ops/deploy/deploy.sh [branch]
# Rollback: DEPLOY_REF=<commit> bash stps-crm/ops/deploy/deploy.sh
set -euo pipefail
REPO_DIR="${REPO_DIR:-/opt/stps}"
BRANCH="${1:-main}"
cd "$REPO_DIR"
PREV="$(git rev-parse HEAD)"
echo "Vorher: $PREV"
git fetch --prune origin
if [ -n "${DEPLOY_REF:-}" ]; then git checkout --detach "$DEPLOY_REF"; else git checkout "$BRANCH"; git pull --ff-only origin "$BRANCH"; fi
cd stps-crm
npm ci --omit=dev
sudo systemctl restart stps-crm
sleep 2
if curl -fsS http://127.0.0.1:"${PORT:-8888}"/healthz >/dev/null; then
  echo "OK: $(git rev-parse --short HEAD) läuft."
else
  echo "FEHLER: Health-Check fehlgeschlagen. Zurück: DEPLOY_REF=$PREV bash stps-crm/ops/deploy/deploy.sh" >&2
  sudo journalctl -u stps-crm -n 30 --no-pager >&2
  exit 1
fi
