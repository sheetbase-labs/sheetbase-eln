import { defineConfig } from 'playwright/test'
import sharedConfig from './playwright.config'

// REV-03 signing acceptance against a caller-provisioned isolated database.
//
// `tests/browser/rev-03-signing.test.ts` needs native Better Auth password
// credentials, a real local PostgREST and a freshly migrated database that the
// suite may insert into and delete from. The default `browser` project reuses
// the shared development database (`.env.local`), so the spec is excluded there
// (`testIgnore` in playwright.config.ts) and given its own surface.
//
// `tests/browser/rev-03-signing.mts` provisions the isolated database, starts
// the dedicated app and PostgREST, then invokes Playwright with this config and
// the isolated role URLs exported. Running the config directly reuses whatever
// services and env are already present.
const baseURL = process.env.SIGNING_BASE_URL ?? 'http://127.0.0.1:3200'
// The provisioner already started the app, so it sets SIGNING_NO_SERVER=1 to
// stop this config from starting (or reusing) a shared development server.
const manageServer = process.env.SIGNING_NO_SERVER !== '1'

export default defineConfig({
  ...sharedConfig,
  projects: [
    {
      name: 'signatures',
      testDir: 'tests/browser',
      testMatch: 'rev-03-signing.test.ts',
      use: { baseURL },
    },
  ],
  timeout: 60_000,
  webServer: manageServer
    ? {
        command: 'pnpm exec vite dev --port 3200 --host 127.0.0.1',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
        env: {
          SHEETBASE_DEV_AUTH_FREE: 'false',
          VITE_PARITY: 'true',
          BETTER_AUTH_URL: baseURL,
        },
      }
    : undefined,
})
