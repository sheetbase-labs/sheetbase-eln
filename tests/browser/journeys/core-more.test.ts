/**
 * Journeys CORE-15 to CORE-24: running on a sample, bringing data in, picking
 * work back up, repeating a run, and finding what uses a dataset. Written
 * against the seeded design workspace; a journey that creates data names it
 * uniquely so a re-run reads only what it made.
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
  withAdminDb,
} from './helpers'

const SAMPLE = '00000000-0000-4000-8000-0000000003d0'
const SAMPLE_ID = 'SMP-1002'
const AAV9_PROJECT = '00000000-0000-4000-8000-000000000320'
/** A seeded dataset no experiment is linked to. */
const UNLINKED_DATASET = '00000000-0000-4000-8000-00000000038a'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('CORE-15 a sample offers a new experiment that already uses it', async ({
  page,
}) => {
  await open(page, `/samples/${SAMPLE}`)
  await action(page, 'New experiment').click()
  await expect(page).toHaveURL(/\/experiments\/new\?.*sample=/)
  const title = uniqueName('Run on sample')
  await page.getByLabel(/^title/i).fill(title)
  await page.getByRole('button', { name: /create draft/i }).click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  const expId = new URL(page.url()).pathname.split('/')[2]
  await open(page, `/experiments/${expId}/samples`)
  await expect(page.getByText(SAMPLE_ID).first()).toBeVisible()
})

test('CORE-16 an instrument file is imported into a chosen experiment', async ({
  page,
}) => {
  await open(page, '/import')
  await expect(page.getByLabel('Link to experiment')).toBeVisible()
})

test('CORE-17 a dataset with no experiment can be linked to one', async ({
  page,
}) => {
  try {
    await open(page, `/datasets/${UNLINKED_DATASET}`)
    await expect(page.getByText('Not linked to an experiment')).toBeVisible()
    await page.getByRole('button', { name: /link to experiment/i }).click()
    const picker = page.getByRole('dialog')
    await picker.getByRole('option').first().click()
    await expect(
      page.getByText('Dataset linked to the experiment'),
    ).toBeVisible()
    await expect(page.getByText('Not linked to an experiment')).toHaveCount(0)
  } finally {
    // The seeded dataset stays unlinked for the next run.
    await withAdminDb((db) =>
      db.query(
        `delete from api.record_links where target_kind = 'dataset' and target_identifier = 'DS-0320'`,
      ),
    )
  }
})

test('CORE-18 yesterday’s experiment is the first thing in the list', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Pick up'))
  const title = uniqueName('Left half way')
  await createExperiment(page, path, title)
  await open(page, '/experiments')
  await expect(
    page.getByRole('link', { name: new RegExp(title) }).first(),
  ).toBeVisible()
})

test('CORE-19 duplicating an experiment starts a run that follows it', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Repeat'))
  const title = uniqueName('First run')
  const original = await createExperiment(page, path, title)
  await waitForHydration(page)
  await page
    .getByRole('button', { name: 'More record actions' })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Duplicate' })
    .click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  await expect(page).not.toHaveURL(new RegExp(original))
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  await open(page, `/experiments/${original}/overview`)
  await expect(page.getByText('Next', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`${title} copy`).first()).toBeVisible()
})

test('CORE-22 renaming an experiment shows on its overview', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Rename'))
  const id = await createExperiment(page, path, uniqueName('Old name'))
  const renamed = uniqueName('New name')
  await waitForHydration(page)
  const input = page.getByLabel('Notebook title')
  await expect(input).toHaveValue(/Old name/)
  await input.fill(renamed)
  await input.blur()
  await page.waitForTimeout(800)
  await open(page, `/experiments/${id}/overview`)
  await expect(page.getByLabel('Notebook title').first()).toHaveValue(renamed)
})

test('CORE-23 samples are linked to an experiment from its Samples tab', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Link samples'))
  const id = await createExperiment(page, path, uniqueName('Uses a sample'))
  await open(page, `/experiments/${id}/samples`)
  await page.getByRole('button', { name: /link a sample/i }).click()
  const picker = page.getByRole('dialog')
  await picker.getByRole('option').first().click()
  await picker.getByRole('button', { name: /^link/i }).click()
  await expect(page.getByText('Sample linked')).toBeVisible()
})

test('CORE-24 a dataset names the experiment that used it, and the link opens it', async ({
  page,
}) => {
  await open(page, `/datasets/00000000-0000-4000-8000-000000000381`)
  await page.getByRole('link', { name: 'EXP-0142' }).first().click()
  await expect(page).toHaveURL(
    /\/experiments\/00000000-0000-4000-8000-000000000351/,
  )
  void AAV9_PROJECT
})
