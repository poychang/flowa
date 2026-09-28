import { defineConfig } from '@playwright/test';
import core from './playwright.config';

export default defineConfig({
  ...core,
  testDir: './tests/devices',
  outputDir: './test-results/devices',
  timeout: 90000,
  projects: [{ name: 'devices', use: { browserName: 'chromium' } }],
});
