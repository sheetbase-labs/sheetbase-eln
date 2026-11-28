import { DESIGN_CLOCK } from './src/db/seed/design'
import { defineConfig } from 'playwright/test'

import {
  BROWSER_MODEL_PORT,
  scriptedProfiles,
} from './tests/api/assistant/mock-model'

/**
 * `E2E_SERVER=build` serves the production build (`pnpm build` first) instead
 * of the Vite dev server. CI does this: a dev server compiles each page on its
 * first visit, which made every journey two to three times slower, and the
 * build is what ships. The component tests that swap server functions for
 * fixtures need the dev server, so they run without it.
 */
const servesBuild = process.env.E2E_SERVER === 'build'

/**
 * Tests that need the dev server: component fixtures it serves and the
 * dev-only /foundations page. CI runs them in their own job, so a folder such
 * as workspace/ can be named whole for the built app.
 */
const DEV_SERVER_ONLY = [
  '**/settings/**',
  '**/workspace/pane-page.test.ts',
  '**/shell-01-one-shell.test.ts',
  '**/grid-keyboard-selection.test.ts',
]

/** The parity server is only started when the parity project runs. */
const parityRequested = process.argv.some(
  (arg, index, all) =>
    arg === '--project=parity' ||
    (arg === '--project' && all[index + 1] === 'parity'),
)

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    // The dev server compiles a route on its first request, and a runner is
    // slower than a laptop: 5 seconds read a slow first load as a missing page.
    timeout: 15_000,
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
      testIgnore: [
        '**/rev-03-signing.test.ts',
        ...(servesBuild ? DEV_SERVER_ONLY : []),
      ],
    },
    {
      // Visual parity against the DSYS-01 renders, which are the expected
      // images (see tests/visual/parity.spec.ts). Runs on its own server with
      // the auth-free development shortcut disabled so each screen can be
      // signed in as its design user.
      name: 'parity',
      testDir: 'tests/visual',
      // The comparisons are generated from one spec file and are independent,
      // so they parallelise across workers; without this Playwright keeps them
      // in a single worker and the run stays serial.
      fullyParallel: true,
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
    // The app's service worker serves navigations network-first and answers
    // with its offline page when the dev server takes over five seconds to
    // render a cold route, and reads under it skip `page.route`. Specs test
    // the app, not the worker, so no page installs it.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: [
    {
      command: servesBuild
        ? 'node scripts/start-prod.mjs'
        : 'pnpm exec vite dev --port 3100 --host 127.0.0.1',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: true,
      timeout: 60_000,
      // Workflow tests sign in as their own fixture users, so the development
      // environment's auth-free shortcut must not shadow them the way it does
      // in a `SHEETBASE_DEV_AUTH_FREE=true` local `.env.local`.
      env: {
        ...(servesBuild ? { HOST: '127.0.0.1', PORT: '3100' } : {}),
        SHEETBASE_DEV_AUTH_FREE: 'false',
        SHEETBASE_NO_ERROR_OVERLAY: 'true',
        // The data proxy allows 600 reads a minute per person, counting each
        // read inside a batch. A journey clicks through a whole workflow far
        // faster than a person, went over it, and got 429s that left a pane
        // on "Loading dataset…". The limiter guards against abuse; it is not
        // what these tests are about.
        SHEETBASE_RATE_LIMIT_MAX: '100000',
        // The assistant browser tests script the model from the test process.
        AI_PROVIDER_PROFILES: scriptedProfiles(
          `http://127.0.0.1:${BROWSER_MODEL_PORT}/v1`,
        ),
        // Pin the application's notion of now to the design clock so
        // time-dependent surfaces (hold meters, expiry windows, relative dates)
        // render deterministically instead of drifting as real time passes.
        // See src/lib/clock.ts and DESIGN_CLOCK in src/db/seed/design.ts.
        SHEETBASE_NOW: DESIGN_CLOCK.toISOString(),
        // Every test signs in as one of a few seeded people, so a long shard
        // sends a single person's worth of requests; the abuse bound would
        // answer the busy pages with 429s instead of data.
        SHEETBASE_RATE_LIMIT_MAX: '100000',
      },
    },
    ...(parityRequested
      ? [
          {
            command: 'pnpm exec vite dev --port 3200 --host 127.0.0.1',
            url: 'http://127.0.0.1:3200',
            reuseExistingServer: true,
            timeout: 60_000,
            env: {
              SHEETBASE_DEV_AUTH_FREE: 'false',
              SHEETBASE_NO_ERROR_OVERLAY: 'true',
              VITE_PARITY: 'true',
              BETTER_AUTH_URL: 'http://127.0.0.1:3200',
            },
          },
        ]
      : []),
  ],
})
