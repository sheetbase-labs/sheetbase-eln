/**
 * Journeys ANA-01 to ANA-12: charting a dataset, keeping the analysis, citing
 * it into a notebook and finding it again, as a scientist would. PIPE-01 sits
 * beside them: a pipeline's actions follow what there is to publish.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  createExperiment,
  expectCited,
  createProject,
  open,
  pickRecord,
  signIn,
  uniqueName,
  waitForHydration,
  openTab,
} from './helpers'

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

test.setTimeout(120_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('ANA-01 Chart on a dataset opens the studio on that dataset', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}`)
  await action(page, 'Chart').click()
  await expect(page).toHaveURL(/\/analysis\/new\?.*mode=chart/)
  await expect(page.getByLabel('Select data source')).toHaveAttribute(
    'data-value',
    ELISA_DATASET,
  )
})

test('ANA-02 the Analysis list starts a new analysis', async ({ page }) => {
  await open(page, '/analysis')
  await page.getByRole('button', { name: 'New analysis' }).click()
  await page.getByRole('menuitem', { name: /Chart$/ }).click()
  await expect(page).toHaveURL(/\/analysis\/new/)
  await expect(
    page.getByRole('heading', { name: 'Analysis Studio' }),
  ).toBeVisible()
})

test('ANA-04 a saved analysis view is listed on the Analysis page', async ({
  page,
}) => {
  const name = uniqueName('Titre view')
  await open(page, `/analysis/new?mode=chart&dataset=${ELISA_DATASET}`)
  await waitForHydration(page)
  await pickRecord(page, page.getByLabel('Y axis field'), 'Capsid titre')
  await page
    .getByRole('button', { name: 'Chart settings', exact: true })
    .click()
  await page.getByRole('tab', { name: /^Views/ }).click()
  await page.getByLabel('Analysis view name').fill(name)
  await page.getByRole('button', { name: 'Save analysis view' }).click()
  await open(page, '/analysis')
  await expect(page.getByText(name).first()).toBeVisible()
})

test('ANA-05 a chart is cited into an experiment notebook and shows there', async ({
  page,
}) => {
  const path = await createProject(page, uniqueName('Cite'))
  const title = uniqueName('Figure home')
  const id = await createExperiment(page, path, title)
  const caption = uniqueName('Capsid titre by dilution')
  await open(
    page,
    `/analysis/new?mode=chart&dataset=${ELISA_DATASET}&experiment=${id}`,
  )
  await waitForHydration(page)
  await pickRecord(page, page.getByLabel('Y axis field'), 'Capsid titre')
  await page
    .getByRole('button', { name: 'Chart settings', exact: true })
    .click()
  await openTab(page, 'Export')
  await page.getByRole('button', { name: 'Cite in a notebook…' }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Save and cite',
    exact: true,
  })
  await dialog.getByRole('textbox').first().fill(caption)
  await dialog.getByRole('combobox').fill(title)
  await dialog.getByText(title).first().click()
  await dialog.getByRole('button', { name: 'Cite', exact: true }).click()
  await expectCited(page)
  await open(page, `/experiments/${id}/notebook`)
  await expect(page.getByText(caption).first()).toBeVisible()
  await open(page, `/experiments/${id}/data/results`)
  await expect(page.getByText('AN-').first()).toBeVisible()
})

test('ANA-09 an analysis names the records that cite it', async ({ page }) => {
  await open(page, '/analysis?tab=cited')
  await page.getByRole('link', { name: /^AN-/ }).first().click()
  await expect(page).toHaveURL(/\/analysis\//)
})

test('ANA-11 a saved statistic opens loaded, under its own name and address', async ({
  page,
}) => {
  await open(page, '/analysis')
  await page
    .getByRole('link', { name: 'ELISA standard curve 4PL', exact: true })
    .first()
    .click()

  await expect(page).toHaveURL(/\/analysis\/[0-9a-f-]{36}$/)
  await expect(
    page.getByRole('heading', { name: 'ELISA standard curve 4PL' }),
  ).toBeVisible()
  // Loaded and already run on the rows it reads: the fit and its method show.
  await expect(page.getByLabel('Analysis name')).toHaveValue(
    'ELISA standard curve 4PL',
  )
  await expect(
    page.getByText('Four-parameter logistic curve (4PL)').first(),
  ).toBeVisible()
  // Just this statistic: no list of the others, and no chart settings.
  await expect(page.getByRole('list', { name: 'Saved analyses' })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('button', { name: 'Chart settings', exact: true }),
  ).toHaveCount(0)

  // An older studio link to the statistic lands on the same page.
  const id = new URL(page.url()).pathname.split('/').at(-1) ?? ''
  await open(page, `/analysis/new?mode=analyse&definition=${id}`)
  await expect(page).toHaveURL(new RegExp(`/analysis/${id}$`))
  await expect(
    page.getByRole('heading', { name: 'ELISA standard curve 4PL' }),
  ).toBeVisible()

  // Its AN- number opens it too.
  const displayId = await page
    .getByText(/^AN-\d+$/)
    .first()
    .textContent()
  await open(page, `/analysis/${displayId}`)
  await expect(page).toHaveURL(new RegExp(`/analysis/${id}$`))
})

test('ANA-12 chart settings appear in the chart builder, not while analysing', async ({
  page,
}) => {
  await open(page, `/analysis/new?mode=analyse&dataset=${ELISA_DATASET}`)
  await waitForHydration(page)
  await expect(
    page.getByRole('button', { name: 'Dose-response curve' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Chart settings', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText('Axis scaling')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Chart builder' }).click()
  await expect(
    page.getByRole('button', { name: 'Chart settings', exact: true }),
  ).toBeVisible()
})

test('PIPE-01 a pipeline offers Publish only when there is something new', async ({
  page,
}) => {
  // Wide enough for the side panel that holds the draft and description.
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/pipelines')
  await page.getByRole('link', { name: 'AEX screen summary' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'AEX screen summary' }),
  ).toBeVisible()

  // Nothing changed since version 1: try it, nothing to publish.
  await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Publish v/ })).toHaveCount(0)
  await expect(page.getByText(/Runs use version 1\./)).toBeVisible()

  // The description wraps instead of being cut off.
  const description = page.getByLabel('Description', { exact: true })
  await expect(description).toHaveJSProperty('tagName', 'TEXTAREA')

  // An edit makes a draft to try and publish.
  await description.fill(
    'Summarises the AEX fraction screen into a table the process team can cite in reports.',
  )
  await expect(
    page.getByRole('button', { name: 'Try the draft' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish v2…' })).toBeEnabled()
  await expect(
    page.getByText(/Runs keep using version 1 until you publish\./),
  ).toBeVisible()
})
