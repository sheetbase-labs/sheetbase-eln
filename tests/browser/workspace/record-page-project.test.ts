/**
 * The shared record page on a project of the design seed: the header says its
 * ID, status and four facts once, Follow sits in the pane header, the tabs end
 * on Settings, and the Overview's side panel holds only what the header does
 * not say.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/projects/PRJ-0217')
  await expect(
    page.getByRole('heading', { level: 1, name: 'AAV9 process transfer' }),
  ).toBeVisible({ timeout: 30_000 })
})

test('says the project once, with Follow in the pane header', async ({
  page,
}) => {
  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('PRJ-0217')
  await expect(meta.locator('[data-record-fact]')).toHaveCount(4)
  await expect(
    page
      .locator('[data-pane-page-actions]')
      .getByRole('button', { name: 'Follow' }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('button', { name: 'New experiment' }).first(),
  ).toBeVisible()
})

test('keeps the rest in the side panel on the Overview only', async ({
  page,
}) => {
  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Properties' })).toBeVisible()
  await expect(side.getByText('Members')).toBeVisible()
  // The header already says the client and lead.
  await expect(side.getByText('Lead', { exact: true })).toHaveCount(0)

  const tabs = page.locator('[data-record-page] [data-page-tabs] a')

  await expect(tabs.last()).toHaveText('Settings')
  await page
    .getByRole('link', { name: /^Experiments/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/experiments$/)
  await expect(side).toHaveCount(0)
})
