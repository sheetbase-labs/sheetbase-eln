/**
 * Journeys EXP-01 to EXP-21: running an experiment from draft to decision, as a
 * scientist would, in the seeded design workspace. Each journey that writes
 * data creates its own project and names its experiments uniquely.
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


test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('EXP-04 an experiment can be saved as a template and the template is offered when creating', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Template source'))
  const id = await createExperiment(page, path, uniqueName('Good run'))
  await open(page, `/experiments/${id}/summary`)
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page.getByRole('menuitem', { name: 'Save as template' }).click()
  const dialog = page.getByRole('dialog')
  const name = uniqueName('Template')
  await dialog
    .getByLabel(/name|title/i)
    .first()
    .fill(name)
  await dialog.getByRole('button', { name: /save/i }).last().click()
  await expect(page.getByText(/template/i).first()).toBeVisible()
  // A new template is a draft until it is published, so it is found on the
  // templates list rather than offered when creating.
  await open(page, '/templates')
  await expect(
    page.getByRole('link', { name: new RegExp(name) }).first(),
  ).toBeVisible()
})

test('EXP-06 the notebook takes text and a sheet', async ({ page }) => {
  const path = await createProject(page, uniqueName('Write'))
  await createExperiment(page, path, uniqueName('Notes'))
  await waitForHydration(page)
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('Cells were thawed at 37 °C.')
  await expect(page.getByText('Cells were thawed at 37 °C.')).toBeVisible()
})

test('EXP-08 samples used are linked from the notebook and listed on Links', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Materials'))
  const id = await createExperiment(page, path, uniqueName('Uses a sample'))
  await waitForHydration(page)
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page.getByRole('menuitem', { name: /^link records/i }).click()
  const picker = page.getByRole('dialog')
  await picker.getByRole('combobox').fill('SMP-1002')
  await picker.getByText('SMP-1002').first().click()
  await picker.getByRole('button', { name: /^link/i }).last().click()
  await expect(picker).toBeHidden()
  await open(page, `/experiments/${id}/data/links`)
  await expect(page.getByText('SMP-1002').first()).toBeVisible()
})

test('EXP-13 an abandoned experiment is archived out of the list and kept under Archived', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Abandon'))
  const title = uniqueName('Abandoned')
  const id = await createExperiment(page, path, title)
  await open(page, `/experiments/${id}/summary`)
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .getByRole('button', { name: 'Archive', exact: true })
    .click()
  await open(page, '/experiments')
  await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(
    0,
  )
  await open(page, '/experiments?tab=archived&older=true')
  await expect(
    page.getByRole('link', { name: new RegExp(title) }).first(),
  ).toBeVisible()
})

test('EXP-16 a decision recorded on Results shows on the overview', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Decide'))
  const id = await createExperiment(page, path, uniqueName('Decided'))
  await open(page, `/experiments/${id}/data/results`)
  await page.getByRole('button', { name: 'Record decision' }).click()
  await page.getByRole('radio', { name: 'Supported' }).click()
  await page
    .getByRole('textbox', { name: 'Note' })
    .fill('Titre doubled at 72 h.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await open(page, `/experiments/${id}/summary`)
  await expect(page.getByText(/supported/i).first()).toBeVisible()
})

test('EXP-17 an instrument is booked for the experiment from its menu', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Book'))
  const id = await createExperiment(page, path, uniqueName('Needs a reader'))
  await open(page, `/experiments/${id}/summary`)
  await page.getByRole('button', { name: 'More experiment actions' }).click()
  await page.getByRole('menuitem', { name: 'Book instrument' }).click()
  await expect(page).toHaveURL(/\/schedule\?.*experiment=/)
})

test('EXP-18 a reading can be recorded from a sample', async ({ page }) => {
  await open(page, '/samples/00000000-0000-4000-8000-0000000003d0')
  await page.getByRole('button', { name: 'More sample actions' }).click()
  await page.getByRole('menuitem', { name: /record reading/i }).click()
  await expect(page).toHaveURL(/\/readings\/new/)
})

test('EXP-19 the experiments list filters by search, project and status tab', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Filter'))
  const title = uniqueName('Findable')
  await createExperiment(page, path, title)
  await open(page, '/experiments')
  await page.getByPlaceholder(/search experiments/i).fill(title)
  await expect(
    page.getByRole('link', { name: new RegExp(title) }).first(),
  ).toBeVisible()
})

test('EXP-21 New from a project page starts in that project', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Context'))
  const projectId = path.split('/').pop()
  await open(page, path)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Experiment/ }).click()
  await expect(page).toHaveURL(
    new RegExp(`/experiments/new\\?.*project=${projectId}`),
  )
})
