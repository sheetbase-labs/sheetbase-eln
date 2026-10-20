/**
 * Journeys ANA-03, DATA-14 and DATA-20: exporting a figure, defining a new
 * kind of record, and starting a new version of a model.
 */
import { expect, test } from 'playwright/test'

import { open, signIn, uniqueName, waitForHydration } from './helpers'

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

test.setTimeout(90_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('ANA-03 a chart is exported as an image at a chosen size and theme', async ({
  page,
}) => {
  await open(page, `/analysis/new?mode=chart&dataset=${ELISA_DATASET}`)
  await waitForHydration(page)
  await page.getByLabel('Y axis field').selectOption({ label: 'Capsid titre' })
  await page.getByRole('tab', { name: 'Export' }).click()
  await page.getByLabel('Export width').fill('1200')
  await page.getByLabel('Export height').fill('800')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PNG/ }).click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)
})

test('DATA-14 a new kind of record is defined as a draft model and opens', async ({
  page,
}) => {
  const name = uniqueName('Lentivector')
  await open(page, '/models')
  await page.getByRole('button', { name: 'New model' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByPlaceholder('cell_bank_reading')
    .fill(`lenti_${Date.now().toString(36)}`)
  await dialog.getByPlaceholder('e.g. Cell bank reading').fill(name)
  await dialog.getByRole('button', { name: 'Create draft' }).click()
  // The board selects the new draft's row, with its details beside the list.
  await expect(page).toHaveURL(/selected=[0-9a-f-]{36}/)
  await expect(page.getByText(name).first()).toBeVisible()
  await expect(page.getByText(/v1 is a draft/)).toBeVisible()
})

test('DATA-20 a published model can start a new draft version to edit', async ({
  page,
}) => {
  await open(page, '/models')
  await page
    .getByRole('link', { name: 'ELISA and turbidity' })
    .first()
    .click()
  await page.getByRole('button', { name: 'Edit model' }).click()
  await expect(page).toHaveURL(/\/models\/[0-9a-f-]{36}\/edit/)
  await expect(
    page.getByRole('button', { name: 'Start draft' }).first(),
  ).toBeVisible()
})
