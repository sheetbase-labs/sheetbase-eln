/**
 * The shared record page on a dataset of the design seed: the header says its
 * ID, validation and four facts once, Analyse is the main action with Chart
 * and downloads under ⋯, and the Overview shows the first rows and the
 * dataset's checks instead of repeating the header.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/datasets/DS-0298')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Ambr 250 daily readings, AMB-25-118',
    }),
  ).toBeVisible({ timeout: 30_000 })
})

test('says the dataset once, with Analyse first and the rest under ⋯', async ({
  page,
}) => {
  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('DS-0298')
  await expect(meta.locator('[data-record-fact]')).toHaveCount(4)
  await expect(
    page.locator('[data-record-page]').getByRole('button', { name: 'Analyse' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'More dataset actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Chart' })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('opens on the first rows and the checks', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'First rows' })).toBeVisible()
  await expect(page.getByText('5 of 84')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Vessel' })).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible()
  await expect(page.getByText('Glucose, Osmolality')).toBeVisible()

  await page.getByRole('link', { name: 'Open all rows' }).click()
  await expect(page).toHaveURL(/\/datasets\/[^/]+\/rows/)
})

test('keeps where it came from in the side panel and History at the end', async ({
  page,
}) => {
  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Properties' })).toBeVisible()
  await expect(side.getByText('EXP-0140')).toBeVisible()

  const tabs = page.locator('[data-record-page] [data-page-tabs] a')

  await expect(tabs.first()).toHaveText('Overview')
  await expect(tabs.last()).toHaveText('History')
})
