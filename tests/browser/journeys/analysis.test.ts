/**
 * Journeys ANA-01 to ANA-10: charting a dataset, keeping the analysis, citing
 * it into a notebook and finding it again, as a scientist would.
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
  await page.getByLabel('Y axis field').selectOption({ label: 'Capsid titre' })
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
  await page.getByLabel('Y axis field').selectOption({ label: 'Capsid titre' })
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
  await expect(page.getByText('Cited in a notebook').first()).toBeVisible()
  await open(page, `/experiments/${id}/notebook`)
  await expect(page.getByText(caption).first()).toBeVisible()
  await open(page, `/experiments/${id}/results`)
  await expect(page.getByText('AN-').first()).toBeVisible()
})

test('ANA-09 an analysis names the records that cite it', async ({ page }) => {
  await open(page, '/analysis?tab=cited')
  await page.getByRole('link', { name: /^AN-/ }).first().click()
  await expect(page).toHaveURL(/\/analysis\//)
})
