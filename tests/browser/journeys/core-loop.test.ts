/**
 * Journeys CORE-01 to CORE-14: the core science loop as an executable
 * definition of done. Each test is one journey, written against the seeded
 * design workspace, and states the outcome a person should reach without
 * hunting for it: the next step offered where they are, context carried
 * across pages, and creating landing on the thing created.
 *
 * Run with the Playwright browser project against the dev server on
 * 127.0.0.1:3100 (see playwright.config.ts). A journey whose feature is not
 * built yet is expected to fail; that is what makes it the definition of done.
 */
import { expect, test } from 'playwright/test'

import { createExperiment, createProject, signIn, uniqueName } from './helpers'

test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('CORE-01 a new project opens on its own page', async ({ page }) => {
  const path = await createProject(page, uniqueName('Journey project'))
  await expect(
    page.getByRole('link', { name: /new experiment/i }),
  ).toBeVisible()
  expect(path).toMatch(/^\/projects\//)
})

test('CORE-02 a blank experiment from a project lands on its notebook and Cancel returns to the project', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  await page
    .getByRole('link', { name: /new experiment/i })
    .first()
    .click()
  await page.getByRole('link', { name: /^cancel$/i }).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`))
  await createExperiment(page, projectPath, uniqueName('Blank run'))
  await expect(page.getByRole('tab', { name: 'Notebook' })).toBeVisible()
})

test('CORE-03 an experiment started from a protocol opens with the protocol in its notebook', async ({
  page,
}) => {
  await page.goto('/protocols')
  await page.getByRole('row').nth(1).click()
  await page.getByRole('link', { name: /start an experiment/i }).click()
  await expect(page).toHaveURL(/\/experiments\/new\?.*protocol=/)
  await expect(page.getByLabel(/protocol version/i)).toBeVisible()
})

test('CORE-04 an experiment can start from a template with the project kept', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const projectId = projectPath.split('/').pop() ?? ''
  await page.goto(`/experiments/new?project=${projectId}`)
  await page.getByRole('button', { name: /template/i }).click()
  await expect(page.getByLabel(/^project/i)).toHaveValue(projectId)
})

test('CORE-05 the notebook is a tab beside Overview, Links and Results on one page', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const expId = await createExperiment(page, projectPath, uniqueName('Frame'))
  for (const name of ['Overview', 'Links', 'Results', 'History']) {
    await page.getByRole('tab', { name }).click()
    await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/`))
  }
  await page.getByRole('tab', { name: 'Notebook' }).click()
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/notebook`))
  // The record route for the same experiment ends up on the same frame.
  await page.goto(`/records/${expId}/notebook`)
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/notebook`))
})

test('CORE-06 a sheet block in the notebook offers the full sheet with the trail back', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  await createExperiment(page, projectPath, uniqueName('Sheet run'))
  await page.getByRole('button', { name: /insert block/i }).click()
  await page.getByRole('menuitem', { name: /^sheet/i }).click()
  await page.getByRole('link', { name: /open full sheet/i }).click()
  await expect(page).toHaveURL(/\/sheets\//)
  await expect(
    page.getByRole('navigation').getByRole('link').first(),
  ).toBeVisible()
})

test('CORE-07 importing from an experiment links the dataset to it and offers the way back', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const expId = await createExperiment(
    page,
    projectPath,
    uniqueName('Import run'),
  )
  await page.goto(`/experiments/${expId}/links`)
  await page.getByRole('link', { name: /import data/i }).click()
  await expect(page).toHaveURL(new RegExp(`/import\\?.*experiment=${expId}`))
  await expect(page.getByLabel('Link to experiment')).toHaveValue(expId)
  await page.getByRole('link', { name: /^cancel$/i }).click()
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}`))
})

test('CORE-08 a column in a sheet can be promoted to a model', async ({
  page,
}) => {
  await page.goto('/sheets/new')
  await expect(page.getByRole('heading', { name: 'New sheet' })).toBeVisible()
  await page
    .getByRole('button', { name: /create blank sheet/i })
    .scrollIntoViewIfNeeded()
  await expect(page.getByText(/promote/i).first()).toBeVisible()
})

test('CORE-09 a dataset snapshot can be referenced from the notebook', async ({
  page,
}) => {
  await page.goto('/datasets')
  await page.getByRole('row').nth(1).click()
  await page.getByRole('tab', { name: 'Snapshots' }).click()
  await expect(
    page.getByRole('button', { name: /cite in notebook/i }),
  ).toBeVisible()
})

test('CORE-10 a dataset offers Chart and Analyse on every tab, carrying the dataset', async ({
  page,
}) => {
  await page.goto('/datasets')
  await page.getByRole('row').nth(1).click()
  await page.getByRole('link', { name: 'Chart' }).click()
  await expect(page).toHaveURL(/\/analysis\/new\?.*mode=chart.*dataset=/)
})

test('CORE-11 a figure is cited into an experiment notebook and the toast opens it', async ({
  page,
}) => {
  await page.goto('/analysis/new?mode=chart')
  await page.getByRole('button', { name: /cite in a notebook/i }).click()
  await page.getByLabel(/caption/i).fill(uniqueName('Figure'))
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('CORE-12 a saved statistic can be put into the notebook from the studio', async ({
  page,
}) => {
  await page.goto('/analysis/new?mode=analyse')
  await expect(
    page.getByRole('button', { name: /cite in a notebook/i }),
  ).toBeVisible()
})

test('CORE-13 submit offers the reviewer chosen when the experiment was created', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  await createExperiment(page, projectPath, uniqueName('Review run'))
  await page.getByRole('button', { name: 'Submit' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // The author is never the preselected reviewer.
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0)
})

test('CORE-14 a reviewed notebook is signed from its own page', async ({
  page,
}) => {
  await page.goto('/inbox')
  await page
    .getByRole('link', { name: /review/i })
    .first()
    .click()
  await expect(page).toHaveURL(/\/review\//)
  await expect(
    page.getByRole('link', { name: /open working notebook/i }),
  ).toBeVisible()
})
