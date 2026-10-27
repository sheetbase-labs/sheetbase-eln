/**
 * Journey EXP-20: a power user writes a notebook with the keyboard alone —
 * insert from the slash menu, add text below, and reorder blocks.
 */
import { expect, test } from 'playwright/test'

import {
  splitRight,
  createExperiment,
  createProject,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

test.setTimeout(90_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('EXP-20 the notebook can be written and reordered beside source data from the keyboard', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Keys'))
  await createExperiment(page, path, uniqueName('Keyboard only'))
  await waitForHydration(page)
  await splitRight(page)
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: /^Datasets/ })
    .click()
  await page
    .getByRole('link', {
      name: 'ELISA capsid titre and turbidity',
      exact: true,
    })
    .click()
  // A plain click opens the dataset in the list's own pane.
  const panes = page.locator('[data-workspace-pane]')
  await expect(panes).toHaveCount(2)
  await panes.nth(1).getByRole('link', { name: 'Data 96', exact: true }).click()
  await expect(
    panes.nth(1).getByRole('heading', {
      name: 'ELISA capsid titre and turbidity',
      exact: true,
    }),
  ).toBeVisible()
  // Opening in place leaves the notebook pane primary, so it can still edit.
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('First line')
  // Alt+Enter adds a text block below and moves the caret into it.
  await page.keyboard.press('Alt+Enter')
  const blocks = page.getByRole('group', { name: /Text block/ })
  await expect(blocks).toHaveCount(2)
  await expect(blocks.nth(1).locator('[contenteditable="true"]')).toBeFocused()
  await page.keyboard.type('Second line')
  await expect(blocks.nth(1)).toContainText('Second line')
  // Alt+ArrowUp moves the focused block above the first.
  await page.keyboard.press('Alt+ArrowUp')
  await expect(blocks.nth(0)).toContainText('Second line')
  await expect(blocks.nth(1)).toContainText('First line')
  // The slash menu inserts a block with arrows and Enter alone.
  await page.keyboard.press('Alt+Enter')
  await expect(blocks).toHaveCount(3)
  await expect(blocks.nth(1).locator('[contenteditable="true"]')).toBeFocused()
  await page.keyboard.type('/')
  await expect(
    page.getByRole('listbox', { name: 'Insert block' }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Insert block' })).toHaveCount(
    0,
  )
})
