import { readFileSync } from 'node:fs'
import { expect } from 'playwright/test'
import type { Page, Request } from 'playwright/test'
import { z } from 'zod'

import {
  DESIGN_CLOCK,
  DESIGN_SCREEN_SIZES,
  DESIGN_USER_IDS,
} from './design-states'
import type { DesignState, DesignStateSpec } from './design-states'
import { signInAsDesignUser } from './sign-in'

/**
 * DSYS-06 — drive the parity browser into a design screen's state.
 *
 * The reference renderer (`scripts/design-reference.mts`) opens a static
 * snapshot with the design's own clock, theme and frame size. The application
 * is live, so this driver reproduces the same conditions — the seeded user's
 * session, the design clock, the theme, the viewport — and then applies the
 * state. A state the app cannot be driven into throws
 * `UnsupportedDesignStateError` instead of silently comparing the wrong page.
 *
 * Routes in `DESIGN_STATES` use the design's display identifiers
 * (PRJ-/EXP-/SMP-/DS-/SHT-/INS-/CB-/PL-). The app resolves them in the route
 * beforeLoad and redirects to the canonical UUID, so navigating the raw design
 * route exercises that routing rather than a test-side rewrite.
 */

/** Thrown when a declared state has no driver, or cannot be reached. */
export class UnsupportedDesignStateError extends Error {
  constructor(state: string, detail: string) {
    super(`Cannot drive design state "${state}": ${detail}`)
    this.name = 'UnsupportedDesignStateError'
  }
}

/** Validate activation before any browser request to a scenario database. */
function scenarioFixture(state: DesignState) {
  const screen = z
    .enum(['ReviewSign', 'SettingsSignature', 'HomeFirstRun'])
    .parse(state.screen)
  if (process.env.SHEETBASE_PARITY_SCENARIO !== screen) {
    throw new UnsupportedDesignStateError(
      'scenario',
      `${screen} requires its fresh isolated database; run pnpm exec tsx tests/visual/design-scenario.mts ${screen}`,
    )
  }
  const fixture = z
    .object({
      screen: z.literal(screen),
      userId: z.string(),
      route: z.string().startsWith('/'),
      revisionId: z.string().uuid().optional(),
      prerequisites: z.record(z.string(), z.unknown()),
    })
    .parse(
      JSON.parse(
        readFileSync(process.env.SHEETBASE_PARITY_SCENARIO_FILE ?? '', 'utf8'),
      ),
    )
  const name = {
    ReviewSign: 'sheetbase_parity_review_sign',
    SettingsSignature: 'sheetbase_parity_settings_signature',
    HomeFirstRun: 'sheetbase_parity_home_first_run',
  }[screen]
  for (const variable of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'PGRST_DB_URI',
    'FORMULA_DATABASE_URL',
  ]) {
    const url = new URL(process.env[variable] ?? '')
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== `/${name}`
    ) {
      throw new Error('Scenario capture requires its exact local role URLs')
    }
  }
  if (
    process.env.SHEETBASE_ENV !== 'test' ||
    process.env.SHEETBASE_DEV_AUTH_FREE !== 'false'
  ) {
    throw new Error(
      'Scenario capture requires test mode without auth-free sessions',
    )
  }
  expect(fixture.userId).toBe(DESIGN_USER_IDS[state.user])
  const origin = new URL(process.env.BETTER_AUTH_URL ?? '')
  const port = {
    ReviewSign: 3300,
    SettingsSignature: 3310,
    HomeFirstRun: 3320,
  }[screen]
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.port !== String(port)
  ) {
    throw new Error(
      'Scenario capture requires its dedicated local app endpoint',
    )
  }
  if (screen === 'ReviewSign') {
    expect(fixture.prerequisites).toEqual({ approved: true, unsigned: true })
    expect(fixture.revisionId).toBeDefined()
    expect(fixture.route).toBe(`/review/${fixture.revisionId}`)
  } else if (screen === 'SettingsSignature') {
    expect(fixture.prerequisites.certified).toBe(false)
    expect(fixture.route).toBe('/settings/signatures')
  } else {
    expect(fixture.prerequisites).toEqual({
      projectAccess: 'editor',
      personalActivity: false,
      certified: false,
    })
    expect(fixture.route).toBe('/')
  }
  return { ...fixture, route: new URL(fixture.route, origin).href }
}

