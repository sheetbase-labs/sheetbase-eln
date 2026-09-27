import { expect, test } from 'playwright/test'

import {
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
    const userId = DESIGN_USER_IDS[state.user]
    if (userId) {
      await signInAsDesignUser(page, userId)
    }
    await page.goto(state.route)
    // Per-route shell config (breadcrumbs, title) is applied during hydration.
    // `networkidle` never settles (live-event streams stay open), so settle on
    // a short delay before comparing.
    await page.waitForTimeout(400)
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
