/**
 * The registry surface is one implementation.
 *
 * Nine list screens used to hand-roll the same `v3/ui/table` body; every one of
 * them now renders the shared grid
 * (`src/components/v3/inventory/registry-grid.tsx`). This spec walks all nine
 * on the design seed and asserts what the consolidation promises: the grid is
 * the table (`data-slot=data-grid-table`), it renders the tab's rows, it
 * carries the screen's accessible name, and a screen whose rows drive an
 * inspector gives its rows a keyboard control the bespoke body never had. A screen
 * left on the old markup fails here rather than in review.
 *
 * Geometry is deliberately not asserted per screen: it was measured against the
 * pre-swap build at 1440x900 (see the record's row 8), and a pixel assertion
 * here would fail on any future, legitimate density change.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { DESIGN_USER_IDS } from '../visual/design-states'
import { signInAsDesignUser } from '../visual/sign-in'

/** Every registry list screen, with the name its table carries. */
const SCREENS: { path: string; label: string; selectable: boolean }[] = [
  { path: '/protocols', label: 'Protocols', selectable: true },
  { path: '/datasets', label: 'Datasets', selectable: true },
  { path: '/experiments', label: 'Experiments', selectable: false },
  { path: '/samples', label: 'Samples', selectable: true },
  { path: '/materials', label: 'Material lots', selectable: true },
  { path: '/instruments', label: 'Instruments', selectable: true },
  { path: '/models', label: 'Models', selectable: true },
  { path: '/templates', label: 'Templates', selectable: true },
  { path: '/pipelines', label: 'Pipelines', selectable: true },
]

const table = (page: Page) => page.locator('table[data-slot=data-grid-table]')

test('every registry list screen renders the shared grid', async ({ page }) => {
  // The design seed's users share the fixture; one sign-in covers every route.
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)

  for (const screen of SCREENS) {
    await page.goto(screen.path)

    const grid = table(page)
    await expect(grid, `${screen.path} renders the shared grid`).toHaveCount(1)
    await expect(grid, `${screen.path} names its table`).toHaveAccessibleName(
      screen.label,
    )

    // The screen either has the tab's rows or says why it has none. Which of
    // the two depends on the signed-in user's project access in the seed, so
    // the assertion is that the grid resolved into one of them; the rows
    // themselves are asserted per screen in `registry-grid.test.ts` and in the
    // routes' own tests.
    const firstRow = page.locator('tbody tr[data-index]').first()
    const emptyOrRows = page
      .locator('tbody tr[data-index], [role=status]')
      .first()
    await expect(emptyOrRows, `${screen.path} resolves its body`).toBeVisible({
      timeout: 20_000,
    })

    // A selectable row is its own keyboard control; there is no checkbox
    // column, and a screen whose rows navigate has no tab stop on them.
    const stops = page.locator('tbody tr[data-index][tabindex="0"]')
    if (!screen.selectable) {
      await expect(
        stops,
        `${screen.path} has no row keyboard control`,
      ).toHaveCount(0)
    } else if ((await firstRow.count()) > 0) {
      await expect(
        stops,
        `${screen.path} offers row keyboard control`,
      ).toHaveCount(1)
    }
  }
})
