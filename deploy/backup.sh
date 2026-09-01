#!/usr/bin/env bash
#
# HexCrawl VTT — campaign backup.
#
# Pulls one campaign's full export (DB rows + uploaded images, base64-embedded)
# from a running instance and keeps the N most recent copies. Intended for cron
# or a systemd timer; see deploy/RUNBOOK.md ("Backups").
#
# The archive contains NO secrets: no DM/player invite keys and no seat auth
# tokens. Restoring it creates a NEW campaign with fresh keys (the "Restore from
# backup" button on the landing page, or POST /api/campaigns/import).
#
# Usage:
#   HEXCRAWL_URL=https://hex-crawl.example \
#   HEXCRAWL_CAMPAIGN=abc123 \
#   HEXCRAWL_DM_KEY=... \
#   BACKUP_DIR=/var/backups/hexcrawl \
#   KEEP=14 \
#   ./backup.sh
#
# Optional: COMPRESS=0 (keep raw .json), CURL_TIMEOUT=<seconds>.
#
# Multiple campaigns: run it once per campaign with a different
# HEXCRAWL_CAMPAIGN / HEXCRAWL_DM_KEY (and, if you like, BACKUP_DIR).
#
set -euo pipefail

URL="${HEXCRAWL_URL:?set HEXCRAWL_URL, e.g. https://hex-crawl.example}"
CAMPAIGN="${HEXCRAWL_CAMPAIGN:?set HEXCRAWL_CAMPAIGN to the campaign id}"
DM_KEY="${HEXCRAWL_DM_KEY:?set HEXCRAWL_DM_KEY to the DM key for that campaign}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hexcrawl}"
KEEP="${KEEP:-14}"
# gzip the archive (base64 images compress well). Set COMPRESS=0 for raw JSON.
# (Do not name this GZIP — gzip itself reads that variable as extra options.)
COMPRESS="${COMPRESS:-1}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
tmp="$(mktemp "${BACKUP_DIR}/.hexcrawl-${CAMPAIGN}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# --fail-with-body so an HTTP error (403 wrong key, 404 wrong id) is a failure
# with a readable message rather than a "successful" file full of JSON error.
if ! curl --fail-with-body --silent --show-error --location \
  --max-time "${CURL_TIMEOUT:-600}" \
  --output "$tmp" \
  "${URL%/}/api/campaigns/${CAMPAIGN}/export?key=${DM_KEY}"; then
  echo "hexcrawl-backup: export failed for campaign ${CAMPAIGN}" >&2
  [ -s "$tmp" ] && head -c 500 "$tmp" >&2 && echo >&2
  exit 1
fi

# Cheap sanity check: it must look like our archive, not an error page.
if ! head -c 200 "$tmp" | grep -q '"formatVersion"'; then
  echo "hexcrawl-backup: response is not a HexCrawl export" >&2
  exit 1
fi

dest="${BACKUP_DIR}/hexcrawl-${CAMPAIGN}-${stamp}.json"
mv "$tmp" "$dest"
trap - EXIT
if [ "$COMPRESS" != "0" ]; then
  gzip -f "$dest"
  dest="${dest}.gz"
fi
chmod 600 "$dest"
echo "hexcrawl-backup: wrote $dest ($(du -h "$dest" | cut -f1))"

# Prune: keep the KEEP newest archives for THIS campaign only.
# shellcheck disable=SC2012
ls -1t "${BACKUP_DIR}/hexcrawl-${CAMPAIGN}-"*.json* 2>/dev/null \
  | tail -n "+$((KEEP + 1))" \
  | while read -r old; do
      echo "hexcrawl-backup: pruning $old"
      rm -f -- "$old"
    done
