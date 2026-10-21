/**
 * Journeys DATA-04, DATA-05 and DATA-15: an import refused for a bad row is fixed by
 * uploading the corrected file, and a wrong value in a dataset is flagged and
 * corrected by importing it again into the same dataset, and a record gains a late model field.
 */
import { expect, test } from 'playwright/test'

import { action, open, signIn, uniqueName, waitForHydration } from './helpers'

const ELISA_DATASET = '00000000-0000-4000-8000-000000000381'

test.setTimeout(60_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const HEADER = 'Sample,Plate,Well,Dilution,Capsid titre\n'
const BAD_FILE = `${HEADER}SMP-9001,P1,A1,100,5.2\nSMP-9002,P1,A2,100,not a number\nSMP-9003,P1,A3,100,4.8\n`
const GOOD_FILE = `${HEADER}SMP-9001,P1,A1,100,5.2\nSMP-9002,P1,A2,100,5.0\nSMP-9003,P1,A3,100,4.8\n`

test('DATA-04 a refused row is fixed by uploading a corrected file that keeps the target and mapping', async ({
  page,
}) => {
  const name = uniqueName('Titre run')
  await open(page, '/import')
  await page.getByRole('radio', { name: 'New dataset' }).check()
  await page
    .getByLabel('Model for the new dataset')
    .selectOption({ label: 'ELISA and turbidity v1' })
  await page.getByLabel('New dataset name').fill(name)
  await page.getByLabel('Laboratory file').setInputFiles({
    name: 'titre-run.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BAD_FILE),
  })
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}/)
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Continue' }).click()

  // The check names the row that stops the import and offers the way out.
  await expect(page.getByText('These rows stop the import')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Import \d+ rows/ }),
  ).toBeDisabled()
  await page.getByLabel('Corrected file').setInputFiles({
    name: 'titre-run-corrected.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(GOOD_FILE),
  })

  // The corrected file arrives on the map step of the same dataset.
  await expect(page.getByText(`${name}`).first()).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('These rows stop the import')).toHaveCount(0)
  const send = page.getByRole('button', { name: 'Import 3 rows' })
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByText('Imported 3 rows')).toBeVisible()
})

test('DATA-05 a wrong value is flagged, and Correct by re-import opens the import on the same dataset', async ({
  page,
}) => {
  await open(page, `/datasets/${ELISA_DATASET}/rows`)
  await page.getByRole('row').nth(2).click()
  const inspector = page.getByRole('complementary', { name: 'Row details' })
  await inspector.getByRole('button', { name: /Capsid titre/ }).click()
  await inspector.getByRole('button', { name: 'Mark out of range…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Comment').fill('Plate edge effect, repeat needed.')
  await dialog
    .getByRole('button', { name: 'Mark out of range', exact: true })
    .click()
  await expect(
    inspector.getByText('Plate edge effect, repeat needed.'),
  ).toBeVisible()
  // Put the seeded dataset back as it was.
  await inspector.getByRole('button', { name: 'Clear flag' }).click()
  await expect(inspector.getByText('No flag on this value.')).toBeVisible()

  await action(page, 'Correct by re-import').click()
  await expect(page).toHaveURL(
    new RegExp(`/import\\?.*dataset=${ELISA_DATASET}`),
  )
  await waitForHydration(page)
  await expect(page.getByLabel('Import into dataset')).toHaveValue(
    ELISA_DATASET,
  )
})

const CELL_BANK_RECORD = '00000000-0000-4000-8000-000000000620'

test('DATA-15 a field added to the model after the record was made can be filled in', async ({
  page,
}) => {
  await open(page, `/models/cell_bank/records/${CELL_BANK_RECORD}`)
  await waitForHydration(page)
  const parent = uniqueName('CB-0010 HEK293 MCB')
  await page.getByRole('button', { name: 'Edit details' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Parent bank/).fill(parent)
  await dialog.getByRole('button', { name: /^save/i }).click()
  await expect(page.getByText(parent)).toBeVisible()
  await expect(
    page.getByText(/added to this model after this record was created/),
  ).toHaveCount(0)
})
