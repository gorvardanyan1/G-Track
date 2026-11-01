import { defineConfig } from 'cypress';
import { createTasks } from './cypress/tasks.ts';

/**
 * e2e:       run through `npm run test:cypress:e2e`, which seeds a throwaway database and starts
 *            its own api + web (see scripts/cypress.mjs) and sets the env read below.
 * component: mounts single components with the app's Vite config (no servers).
 */
export default defineConfig({
  viewportWidth: 1280,
  viewportHeight: 800,
  video: false,
  screenshotOnRunFailure: true,
  defaultCommandTimeout: 8000,
  retries: { runMode: 1, openMode: 0 },
  e2e: {
    baseUrl: process.env['CYPRESS_BASE_URL'] ?? 'http://localhost:5274',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    downloadsFolder: 'cypress/downloads',
    setupNodeEvents(on) {
      on(
        'task',
        createTasks({
          databaseUrl:
            process.env['E2E_DATABASE_URL'] ??
            'postgresql://tempo:tempo@localhost:5434/tempo_cypress_e2e',
          outboxDir: process.env['E2E_OUTBOX_DIR'] ?? 'cypress/.outbox',
          totpKeyBase64: Buffer.alloc(32, 7).toString('base64'),
        }),
      );
    },
  },
  component: {
    // Component failures are clear from the command log; screenshots only slow them down.
    screenshotOnRunFailure: false,
    devServer: { framework: 'vue', bundler: 'vite' },
    specPattern: 'cypress/component/**/*.cy.ts',
    supportFile: 'cypress/support/component.ts',
    indexHtmlFile: 'cypress/support/component-index.html',
  },
});
