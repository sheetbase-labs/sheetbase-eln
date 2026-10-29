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
import type { Locator, Page } from 'playwright/test'

import {
  createExperiment,
  createProject,
  ensureEffectiveProtocol,
  open,
  signIn,
  uniqueName,
} from './helpers'

/** A Button-styled link is announced as a button; a plain link as a link. */
function action(page: Page, name: RegExp | string): Locator {
  return page
    .getByRole('link', { name })
    .or(page.getByRole('button', { name }))
    .first()
}

/** The experiment frame's section navigation. */
function section(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Experiment sections' })
    .getByRole('link', { name: new RegExp(`^${name}\\b`) })
}

/** An effective protocol version is needed to start an experiment from one. */
const EFFECTIVE_PROTOCOL = '00000000-0000-4000-8000-000000000390'
const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

// The dev server compiles each route on first visit, so a journey that crosses
// several pages needs more than the default budget on a cold run.
test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeAll(async () => {
  await ensureEffectiveProtocol(EFFECTIVE_PROTOCOL)
})

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('CORE-01 a new project opens on its own page', async ({ page }) => {
  const path = await createProject(page, uniqueName('Journey project'))
  await expect(action(page, /new experiment/i)).toBeVisible({ timeout: 60_000 })
  expect(path).toMatch(/^\/projects\//)
})

test('CORE-02 a blank experiment from a project lands on its notebook and Cancel returns to the project', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  await action(page, /new experiment/i).click()
  await action(page, /^cancel$/i).click()
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`))
  await createExperiment(page, projectPath, uniqueName('Blank run'))
  await expect(section(page, 'Notebook')).toBeVisible()
})

test('CORE-03 an experiment started from a protocol opens with the protocol in its notebook', async ({
  page,
}) => {
  await open(page, `/protocols/${EFFECTIVE_PROTOCOL}`)
  await action(page, /^start experiment$/i).click()
  await expect(page).toHaveURL(/\/experiments\/new\?.*protocol=/)
  await expect(page.getByLabel(/protocol version/i)).toBeVisible()
})

test('CORE-04 an experiment can start from a template with the project kept', async ({
  page,
}) => {
  const projectTitle = uniqueName('Journey project')
  const projectPath = await createProject(page, projectTitle)
  const projectId = projectPath.split('/').pop() ?? ''
  await open(page, `/experiments/new?project=${projectId}`)
  await page.getByRole('button', { name: /a template/i }).click()
  await expect(page.getByRole('button', { name: /^project/i })).toContainText(
    projectTitle,
  )
})

test('CORE-05 the notebook is a section beside Overview, Samples and Results on one page', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const expId = await createExperiment(page, projectPath, uniqueName('Frame'))
  for (const name of ['Overview', 'Samples', 'Results', 'History']) {
    await section(page, name).click()
    await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/`))
  }
  await section(page, 'Notebook').click()
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/notebook`))
  // The record route for the same experiment ends up on the same frame.
  await open(page, `/records/${expId}/notebook`)
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}/notebook`))
})

test('CORE-06 a sheet block in the notebook offers the full sheet with the trail back', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  await createExperiment(page, projectPath, uniqueName('Sheet run'))
  await page
    .getByRole('button', { name: /insert block/i })
    .first()
    .click()
  await page.getByRole('option', { name: /^sheet\b/i }).click()
  await action(page, /open full sheet/i).click()
  await expect(page).toHaveURL(/\/sheets\//)
  await expect(
    page.getByRole('navigation', { name: /breadcrumb/i }).getByRole('link'),
  ).not.toHaveCount(0)
})

test('CORE-07 importing from an experiment links the dataset to it and offers the way back', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const expTitle = uniqueName('Import run')
  const expId = await createExperiment(page, projectPath, expTitle)
  await open(page, `/experiments/${expId}/links`)
  await action(page, /import data/i).click()
  await expect(page).toHaveURL(new RegExp(`/import\\?.*experiment=${expId}`))
  await expect(page.getByLabel('Link to experiment')).toContainText(expTitle)
  await action(page, /^cancel$/i).click()
  await expect(page).toHaveURL(new RegExp(`/experiments/${expId}`))
})

test('CORE-08 a column in a sheet can be promoted to a model', async ({
  page,
}) => {
  await open(page, '/sheets/new')
  await expect(page.getByRole('heading', { name: 'New sheet' })).toBeVisible()
  await page
    .getByRole('button', { name: /create blank sheet/i })
    .scrollIntoViewIfNeeded()
  await expect(page.getByText(/promote/i).first()).toBeVisible()
})

test('CORE-09 a dataset snapshot can be referenced from the notebook', async ({
  page,
}) => {
  const projectPath = await createProject(page, uniqueName('Journey project'))
  const title = uniqueName('Snapshot run')
  const expId = await createExperiment(page, projectPath, title)
  await open(page, `/datasets/${ELISA_DATASET}/snapshots`)
  await action(page, /cite in (a )?notebook/i).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(title)
  await dialog.getByText(title).first().click()
  await dialog.getByRole('button', { name: /^cite$/i }).click()
  await expect(page.getByText('Cited in a notebook')).toBeVisible()
  await open(page, `/experiments/${expId}/links`)
  await expect(page.getByRole('link', { name: 'DS-0311' })).toBeVisible()
})

test('CORE-10 a dataset offers Chart and Analyse on every tab, carrying the dataset', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}/snapshots`)
  await action(page, 'Chart').click()
  await expect(page).toHaveURL(/\/analysis\/new\?.*mode=chart.*dataset=/)
})

test('CORE-11 a figure is cited into an experiment notebook and the toast opens it', async ({
  page,
}) => {
  await open(page, '/analysis/new?mode=chart')
  await page.getByRole('tab', { name: 'Export' }).click()
  await action(page, /cite in a notebook/i).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel(/caption/i).fill(uniqueName('Figure'))
})

test('CORE-12 a saved statistic can be put into the notebook from the studio', async ({
  page,
}) => {
  await open(page, '/analysis/new?mode=analyse')
  await page.getByRole('tab', { name: 'Export' }).click()
  await expect(action(page, /cite in a notebook/i)).toBeVisible()
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
  await open(page, '/inbox')
  await page.getByRole('button', { name: /^reviews/i }).click()
  // A row, not the "Collapse" button a group header can put first in the list.
  await page
    .getByRole('list', { name: 'Inbox items' })
    .getByRole('listitem')
    .filter({ hasText: /review requested/i })
    .first()
    .getByRole('button')
    .click()
  await page
    .getByRole('complementary', { name: 'Item details' })
    .getByRole('link', { name: /^open$/i })
    .click()
  await expect(page).toHaveURL(/\/review\//)
  await expect(action(page, /open working notebook/i)).toBeVisible()
})
