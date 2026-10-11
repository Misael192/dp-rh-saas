#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?PGPASSFILE is required}"
: "${RESTORE_DATABASE:?Choose a new disposable database name}"
[[ "${RESTORE_CONFIRM:-}" == disposable ]] || { echo 'Set RESTORE_CONFIRM=disposable for the rehearsal.' >&2; exit 1; }
[[ "$RESTORE_DATABASE" =~ ^peopleflow_restore_[a-z0-9_]{1,40}$ ]] || { echo 'Restore name must use the peopleflow_restore_ prefix.' >&2; exit 1; }
archive="${1:?Pass a PeopleFlow .dump archive}"
archive=$(realpath -- "$archive")
[[ -f "$archive" && -f "$archive.sha256" ]] || { echo 'Archive and checksum sidecar are required.' >&2; exit 1; }
archive_name=$(basename -- "$archive")
[[ "$archive_name" =~ ^peopleflow_[0-9]{8}T[0-9]{6}Z_[0-9]+\.dump$ ]] || { echo 'Unexpected archive filename.' >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum --check --status -- "$archive_name.sha256")
pg_restore --list "$archive" >/dev/null
# Abort if the target exists. No production database is dropped or overwritten.
exists=$(PGDATABASE=postgres psql --set ON_ERROR_STOP=1 --tuples-only --no-align \
  --set restore_database="$RESTORE_DATABASE" <<'SQL'
SELECT count(*) FROM pg_database WHERE datname = :'restore_database';
SQL
)
[[ "$exists" == 0 ]] || { echo 'Disposable restore target already exists; preserved without changes.' >&2; exit 1; }
PGDATABASE=postgres psql --set ON_ERROR_STOP=1 --set restore_database="$RESTORE_DATABASE" <<'SQL'
SELECT format('CREATE DATABASE %I', :'restore_database') \gexec
SQL
PGDATABASE="$RESTORE_DATABASE" pg_restore --exit-on-error --no-owner --no-privileges --dbname "$RESTORE_DATABASE" "$archive"
PGDATABASE="$RESTORE_DATABASE" psql --set ON_ERROR_STOP=1 <<'SQL'
SELECT 'tenants' AS table_name, count(*) AS rows FROM tenants
UNION ALL SELECT 'companies', count(*) FROM companies
UNION ALL SELECT 'employees', count(*) FROM employees;
SQL
echo "Restore rehearsal passed in disposable database $RESTORE_DATABASE. Database retained for review."
