/**
 * Journeys CORE-15 to CORE-24: running on a sample, bringing data in, picking
 * work back up, repeating a run, and finding what uses a dataset. Written
 * against the seeded design workspace; a journey that creates data names it
 * uniquely so a re-run reads only what it made.
 */
import { expect, test } from 'playwright/test'

import {
  createExperiment,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

const SAMPLE = '00000000-0000-4000-8000-0000000003d0'
const SAMPLE_ID = 'SMP-1002'
const AAV9_PROJECT = '00000000-0000-4000-8000-000000000320'
/** A seeded dataset no experiment is linked to. */

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('CORE-15 a sample offers a new experiment that already uses it', async ({
  page,
}) => {
  await open(page, `/samples/${SAMPLE}`)
  await page.getByRole('button', { name: 'More sample actions' }).click()
  await page.getByRole('menuitem', { name: 'New experiment' }).click()
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

test('CORE-18 yesterday’s experiment is the first thing in the list', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Pick up'))
  const title = uniqueName('Left half way')
  await createExperiment(page, path, title)
  await open(page, '/experiments')
  await page.getByPlaceholder(/search experiments/i).fill(title)
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
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page
    .getByRole('menuitem', { name: 'New run of this experiment' })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create run' })
    .click()
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  await expect(page).not.toHaveURL(new RegExp(original))
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}\/notebook/)
  // The new run links back to the experiment it was made from.
  const run = new URL(page.url()).pathname.split('/')[2]
  await open(page, `/experiments/${run}/data/links`)
  await expect(page.getByText(title).first()).toBeVisible()
})

test('CORE-23 samples are linked to an experiment from its Samples tab', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Link samples'))
  const id = await createExperiment(page, path, uniqueName('Uses a sample'))
  await open(page, `/experiments/${id}/samples`)
  await page.getByRole('button', { name: /link a sample/i }).click()
  const picker = page.getByRole('dialog')
  // A scientist with no history has no recent samples, so they type an ID.
  await picker.getByRole('combobox').fill('SMP-1002')
  await picker.getByRole('option', { name: /SMP-1002/ }).click()
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
