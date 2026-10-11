import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
import { AppConfig } from './common/config';

async function main() {
  const envPath = process.env.ENV_FILE ?? [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(existsSync);
  if (envPath) process.loadEnvFile(envPath);
  const app = await createApp();
  const config = app.get(AppConfig);
  try { await app.listen(config.values.PORT, config.values.HOST); } catch (error) { await app.close(); throw error; }
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'api.started', port: config.values.PORT })}\n`);
}
main().catch(() => { process.stderr.write('{"level":"error","event":"api.startup_failed","message":"Check configuration and dependency readiness; secrets are omitted."}\n'); process.exitCode = 1; });
