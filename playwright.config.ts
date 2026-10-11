import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// E2E runs the compiled production frontend with a dedicated test API/database.
export default defineConfig({
  testDir: './apps/web/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: process.env.PLAYWRIGHT_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
    },
    // Auth/MFA screens contain credentials. Do not record traces or videos.
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: [
    { command: 'node scripts/e2e-server.mjs api', url: 'http://127.0.0.1:4000/api/v1/health/ready', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node scripts/e2e-server.mjs web', url: 'http://localhost:3000/login', reuseExistingServer: false, timeout: 60_000 },
  ],
});
