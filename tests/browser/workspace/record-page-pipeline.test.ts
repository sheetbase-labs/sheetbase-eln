/**
 * The shared record page on a pipeline of the design seed: the header says
 * its ID, version status and facts once, the page opens on its steps, and
 * Activity sits at the far end of the tabs.
 */
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test('opens the pipeline on its steps with its header said once', async ({
  page,
}) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
  await page.goto('/pipelines/PL-0007')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Clarification step yield' }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/pipelines\/[^/]+\/steps$/)

  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('PL-0007')
  await expect(meta.getByText('Editor')).toBeVisible()

  const tabs = page.locator('[data-record-page] [data-page-tabs] a')

  await expect(tabs.first()).toHaveText(/^Steps/)
  await expect(tabs.last()).toHaveText('Activity')

  await page.getByRole('button', { name: 'More for pipeline PL-0007' }).click()
  await expect(page.getByRole('menuitem', { name: 'Run now' })).toBeVisible()
  await page.keyboard.press('Escape')
})
