#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?Mount a protected PGPASSFILE; do not use a password in arguments}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
[[ -r "$PGPASSFILE" ]] || { echo 'PGPASSFILE is not readable.' >&2; exit 1; }
[[ "$BACKUP_DIR" == /* && "$BACKUP_DIR" != / ]] || { echo 'BACKUP_DIR must be an explicit absolute directory.' >&2; exit 1; }
retention="${BACKUP_RETENTION_DAYS:-14}"
[[ "$retention" =~ ^[0-9]+$ && "$retention" -ge 1 && "$retention" -le 3650 ]] || { echo 'Invalid backup retention.' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
temporary=$(mktemp "$BACKUP_DIR/.peopleflow-backup.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file "$temporary"
pg_restore --list "$temporary" >/dev/null
name="peopleflow_$(date -u +%Y%m%dT%H%M%SZ)_$$.dump"
[[ ! -e "$BACKUP_DIR/$name" ]] || { echo 'Backup filename collision.' >&2; exit 1; }
mv -- "$temporary" "$BACKUP_DIR/$name"
(cd "$BACKUP_DIR" && sha256sum -- "$name" > "$name.sha256" && sha256sum --check --status -- "$name.sha256")
# Only this script's archives and checksum sidecars are subject to retention.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'peopleflow_*.dump' -mtime "+$retention" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'peopleflow_*.dump.sha256' -mtime "+$retention" -delete
echo "Backup created and archive/checksum verified: $name"
