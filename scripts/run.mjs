import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile=process.env.ENV_FILE || resolve(root,'.env');
if(existsSync(envFile)) process.loadEnvFile(envFile);
const task=process.argv[2];
let args;
let cwd=root;
if(task==='migrate') {
 if(!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL required for migration');
 process.env.DATABASE_URL=process.env.DATABASE_ADMIN_URL;
 cwd=resolve(root,'packages/database');args=[resolve(root,'node_modules/prisma/build/index.js'),'migrate','deploy'];
} else if(task==='seed') {
 args=['--import','tsx',resolve(root,'packages/database/prisma/seed.ts')];
} else if(task==='provision') {
 args=['--import','tsx',resolve(root,'packages/database/src/provision.ts')];
} else if(task==='test:provision') {
 args=['--import','tsx',resolve(root,'packages/database/prisma/test-provision.ts')];
} else if(task==='test:integration') {
 if(!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_ADMIN_URL || !process.env.TEST_REDIS_URL) throw new Error('Dedicated test database and Redis configuration required');
 args=[resolve(root,'node_modules/vitest/vitest.mjs'),'run','test/integration']; cwd=resolve(root,'apps/api');
} else if(task==='dev:api') {
 cwd=resolve(root,'apps/api');
 args=[resolve(root,'node_modules/tsx/dist/cli.mjs'),'watch',resolve(root,'apps/api/src/main.ts')];
} else if(task==='dev:web') {
 args=[resolve(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3000']; cwd=resolve(root,'apps/web');
} else { throw new Error('Unsupported task'); }
const result=spawnSync(process.execPath,args,{cwd,env:process.env,stdio:'inherit'});
if(result.error) throw result.error;
process.exit(result.status ?? 1);
