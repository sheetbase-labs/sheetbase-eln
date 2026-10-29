/**
 * Journey DATA-23: a dataset linked from a notebook by its display id opens on
 * its own page. Analysis journeys ANA-06 to ANA-10 join this file below.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  createExperiment,
  createProject,
  open,
  pickRecord,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
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
  const experimentId = await createExperiment(
    page,
    path,
    uniqueName('Uses a dataset'),
  )
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

  // The same dataset is on the experiment's Links tab, not only in the note.
  await open(page, `/experiments/${experimentId}/links`)
  await expect(
    page.getByRole('link', { name: /^DS-\d+$/ }).first(),
  ).toBeVisible()
})

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

/** Save a chart view of the ELISA dataset and return its name. */
async function saveChartView(page: Page): Promise<string> {
  const name = uniqueName('Titre view')
  await open(page, `/analysis/new?mode=chart&dataset=${ELISA_DATASET}`)
  await waitForHydration(page)
  await page.getByLabel('Y axis field').selectOption({ label: 'Capsid titre' })
  await page.getByRole('tab', { name: /^Views/ }).click()
  await page.getByLabel('Analysis view name').fill(name)
  await page.getByRole('button', { name: 'Save analysis view' }).click()
  await expect(page.getByText(name).first()).toBeVisible()
  return name
}

test('ANA-06 a saved chart is added to the notebook from inside the block', async ({
  page,
}) => {
  const name = await saveChartView(page)
  const path = await createProject(page, uniqueName('Add analysis'))
  const id = await createExperiment(page, path, uniqueName('Writes up'))
  await waitForHydration(page)
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('/chart')
  await page.keyboard.press('Enter')
  await page.getByLabel('Saved chart').selectOption({ label: name })
  await page.getByRole('button', { name: 'Add chart' }).click()
  await expect(page.getByLabel('Analysis title')).toHaveValue(name)
  await expect
    .poll(
      () =>
        withAdminDb(
          async (db) =>
            (
              await db.query(
                `SELECT 1 FROM api.blocks WHERE type = 'analysis'
                  AND payload->>'title' = $1`,
                [name],
              )
            ).rowCount,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  await open(page, `/experiments/${id}/notebook`)
  await expect(page.getByText(name).first()).toBeVisible()
})

test('ANA-07 an analysis whose source changed is refreshed from the studio', async ({
  page,
}) => {
  const name = await saveChartView(page)
  await withAdminDb((db) =>
    db.query(`UPDATE api.datasets SET revision = revision + 1 WHERE id = $1`, [
      ELISA_DATASET,
    ]),
  )
  await open(page, '/analysis')
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('link')
    .first()
    .click()
  await expect(page).toHaveURL(/\/analysis\/[0-9a-f-]{36}/)
  await expect(page.getByText('Sources changed')).toBeVisible()
  await page.getByRole('link', { name: 'Edit in studio' }).click()
  await waitForHydration(page)
  await expect(page.getByRole('button', { name: /^Update to r/ })).toBeEnabled({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: /^Update to r/ }).click()
  await expect(page.getByRole('button', { name: /^Update to r/ })).toHaveCount(
    0,
  )
})

test('ANA-08 an analysis is rerun on a snapshot, or on other data', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}/snapshots`)
  await waitForHydration(page)
  await page.getByRole('row').nth(1).click()
  await page.getByRole('link', { name: 'Analyse this snapshot' }).click()
  await expect(page).toHaveURL(/\/analysis\/new\?.*snapshot=/)
  await expect(
    page.getByRole('heading', { name: 'Analysis Studio' }),
  ).toBeVisible()

  const name = await saveChartView(page)
  await open(page, '/analysis')
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('link')
    .first()
    .click()
  await page.getByRole('button', { name: 'Run on other data' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await pickRecord(
    page,
    dialog.getByRole('button', { name: /^Dataset/ }),
    /Titre run/,
  )
  await dialog.getByRole('button', { name: 'Save copy' }).click()
  await expect(page).toHaveURL(/\/analysis\/[0-9a-f-]{36}/)
  await expect(page.getByText(/Titre run/).first()).toBeVisible()
})

test('ANA-10 a comparison is promoted to a chart without leaving the studio', async ({
  page,
}) => {
  await open(page, `/analysis/new?mode=compare&dataset=${ELISA_DATASET}`)
  await waitForHydration(page)
  await page.getByRole('tab', { name: 'Compare' }).click()
  await page
    .getByRole('button', { name: /Promote/ })
    .first()
    .click()
  await expect(
    page.getByRole('tab', { name: 'Chart builder' }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('radiogroup', { name: 'Chart type' }),
  ).toBeVisible()
})