/**
 * Display-identifier routing lives in the app (route beforeLoad resolves the
 * design ID to the canonical UUID and redirects), so parity navigates the raw
 * design route and no longer rewrites it here.
 */

/** Wait for SSR chrome and client queries to settle. */
async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const header = document.querySelector('[data-slot="page-header"]')
        return !header || (header.textContent?.trim().length ?? 0) > 0
      },
      undefined,
      { timeout: 5000 },
    )
    .catch(() => {
      /* pages without a header title settle immediately */
    })
  await page.waitForFunction(() => document.fonts.status === 'loaded')
  await page.waitForTimeout(400)
}

/**
 * Make the screen's data requests behave like the state. The app reads all
 * data through the `/api/db` proxy, so one interception covers list and detail
 * screens: `empty` returns no rows, `error` returns a 500, `loading` never
 * resolves.
 */
async function interceptData(
  page: Page,
  kind: 'empty' | 'error' | 'loading',
): Promise<void> {
  await page.route('**/api/db/**', async (route) => {
    if (kind === 'loading') return
    if (kind === 'error') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'design state: request failed' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    })
  })
}

async function driveDialog(page: Page, trigger: string): Promise<void> {
  const button = page.getByRole('button', { name: trigger }).first()
  try {
    await button.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    throw new UnsupportedDesignStateError(
      'dialog',
      `no button named "${trigger}" on the page`,
    )
  }
  await button.click()
  const dialog = page
    .locator('[role="dialog"], [role="alertdialog"]')
    .filter({ visible: true })
    .first()
  try {
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    throw new UnsupportedDesignStateError(
      'dialog',
      `clicking "${trigger}" did not open a dialog`,
    )
  }
}

async function driveRecord(page: Page, identifier: string): Promise<void> {
  try {
    await page
      .getByText(identifier, { exact: false })
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    throw new UnsupportedDesignStateError(
      'record',
      `${identifier} never rendered on the page`,
    )
  }
}

async function applyState(page: Page, spec: DesignStateSpec): Promise<void> {
  switch (spec.kind) {
    case 'default':
    case 'scenario':
      return
    case 'empty':
    case 'error':
    case 'loading':
      return // applied before navigation
    case 'offline':
      // The document is served by the app's server, so go offline only after
      // the page has loaded; the client data stream then fails.
      await page.context().setOffline(true)
      await page.waitForTimeout(500)
      return
    case 'dialog':
      await driveDialog(page, spec.trigger)
      return
    case 'record':
      await driveRecord(page, spec.identifier)
      return
    case 'signed-out': {
      if (process.env.SHEETBASE_DEV_AUTH_FREE !== 'false') {
        throw new UnsupportedDesignStateError(
          'signed-out',
          'native signout requires explicit auth-free=false',
        )
      }
      await page.getByRole('button', { name: /^Account: / }).click()
      const response = page.waitForResponse(
        (result) =>
          new URL(result.url()).pathname === '/api/auth/sign-out' &&
          result.request().method() === 'POST',
      )
      await page
        .getByRole('menuitem', { name: 'Sign out', exact: true })
        .click()
      expect((await response).status()).toBe(200)
      await expect(page).toHaveURL(/\/sign-in\?state=signed-out$/)
      await expect(
        page.getByRole('heading', { name: 'You’re signed out', exact: true }),
      ).toBeVisible()
      const session = await page.evaluate(async () => {
        const response = await fetch('/api/auth/get-session')
        return { status: response.status, body: await response.json() }
      })
      expect(session.status).toBe(200)
      expect(session.body).toBeNull()
      await settle(page)
      return
    }
    case 'selected-row': {
      await driveRecord(page, spec.identifier)
      const checkbox = page.getByRole('checkbox', {
        name: `Select ${spec.identifier}`,
        exact: true,
      })
      await checkbox.check()
      await expect(checkbox).toBeChecked()
      await page
        .getByRole('button', { name: spec.trigger, exact: true })
        .click()
      await expect(
        page.getByRole('complementary').filter({ hasText: spec.identifier }),
      ).toBeVisible()
      return
    }
    case 'conflict':
      throw new UnsupportedDesignStateError(
        'conflict',
        'no save-conflict hook exists; add one that returns 409 to the screen’s write request',
      )
  }
}

