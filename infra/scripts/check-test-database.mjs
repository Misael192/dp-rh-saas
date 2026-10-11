#!/usr/bin/env node
const admin = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
const runtime = new URL(process.env.TEST_DATABASE_URL ?? '');
const name = decodeURIComponent(admin.pathname.slice(1));
if (name !== 'peopleflow_test' || admin.hostname !== 'postgres-test' || runtime.pathname !== admin.pathname || runtime.hostname !== admin.hostname) {
  throw new Error('Compose tests require the isolated postgres-test/peopleflow_test database');
}
if (decodeURIComponent(runtime.username) !== 'peopleflow_app') {
  throw new Error('Integration tests must use the non-privileged peopleflow_app runtime role');
}
