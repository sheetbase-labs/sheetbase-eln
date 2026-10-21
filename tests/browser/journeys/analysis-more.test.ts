/**
 * Journey DATA-23: a dataset linked from a notebook by its display id opens on
 * its own page. Analysis journeys ANA-06 to ANA-10 join this file below.
 */
import { expect, test } from 'playwright/test'

import {
  createExperiment,
  createProject,
  signIn,
  uniqueName,
  withAdminDb,
  waitForHydration,
} from './helpers'

test.setTimeout(60_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('DATA-23 a dataset linked from the notebook opens on its own page', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Data link'))
  await createExperiment(page, path, uniqueName('Uses a dataset'))
  await waitForHydration(page)
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('/linked')
  await page.keyboard.press('Enter')
  await page.getByLabel('Target kind').selectOption({ label: 'Dataset' })
  await page.getByLabel('Search records or Datasets').fill('ELISA')
  await page.getByRole('button', { name: /ELISA/ }).first().click()
  // The block autosaves; reload to read it back as a reader would.
  await expect
    .poll(
      () =>
        withAdminDb(
          async (db) =>
            (
              await db.query(
                `SELECT 1 FROM api.blocks
                  WHERE type = 'linked_record'
                    AND payload->>'targetKind' = 'dataset'
                    AND payload->>'targetIdentifier' LIKE 'DS-%'`,
              )
            ).rowCount,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  await page.reload()
  await waitForHydration(page)
  const link = page.getByRole('link', { name: /^Open/ }).first()
  await expect(link).toHaveAttribute('href', /\/datasets\/[0-9a-f-]{36}$/)
  await link.click()
  await expect(page).toHaveURL(/\/datasets\/[0-9a-f-]{36}/, { timeout: 15_000 })
})
