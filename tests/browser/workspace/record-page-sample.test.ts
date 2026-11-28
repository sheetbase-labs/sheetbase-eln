/**
 * The shared record page on a stored sample of the design seed: one main
 * action with the rest under ⋯, Follow in the pane header, History at the far
 * end of the tabs, and the label, links and activity in the side panel.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/samples/SMP-2252')
  await expect(
    page.getByRole('heading', { level: 1, name: 'C-150 filtrate, train B' }),
  ).toBeVisible({ timeout: 30_000 })
})

test('says the sample once, with Withdraw first and the rest under ⋯', async ({
  page,
}) => {
  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('SMP-2252')
  expect(await meta.locator('[data-record-fact]').count()).toBeLessThan(5)
  await expect(
    page.getByRole('button', { name: 'Withdraw volume…' }),
  ).toBeVisible()
  await expect(
    page
      .locator('[data-pane-page-actions]')
      .getByRole('button', { name: 'Follow' }),
  ).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'More sample actions' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Move', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})

test('ends the tabs on History and keeps the label beside them', async ({
  page,
}) => {
  const tabs = page.locator('[data-record-page] [data-page-tabs] a')

  await expect(tabs.last()).toHaveText('History')

  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Label' })).toBeVisible()
  await expect(side.getByRole('heading', { name: 'Activity' })).toBeVisible()
})
