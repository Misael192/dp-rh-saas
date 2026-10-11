#!/usr/bin/env bash
set -euo pipefail
cd /app
if [[ "${NODE_ENV:-development}" == production || "${SEED_DEMO:-false}" != true ]]; then
  echo 'Demo seed requires SEED_DEMO=true and a non-production environment.' >&2
  exit 1
fi
: "${SEED_PASSWORD:?Choose SEED_PASSWORD securely before the local demo seed}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required for the local seed}"
export DATABASE_URL="$DATABASE_ADMIN_URL"
npm run db:seed