/**
 * Put `page` into the exact conditions the design reference was rendered with,
 * drive `state`, and leave the page ready for `toHaveScreenshot`.
 */
export async function visitDesignState(
  page: Page,
  state: DesignState,
): Promise<void> {
  const size = state.size ?? DESIGN_SCREEN_SIZES[state.screen]
  if (!size) {
    throw new Error(`No frame size for design screen "${state.screen}"`)
  }
  const spec: DesignStateSpec = state.state ?? { kind: 'default' }
  const fixture = spec.kind === 'scenario' ? scenarioFixture(state) : undefined
  const userId = DESIGN_USER_IDS[state.user]
  if (!userId) {
    throw new UnsupportedDesignStateError(
      spec.kind,
      `unknown design user "${state.user}"`,
    )
  }

  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: state.theme, reducedMotion: 'reduce' })
  // The unchanged boards show Mac keyboard glyphs. Emulate the browser's
  // platform through Chromium, leaving the product's formatter and handlers
  // untouched; changing rendered labels would conceal a product mismatch.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: (await page.evaluate(() => navigator.userAgent)).replace(
      /\(X11; Linux x86_64\)/,
      '(Macintosh; Intel Mac OS X 10_15_7)',
    ),
    platform: 'MacIntel',
  })
  // Native scenarios use current operation dates. Do not disguise the
  // unresolved historical-clock mismatch with a browser-only override.
  if (spec.kind !== 'scenario' && spec.kind !== 'signed-out') {
    await page.clock.install({ time: DESIGN_CLOCK })
  }
  // The appearance setting persists in localStorage; force the screen's theme
  // so the comparison is not decided by the seeded user's preference.
  await page.addInitScript((theme) => {
    try {
      window.localStorage.setItem('sheetbase-theme', theme)
      window.localStorage.setItem('sheetbase.theme', theme)
    } catch {
      /* ignore */
    }
  }, state.theme)

  if (
    spec.kind === 'empty' ||
    spec.kind === 'error' ||
    spec.kind === 'loading'
  ) {
    await interceptData(page, spec.kind)
  }

  await signInAsDesignUser(page, userId)
  // Raw design route: the app's beforeLoad resolves the display ID to the
  // canonical UUID and redirects, so this exercises the real routing.
  // Two stable SSR screenshots can precede hydration and its real queries.
  // Wait for browser data activity, not global network-idle (the live-event
  // stream remains open). Loading states deliberately keep those reads open.
  const pending = new Set<Request>()
  const onRequest = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith('/api/db/')) {
      pending.add(request)
    }
  }
  const onFinished = (request: Request) => pending.delete(request)
  page.on('request', onRequest)
  page.on('requestfinished', onFinished)
  page.on('requestfailed', onFinished)
  try {
    await Promise.all([
      page.waitForRequest((request) =>
        new URL(request.url()).pathname.startsWith('/api/db/'),
      ),
      page.goto(fixture?.route ?? state.route),
    ])
    if (spec.kind !== 'loading') {
      await settle(page)
      await expect.poll(() => pending.size, { timeout: 10_000 }).toBe(0)
    }
  } finally {
    page.off('request', onRequest)
    page.off('requestfinished', onFinished)
    page.off('requestfailed', onFinished)
  }
  if (spec.kind === 'signed-out') {
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session')
      return { status: response.status, body: await response.json() }
    })
    expect(session.status).toBe(200)
    const signedIn = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(session.body)
    expect(signedIn.user.id).toBe(userId)
  }
  await applyState(page, spec)
  if (fixture?.screen === 'ReviewSign') {
    await driveDialog(page, 'Sign revision')
    const dialog = page.getByRole('alertdialog', {
      name: 'Sign this revision',
      exact: true,
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(fixture.revisionId ?? '')
    await expect(
      dialog.getByLabel('Signing password', { exact: true }),
    ).toBeFocused()
  } else if (fixture?.screen === 'SettingsSignature') {
    await expect(page.getByText(/Verified by Gareth P\. on/)).toContainText(
      'sam.r@design.sheetbase.dev',
    )
    await expect(page.getByText('Not certified', { exact: true })).toBeVisible()
  } else if (fixture?.screen === 'HomeFirstRun') {
    await expect(
      page.getByText('You were added to AAV9 process transfer.', {
        exact: true,
      }),
    ).toBeVisible()
  }
}
