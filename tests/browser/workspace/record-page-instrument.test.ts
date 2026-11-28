/**
 * The shared record page on an instrument of the design seed: the header says
 * its ID, health and four facts once, Book is the main action with the rest
 * under ⋯, the tabs run Details to History, and the side panel holds its
 * other fields and this week's bookings.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/instruments/INS-0002')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ambr 250, bay 2' }),
  ).toBeVisible({ timeout: 30_000 })
})

test('says the instrument once, with Book first and the rest under ⋯', async ({
  page,
}) => {
  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('INS-0002')
  await expect(meta.locator('[data-record-fact]')).toHaveCount(4)
  await expect(
    page.locator('[data-record-page]').getByText('Book', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'More instrument actions' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Record calibration' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})

test('moves calibration and history onto tabs of their own', async ({
  page,
}) => {
  const tabs = page.locator('[data-record-page] [data-page-tabs] [role="tab"]')

  await expect(tabs.first()).toHaveText('Details')
  await expect(tabs.last()).toHaveText('History')

  await page.getByRole('tab', { name: /^Calibration/ }).click()
  await expect(page.getByText('Last performed')).toBeVisible()

  await tabs.last().click()
  await expect(
    page.getByRole('heading', { name: 'Change history' }),
  ).toBeVisible()
})

test('keeps its other fields in the side panel', async ({ page }) => {
  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Properties' })).toBeVisible()
  await expect(side.getByText('Manufacturer')).toBeVisible()
  await expect(
    side.getByRole('heading', { name: 'Bookings this week' }),
  ).toBeVisible()
})
