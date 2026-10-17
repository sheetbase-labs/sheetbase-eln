/**
 * ADR-0055 — the Frame + Data Grid adoption on the protocols registry screen.
 *
 * `/protocols` is the first registry screen that is not in the design-parity
 * set, so this spec is its stand-in: the screen has no parity row to update,
 * and ADR-0055 decision 4 asks for a story plus a browser test instead.
 *
 * What it proves, on the design seed:
 * - the grid renders the tab's rows flush, like every other table screen, and
 *   the screen's own `ListFooter` still carries the count;
 * - the toolbar's Sort menu drives the table's ordering, with the registry's
 *   own collation — en-GB, numbers in their numeric order;
 * - a row click still selects, and the row checkbox adds the keyboard path
 *   the bespoke body never had;
 * - the name cell is still a router link to the protocol record.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { DESIGN_USER_IDS } from '../visual/design-states'
import { signInAsDesignUser } from '../visual/sign-in'

/** The design seed's active protocol templates, in identifier order. */
const ACTIVE = [
  'PRT-006',
  'PRT-009',
  'PRT-012',
  'PRT-014',
  'PRT-017',
  'PRT-019',
  'PRT-020',
  'PRT-021',
  'PRT-022',
  'PRT-024',
]

/** Sorted by title with the registry's collation. `AAV full/empty ratio by
 * AUC` precedes `AAV9 harvest clarification` under `en-GB` — the order the
 * bespoke body produced, and the reason the screen passes its own comparator
 * to the columns rather than using the grid's `alphanumeric` built-in. */
const BY_TITLE = [
  'PRT-012',
  'PRT-014',
  'PRT-022',
  'PRT-019',
  'PRT-020',
  'PRT-021',
  'PRT-006',
  'PRT-009',
  'PRT-024',
  'PRT-017',
]

async function openProtocols(page: Page) {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/protocols')
  await expect(page.getByText(/^PRT-0/).first()).toBeVisible({
    timeout: 20_000,
  })
}

const grid = (page: Page) => page.locator('table').first()
/** The screen's own footer band, which the grid does not replace. */
const footer = (page: Page) => page.locator('[data-slot=table-footer]')

const identifiers = (page: Page) =>
  grid(page)
    .locator('tbody tr')
    .evaluateAll((trs) => trs.map((tr) => (tr.textContent ?? '').slice(0, 7)))

test('the protocols registry renders, sorts, selects and links on the grid', async ({
  page,
}) => {
  await openProtocols(page)

  // The screen's footer carries the count, as it did before the grid.
  await expect(footer(page)).toContainText('10 of 10 effective')
  expect(await identifiers(page)).toEqual(ACTIVE)

  // The rows are the virtual renderer's (only `DataGridTableVirtual` sets
  // `data-index`), and the table is flush: no registry `Frame` card wraps it,
  // and the table starts at the list area's own left edge.
  const firstRow = grid(page).locator('tbody tr').first()
  await expect(firstRow).toHaveAttribute('data-index', '0')
  await expect(page.locator('[data-slot=frame]')).toHaveCount(0)
  const tableBox = await grid(page).boundingBox()
  const areaBox = await page
    .locator('[data-slot=data-grid-scroll-area]')
    .boundingBox()
  expect(tableBox!.x - areaBox!.x).toBe(0)

  // The toolbar's Sort menu drives the table's ordering.
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitem', { name: 'Protocol' }).click()
  await expect(page.getByText(/^PRT-0/).first()).toBeVisible()
  expect(await identifiers(page)).toEqual(BY_TITLE)
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitem', { name: 'ID' }).click()
  await expect(page.getByText(/^PRT-0/).first()).toBeVisible()
  expect(await identifiers(page)).toEqual(ACTIVE)

  // Click-to-select: the row paints as selected and the inspector follows it.
  await grid(page).locator('tbody tr').nth(2).click()
  await expect(footer(page)).toContainText('1 selected')
  await expect(grid(page).locator('tbody tr[data-state=selected]')).toHaveCount(
    1,
  )
  await expect(page.getByRole('complementary')).toContainText('PRT-012')

  // Keyboard selection: the row checkbox is a real control and Space takes the
  // selection to that row. The bespoke body had no keyboard path at all.
  // Selection is one row — the inspector's — so the second one replaces the
  // first rather than joining it, and the header carries no select-all.
  const rowBox = grid(page)
    .getByRole('checkbox', { name: /select/i })
    .nth(5)
  await rowBox.focus()
  await expect(rowBox).toBeFocused()
  await page.keyboard.press('Space')
  await expect(footer(page)).toContainText('1 selected')
  await expect(grid(page).locator('tbody tr[data-state=selected]')).toHaveCount(
    1,
  )
  await expect(grid(page).locator('thead').getByRole('checkbox')).toHaveCount(0)

  // The name cell is still a router link to the record.
  const link = grid(page).getByRole('link', { name: 'HEK293 transfection' })
  await expect(link).toHaveAttribute('href', /\/protocols\/[0-9a-f-]{36}$/)
  await link.click()
  await expect(page).toHaveURL(/\/protocols\/[0-9a-f-]{36}$/)
})
