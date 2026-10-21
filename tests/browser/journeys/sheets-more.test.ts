/**
 * Journeys DATA-08 and DATA-10 to DATA-12: a working sheet that starts from a
 * pasted table, then has a column promoted, becomes a dataset or a definition.
 */
import { expect, test } from 'playwright/test'

import {
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
} from './helpers'

test.setTimeout(90_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const TABLE =
  'Sample\tWell\tTitre\nSMP-1\tA1\t5.2\nSMP-2\tA2\t4.8\nSMP-3\tA3\t6.1\n'

test('DATA-08 a pasted table becomes local columns in a new sheet', async ({
  page,
}) => {
  const project = await createProject(page, uniqueName('Scratch'))
  await open(page, `/sheets/new?project=${project.split('/').pop()}`)
  await page.getByLabel('Paste a table into it').click()
  await page.getByRole('button', { name: 'Create sheet and paste' }).click()
  await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}/)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Pasted data').fill(TABLE)
  await expect(
    dialog.getByText(/3 rows in 3 columns: Sample, Well, Titre/),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Add to sheet' }).click()
  await expect(
    page.getByText('Pasted 3 rows into 3 new local columns.'),
  ).toBeVisible()
  await waitForHydration(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Paste data…' })).toBeVisible()
})
