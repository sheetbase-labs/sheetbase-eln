import { defineConfig } from 'playwright/test'

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    // DSYS-06: anti-aliasing only. Never raise this or add per-test exceptions.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    {
      name: 'browser',
      testDir: 'tests/browser',
      testIgnore: 'rev-03-signing.test.ts',
    },
    {
      // Visual parity against the DSYS-01 renders, which are the expected
      // images (see tests/visual/parity.spec.ts). Runs on its own server with
      // the auth-free development shortcut disabled so each screen can be
      // signed in as its design user.
      name: 'parity',
      testDir: 'tests/visual',
      snapshotPathTemplate: '{testDir}/design-reference/{arg}{ext}',
      use: {
        baseURL: 'http://127.0.0.1:3200',
        deviceScaleFactor: 1,
        locale: 'en-GB',
        timezoneId: 'Europe/London',
      },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec vite dev --port 3100 --host 127.0.0.1',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: true,
      timeout: 60_000,
      // Workflow tests sign in as their own fixture users, so the development
      // environment's auth-free shortcut must not shadow them the way it does
      // in a `SHEETBASE_DEV_AUTH_FREE=true` local `.env.local`.
      env: {
        SHEETBASE_DEV_AUTH_FREE: 'false',
      },
    },
    {
      command: 'pnpm exec vite dev --port 3200 --host 127.0.0.1',
      url: 'http://127.0.0.1:3200',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        SHEETBASE_DEV_AUTH_FREE: 'false',
        VITE_PARITY: 'true',
        BETTER_AUTH_URL: 'http://127.0.0.1:3200',
      },
    },
  ],
})
