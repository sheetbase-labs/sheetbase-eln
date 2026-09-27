import { expect, test } from 'playwright/test'

import {
  DESIGN_CLOCK,
  DESIGN_SCREEN_SIZES,
  DESIGN_STATES,
  DESIGN_USER_IDS,
} from './design-states'
import { signInAsDesignUser } from './sign-in'

/**
 * Visual parity suite (DSYS-06). Each migrated design screen opens its route
 * in the screen's state and compares it with the DSYS-01 render, which is the
 * expected image (`tests/visual/design-reference/<Screen>-<theme>.png`).
 *
 * Screens without a `DESIGN_STATES` entry are reported by the coverage test
 * below as pending; they are never skipped silently.
 */
for (const state of DESIGN_STATES) {
  test(`${state.screen} — ${state.theme}`, async ({ page }) => {
    const size = DESIGN_SCREEN_SIZES[state.screen] ?? {
      width: 1440,
      height: 900,
    }
    await page.setViewportSize(size)
    await page.emulateMedia({ colorScheme: state.theme })
    // Freeze the browser clock to the design seed's clock so weekday,
    // date and relative-time copy render as the design does.
    await page.clock.install({ time: DESIGN_CLOCK })
    // The appearance setting persists in localStorage; force the screen's
    // theme so the comparison is not decided by the seeded user's preference.
    await page.addInitScript((theme) => {
      try {
        window.localStorage.setItem('sheetbase-theme', theme)
      } catch {
        /* ignore */
      }
    }, state.theme)
    const userId = DESIGN_USER_IDS[state.user]
    if (userId) {
      await signInAsDesignUser(page, userId)
    }
    await page.goto(state.route)
    // Per-route shell config (breadcrumbs, title) is applied during hydration.
    // `networkidle` never settles (live-event streams stay open), so wait for
    // the page header to fill in (pages without one resolve immediately).
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
        /* no header title to wait for */
      })
    if (state.state) {
      throw new Error(
        `Unhandled state driver for ${state.screen}: ${state.state}`,
      )
    }
    await expect(page).toHaveScreenshot(`${state.screen}-${state.theme}.png`)
  })
}

test('parity coverage', () => {
  const themes = ['light', 'dark'] as const
  const covered = new Set(DESIGN_STATES.map((s) => `${s.screen}-${s.theme}`))
  const pending: string[] = []
  for (const screen of Object.keys(DESIGN_SCREEN_SIZES)) {
    for (const theme of themes) {
      if (!covered.has(`${screen}-${theme}`)) pending.push(`${screen}-${theme}`)
    }
  }
  const total = Object.keys(DESIGN_SCREEN_SIZES).length * themes.length
  // eslint-disable-next-line no-console -- the report is the point of this test
  console.log(
    `parity coverage: ${covered.size}/${total} migrated, ${pending.length} pending`,
  )
  expect(covered.size + pending.length).toBe(total)
})
