import { defineConfig } from 'playwright/test'
import sharedConfig from './playwright.config'

// Native session/password evidence cannot run against the auth-free demo.
// Use the same authenticated surface as parity, with real local PostgREST.
export default defineConfig({
  ...sharedConfig,
  projects: [
    {
      name: 'signatures',
      testDir: 'tests/browser',
      testMatch: 'rev-03-signing.test.ts',
      use: { baseURL: 'http://127.0.0.1:3200' },
    },
  ],
  timeout: 60_000,
  webServer: {
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
})
