#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2] ?? process.cwd());
const envPath = join(directory, '.env');
const secretDirectory = join(directory, '.secrets');
const secretPath = join(secretDirectory, 'backup.pgpass');
await mkdir(directory, { recursive: true, mode: 0o700 });
try { await stat(envPath); throw new Error('The .env file already exists; it was preserved.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await stat(secretPath); throw new Error('The backup credential already exists; it was preserved.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const postgresPassword = randomBytes(32).toString('hex');
const runtimePassword = randomBytes(32).toString('hex');
const redisPassword = randomBytes(32).toString('hex');
const values = {
  NODE_ENV: 'development', POSTGRES_DB: 'peopleflow', POSTGRES_USER: 'peopleflow_migration',
  POSTGRES_PASSWORD: postgresPassword, RUNTIME_DB_PASSWORD: runtimePassword, REDIS_PASSWORD: redisPassword,
  JWT_SECRET: randomBytes(48).toString('hex'), DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  API_PROXY_SECRET: randomBytes(48).toString('hex'), DEPLOYMENT_ENV: 'development', TRUSTED_PROXY_HEADER: '',
  DATABASE_URL: `postgresql://peopleflow_app:${runtimePassword}@postgres:5432/peopleflow?schema=public`,
  DATABASE_ADMIN_URL: `postgresql://peopleflow_migration:${postgresPassword}@postgres:5432/peopleflow?schema=public`,
  REDIS_URL: `redis://:${redisPassword}@redis:6379/0`, API_INTERNAL_URL: 'http://api:4000',
  WEB_ORIGIN: 'http://localhost:3000', HOST: '0.0.0.0', PORT: '4000',
  REDIS_PREFIX: 'peopleflow', RATE_LIMIT_MAX: '30', SEED_DEMO: 'false',
  SEED_PASSWORD: randomBytes(32).toString('hex'),
  TEST_DATABASE_URL: `postgresql://peopleflow_app:${runtimePassword}@postgres-test:5432/peopleflow_test?schema=public`,
  TEST_DATABASE_ADMIN_URL: `postgresql://peopleflow_migration:${postgresPassword}@postgres-test:5432/peopleflow_test?schema=public`,
  TEST_REDIS_URL: `redis://:${redisPassword}@redis:6379/1`,
  BACKUP_INTERVAL_SECONDS: '86400', BACKUP_RETENTION_DAYS: '14', BACKUP_PGPASSFILE: secretPath,
};
await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
const secretFile = await open(secretPath, 'wx', 0o600);
await secretFile.writeFile(`postgres:5432:*:peopleflow_migration:${postgresPassword}\n`);
await secretFile.close();
try {
  const envFile = await open(envPath, 'wx', 0o600);
  try { await envFile.writeFile(Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'); }
  finally { await envFile.close(); }
} catch (error) {
  await unlink(secretPath);
  throw error;
}
console.log('Created local .env and .secrets/backup.pgpass with private permissions. Values were not printed.');
