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
    },
    {
      // Visual parity against the DSYS-01 renders, which are the expected
      // images (see tests/visual/parity.spec.ts).
      name: 'parity',
      testDir: 'tests/visual',
      snapshotPathTemplate: '{testDir}/design-reference/{arg}{ext}',
      use: { deviceScaleFactor: 1 },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite dev --port 3100 --host 127.0.0.1',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
