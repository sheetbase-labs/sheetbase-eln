/**
 * Journeys DATA-01 to DATA-23: bringing data in, structuring it and finding
 * it again, as a scientist or steward would, in the seeded design workspace.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  createExperiment,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'
const UNLINKED_DATASET = '00000000-0000-4000-8000-00000000038a'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('DATA-01 an experiment’s Results tab imports data with the experiment already chosen', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Import'))
  const id = await createExperiment(page, path, uniqueName('Plate run'))
  await open(page, `/experiments/${id}/results`)
  await action(page, 'Import data').click()
  await expect(page).toHaveURL(new RegExp(`/import\\?.*experiment=${id}`))
  await expect(page.getByText(/choose|upload|drop/i).first()).toBeVisible()
})

test('DATA-02 an instrument offers Upload a file whether or not delivery is failing', async ({
  page,
}) => {
  await open(page, '/instruments')
  await action(page, /^Upload$/).click()
  await expect(page).toHaveURL(/\/import\?.*instrument=/)
})

test('DATA-03 the Datasets list offers Import data', async ({ page }) => {
  await open(page, '/datasets')
  await action(page, 'Import data').click()
  await expect(page).toHaveURL(/\/import/)
})

test('DATA-06 a dataset’s Imports tab lists its receipts', async ({ page }) => {
  await open(page, `/datasets/${ELISA_DATASET}?view=imports`)
  await expect(
    page.getByRole('heading', { name: 'Imports' }).first(),
  ).toBeVisible()
  await expect(action(page, 'Import a file')).toBeVisible()
})

test('DATA-07 a dataset opens in a working sheet', async ({ page }) => {
  await open(page, `/datasets/${ELISA_DATASET}`)
  await action(page, /open in (a )?sheet|working sheet/i).click()
  await expect(page).toHaveURL(/\/sheets\//)
})

test('DATA-09 a project lists its sheets and starts a new one in that project', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Sheets'))
  await open(page, `${path}/sheets`)
  await action(page, /new (working )?sheet/i).click()
  await expect(page).toHaveURL(/\/sheets\/new\?.*project=/)
})

test('DATA-13 the Models page offers a new model', async ({ page }) => {
  await open(page, '/models')
  await action(page, 'New model').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('DATA-17 a dataset’s Snapshots tab compares two snapshots', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}/snapshots`)
  await expect(
    page.getByRole('button', { name: 'Create snapshot' }),
  ).toBeVisible()
  await page
    .getByRole('link', { name: /^Compare/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/compare/)
})

test('DATA-18 a dataset names the experiments that use it', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}`)
  await expect(page.getByText(/EXP-/).first()).toBeVisible()
})

test('DATA-22 a dataset made by mistake can be archived', async ({ page }) => {
  await open(page, `/datasets/${UNLINKED_DATASET}`)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Archive dataset…' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Archive', exact: true })
    .click()
  await expect(page).toHaveURL(/\/datasets$/)
  await open(page, `/datasets/${UNLINKED_DATASET}`)
  await page.getByRole('button', { name: 'Restore dataset…' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Restore', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Archive dataset…' }),
  ).toBeVisible()
})
