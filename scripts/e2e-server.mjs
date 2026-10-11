import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const envFile = resolve(process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const runtime = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
if (!runtime || !/(^|[_-])test([_-]|$)/i.test(new URL(runtime).pathname.slice(1))) throw new Error('E2E requires a dedicated TEST_DATABASE_URL.');
if (!redis || !/^\/(?:[1-9]|1[0-5])$/.test(new URL(redis).pathname)) throw new Error('E2E requires a separate nonzero Redis database.');
const mode = process.argv[2];
if (!['api', 'web'].includes(mode)) throw new Error('Expected api or web.');
const temporary = mkdtempSync(join(tmpdir(), 'peopleflow-e2e-'));
const emptyEnv = join(temporary, '.env');
writeFileSync(emptyEnv, '', { mode: 0o600 });
const env = {
  ...process.env, ENV_FILE: emptyEnv, NODE_ENV: mode === 'api' ? 'test' : 'production',
  DEPLOYMENT_ENV: 'development', DATABASE_URL: runtime, REDIS_URL: redis,
  WEB_ORIGIN: 'http://localhost:3000', API_INTERNAL_URL: 'http://127.0.0.1:4000',
  HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', PORT: mode === 'api' ? '4000' : '3000', TRUSTED_PROXY_HEADER: '',
  REDIS_PREFIX: `peopleflow-e2e-${randomUUID()}`, RATE_LIMIT_MAX: '500', RATE_LIMIT_LOGIN_MAX: '500',
};
for (const name of ['DATABASE_ADMIN_URL', 'TEST_DATABASE_URL', 'TEST_DATABASE_ADMIN_URL', 'TEST_REDIS_URL', 'SEED_PASSWORD', 'SEED_DEMO']) delete env[name];
if (mode === 'web') for (const name of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY']) delete env[name];
if (mode === 'web') cpSync('apps/web/.next/static', 'apps/web/.next/standalone/apps/web/.next/static', { recursive: true });
const args = mode === 'api' ? ['apps/api/dist/main.js'] : ['apps/web/.next/standalone/apps/web/server.js'];
const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { rmSync(temporary, { recursive: true, force: true }); process.exitCode = code ?? 0; });
