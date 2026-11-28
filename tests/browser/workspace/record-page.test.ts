/**
 * The shared record page on a real record, the quarantined AEX resin lot of
 * the design seed: Follow sits in the pane header and follows the record, the
 * header says the ID and status once with the lot's facts, quarantine is one
 * state line with Restore, the tabs end on History, and the side panel holds
 * Properties, Links (five, then Show all) and Activity.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

const ROUTE = '/materials/MAT-0402'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto(ROUTE)
  await expect(
    page.getByRole('heading', { level: 1, name: 'AEX resin, 5 mL column' }),
  ).toBeVisible({ timeout: 30_000 })
})

test('says the record once and keeps its state on one line', async ({
  page,
}) => {
  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('MAT-0402')
  await expect(meta.getByText('Quarantine', { exact: true })).toHaveCount(1)
  await expect(meta.locator('[data-record-fact]')).toHaveCount(4)

  const state = page.locator('[data-record-state="bad"]')

  await expect(state).toContainText('Quarantined')
  await expect(state.getByRole('button', { name: 'Restore' })).toBeVisible()
  await expect(page.locator('[data-record-state]')).toHaveCount(1)
})

test('follows the record from the pane header', async ({ page }) => {
  const slot = page.locator('[data-pane-page-actions]')
  const bell = slot.getByRole('button', { name: 'Follow' })

  await expect(bell).toBeEnabled({ timeout: 20_000 })
  const before = await bell.getAttribute('aria-pressed')

  await bell.click()
  await expect(bell).toHaveAttribute(
    'aria-pressed',
    before === 'true' ? 'false' : 'true',
  )
  // Put it back, so the seed's follows are as they were.
  await bell.click()
  await expect(bell).toHaveAttribute('aria-pressed', before ?? 'false')
})

test('ends the tabs on History and shows the whole timeline there', async ({
  page,
}) => {
  const tabs = page.locator('[data-record-page] [data-page-tabs] [role="tab"]')

  await expect(tabs.last()).toHaveText('History')
  await tabs.last().click()
  await expect(
    page.getByRole('region', { name: 'Record history' }),
  ).toBeVisible()
})

test('keeps the rest in the side panel and the ⋯ menu', async ({ page }) => {
  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Properties' })).toBeVisible()
  await expect(side.getByRole('heading', { name: 'Activity' })).toBeVisible()

  const links = side.locator('section', {
    has: page.getByRole('heading', { name: 'Links' }),
  })
  const showAll = links.getByRole('button', { name: /^Show all/ })

  if (await showAll.isVisible()) {
    await expect(links.getByRole('link')).toHaveCount(5)
    await showAll.click()
    expect(await links.getByRole('link').count()).toBeGreaterThan(5)
  }

  await page
    .locator('[data-record-page]')
    .getByRole('button', { name: 'More lot actions' })
    .click()
  await expect(
    page.getByRole('menuitem', { name: 'Register replacement lot' }),
  ).toBeVisible()
})
