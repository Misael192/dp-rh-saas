#!/usr/bin/env bash
set -euo pipefail
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
[[ "$interval" =~ ^[0-9]+$ && "$interval" -ge 300 && "$interval" -le 604800 ]] || { echo 'Backup interval must be 300..604800 seconds.' >&2; exit 1; }
trap 'exit 0' TERM INT
while true; do
  bash "$(dirname "$0")/backup.sh"
  sleep "$interval" &
  wait $!
done
