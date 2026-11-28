/**
 * The shared record page on a protocol and an experiment of the design seed:
 * each says its ID and status once, keeps Follow in the pane header, ends its
 * tabs on History, and opens History on the record's whole timeline.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

const KINDS = [
  {
    kind: 'protocol',
    route: '/protocols/00000000-0000-4000-8000-000000000370',
    identifier: 'PRT-006',
    title: 'HEK293 transfection',
    history: '[aria-label="Record history"]',
  },
  {
    kind: 'experiment',
    route: '/experiments/EXP-0142/summary',
    identifier: 'EXP-0142',
    title: 'Harvest clarification: depth filter screening',
    // An experiment's History is its full audit view.
    history: '[data-history-ready="true"]',
  },
] as const

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

for (const record of KINDS) {
  test.describe(`${record.kind} page`, () => {
    test.beforeEach(async ({ page }) => {
      await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
      await page.goto(record.route)
      await expect(
        page.getByRole('heading', { level: 1, name: record.title }),
      ).toBeVisible({ timeout: 30_000 })
    })

    test('says the record once, with Follow in the pane header', async ({
      page,
    }) => {
      const meta = page.locator('[data-record-page] [data-page-meta]')

      await expect(meta.locator('[data-record-id]')).toHaveText(
        record.identifier,
      )
      expect(await meta.locator('[data-record-fact]').count()).toBeLessThan(5)
      expect(await page.locator('[data-record-state]').count()).toBeLessThan(2)
      await expect(
        page
          .locator('[data-pane-page-actions]')
          .getByRole('button', { name: 'Follow' }),
      ).toBeVisible({ timeout: 20_000 })
    })

    test('ends the tabs on History', async ({ page }) => {
      const tabs = page.locator(
        '[data-record-page] [data-page-tabs] :is([role="tab"], a)',
      )

      await expect(tabs.last()).toHaveText('History')
      await tabs.last().click()
      await expect(page.locator(record.history)).toBeVisible({
        timeout: 20_000,
      })
    })
  })
}
