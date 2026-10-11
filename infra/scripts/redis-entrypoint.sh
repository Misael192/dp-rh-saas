#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
[[ "$REDIS_PASSWORD" != *$'\n'* && "$REDIS_PASSWORD" != *$'\r'* ]] || { echo 'Redis password must not contain a line break.' >&2; exit 1; }
escaped_password="${REDIS_PASSWORD//\\/\\\\}"
escaped_password="${escaped_password//\"/\\\"}"
printf 'appendonly yes\nprotected-mode yes\nrequirepass "%s"\n' "$escaped_password" > /data/peopleflow.conf
unset escaped_password
exec redis-server /data/peopleflow.conf
