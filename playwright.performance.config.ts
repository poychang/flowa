import { defineConfig } from '@playwright/test';
import { artifactDirectory } from './tests/performance/artifact';
import './tests/performance/workload';

const seconds = Number(process.env.PERF_SECONDS ?? 300);
if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 1800) throw new Error('PERF_SECONDS must be an integer from 5 to 1800');
export default defineConfig({
  testDir: './tests/performance', outputDir: './test-results/performance',
  workers: 1, fullyParallel: false, retries: 0, timeout: (seconds + 120) * 1000,
  expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:5183', viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: `pnpm exec vite preview --outDir ${artifactDirectory} --host 127.0.0.1 --port 5183 --strictPort`, url: 'http://127.0.0.1:5183', reuseExistingServer: false },
});
