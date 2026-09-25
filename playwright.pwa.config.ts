import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/pwa', workers: 1, fullyParallel: false, timeout: 90000,
  expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:5181', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/serve-pwa-test.mjs', url: 'http://127.0.0.1:5181', reuseExistingServer: false },
});
