import type { Page } from 'playwright/test'

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
  await page.evaluate(() => document.fonts.ready)
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
  if ((await button.count()) === 0) {
    throw new UnsupportedDesignStateError(
      'dialog',
      `no button named "${trigger}" on the page`,
    )
  }
  await button.click()
  const dialog = page.locator('[role="dialog"]').first()
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
  const stillLoading = await page.getByText('Loading', { exact: false }).count()
  const found = await page.getByText(identifier, { exact: false }).count()
  if (found === 0 && stillLoading === 0) {
    throw new UnsupportedDesignStateError(
      'record',
      `${identifier} never rendered on the page`,
    )
  }
}

async function applyState(page: Page, spec: DesignStateSpec): Promise<void> {
  switch (spec.kind) {
    case 'default':
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
  const userId = DESIGN_USER_IDS[state.user]
  if (!userId) {
    throw new UnsupportedDesignStateError(
      spec.kind,
      `unknown design user "${state.user}"`,
    )
  }

  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: state.theme, reducedMotion: 'reduce' })
  // Freeze the browser clock to the design seed's clock so weekday, date and
  // relative-time copy render as the design does.
  await page.clock.install({ time: DESIGN_CLOCK })
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

  if (spec.kind === 'empty' || spec.kind === 'error' || spec.kind === 'loading') {
    await interceptData(page, spec.kind)
  }

  await signInAsDesignUser(page, userId)
  // Raw design route: the app's beforeLoad resolves the display ID to the
  // canonical UUID and redirects, so this exercises the real routing.
  await page.goto(state.route)
  if (spec.kind !== 'loading') await settle(page)
  await applyState(page, spec)
}
