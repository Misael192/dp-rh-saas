#!/usr/bin/env bash
set -euo pipefail
cd /app
: "${TEST_DATABASE_URL:?An isolated TEST_DATABASE_URL is required}"
: "${TEST_DATABASE_ADMIN_URL:?An isolated TEST_DATABASE_ADMIN_URL is required}"
: "${TEST_REDIS_URL:?An isolated TEST_REDIS_URL is required}"
node infra/scripts/check-test-database.mjs
export DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL"
export DATABASE_URL="$TEST_DATABASE_ADMIN_URL"
npm run db:migrate
node infra/scripts/apply-grants.mjs
npm run test
npm run test:integration
