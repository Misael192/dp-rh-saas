#!/usr/bin/env bash
set -euo pipefail
cd /app
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required for the migration job}"
export DATABASE_URL="$DATABASE_ADMIN_URL"
npm run db:migrate
# Use Prisma's installed PostgreSQL driver to apply a fixed, reviewed SQL file.
# No password is placed in CLI arguments and this does not grant DDL to runtime.
node infra/scripts/apply-grants.mjs
