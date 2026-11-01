import { defineConfig, devices } from '@playwright/test';
import { apiEnv, E2E, WEB_URL } from './support/env.ts';

/**
 * One worker: the tests share one api (rate limits, the seeded organization) and each uses its
 * own seeded people, so they don't depend on each other's data.
 * Locally, E2E_CHROME=/path/to/chrome uses an installed browser instead of Playwright's.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : 'list',
  use: {
    baseURL: WEB_URL,
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env['E2E_CHROME'] && {
          launchOptions: { executablePath: process.env['E2E_CHROME'] },
        }),
      },
    },
  ],
  webServer: [
    {
      command: 'node src/server.ts',
      cwd: '../apps/api',
      env: apiEnv(),
      url: `http://localhost:${E2E.apiPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${E2E.webPort} --strictPort`,
      cwd: '../apps/web',
      env: { API_PROXY_TARGET: `http://localhost:${E2E.apiPort}` },
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
