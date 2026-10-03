import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end checks in a real browser, against a dev server of their own:
// its own port, build folder and data folder, so a UCCB that's already
// running (and its cards) is left alone.
//
//   npx playwright install chromium   (once)
//   npm run e2e

const port = Number(process.env.E2E_PORT) || 3299;
const dataDir = path.join(os.tmpdir(), `uccb-e2e-${process.pid}`);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // A browser that's already installed elsewhere can stand in.
      use: { ...devices['Desktop Chrome'], launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {} },
    },
  ],
  webServer: {
    command: 'node server.mjs --dev',
    url: `http://localhost:${port}`,
    // The first compile is slow.
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PORT: String(port), UCCB_DATA_DIR: dataDir, UCCB_DIST_DIR: '.next-e2e' },
  },
});
