import { defineConfig, devices } from '@playwright/test'

// E2E_URL runs the same tests against a deployed copy, for example
// E2E_URL=https://edward-012.github.io/neon-apex/ npm run e2e
const deployed = process.env.E2E_URL

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: deployed ?? 'http://localhost:4174/',
  },
  webServer: deployed
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4174 --strictPort',
        url: 'http://localhost:4174/',
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    // E2E_CHROME_CHANNEL=chrome uses an installed Chrome instead of
    // Playwright's own Chromium build.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHROME_CHANNEL } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'phone', use: { ...devices['iPhone 13 landscape'] } },
  ],
})
