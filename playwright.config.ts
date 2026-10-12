import { defineConfig, devices } from '@playwright/test';

// UI audit suite for the OneCity customer app (Expo Router, React Native Web).
// It runs against the dev server that is already running on :8081 (web app + /api).
// The suite never starts or stops that server.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  // The Metro dev bundler is slow on a cold first load, and it hot-reloads while
  // other people edit the app, so every limit here is generous.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e/test-results/results.json' }], ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: false,
    screenshot: 'on',
    trace: 'retain-on-failure',
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // Geolocation is not granted: "use current location" should fail gracefully.
    permissions: [],
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
      },
    },
  ],
});
