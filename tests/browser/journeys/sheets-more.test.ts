/**
 * Journeys DATA-08 and DATA-10 to DATA-12: a working sheet that starts from a
 * pasted table, then has a column promoted, becomes a dataset or a definition.
 */
import { expect, test } from 'playwright/test'

import type { Page } from 'playwright/test'

import {
  createProject,
  createPublishedModel,
  createUser,
  open,
  signIn,
  signInAs,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

const DESIGN_WORKSPACE = '00000000-0000-4000-8000-000000000300'

test.setTimeout(90_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** A table whose last column is named for this run, so a model it is promoted
 * into never already has a field by that name. */
function table(column = 'Titre'): string {
  return `Sample\tWell\t${column}\nSMP-1\tA1\t5.2\nSMP-2\tA2\t4.8\nSMP-3\tA3\t6.1\n`
}

/** Start a sheet in a new project from a pasted table; returns its address. */
async function sheetFromPaste(page: Page, column = 'Titre'): Promise<string> {
  const project = await createProject(page, uniqueName('Scratch'))
  await open(page, `/sheets/new?project=${project.split('/').pop()}`)
  await page.getByLabel('Paste a table into it').click()
  await page.getByRole('button', { name: 'Create sheet and paste' }).click()
  await expect(page).toHaveURL(/\/sheets\/[0-9a-f-]{36}/)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Pasted data').fill(table(column))
  await expect(
    dialog.getByText(
      new RegExp(`3 rows in 3 columns: Sample, Well, ${column}`),
    ),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Add to sheet' }).click()
  await expect(
    page.getByText('Pasted 3 rows into 3 new local columns.'),
  ).toBeVisible()
  return new URL(page.url()).pathname
}

/** Choose an entry of a sheet column's menu. */
async function columnMenu(page: Page, column: string, entry: string) {
  await page
    .getByRole('columnheader', { name: new RegExp(column) })
    .click({ button: 'right' })
  await page
    .getByRole('menu', { name: new RegExp(`${column} column menu`) })
    .getByRole('button', { name: entry })
    .click()
}

test('DATA-08 a pasted table becomes local columns in a new sheet', async ({
  page,
}) => {
  const sheet = await sheetFromPaste(page)
  await waitForHydration(page)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(sheet))
  await expect(page.getByRole('button', { name: 'Paste data…' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Titre/ })).toBeVisible()
})

test('DATA-10 a local column is promoted into a dataset when a steward approves it', async ({
  page,
}) => {
  const model = uniqueName('Titre readings')
  await createPublishedModel(model)
  const column = `Titre${Date.now().toString(36)}`
  const sheet = await sheetFromPaste(page, column)
  await columnMenu(page, column, 'Promote column…')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Where to').selectOption({ label: model })
  await dialog.getByLabel('Reason').fill('Titre belongs with the ELISA model.')
  await dialog.getByRole('button', { name: 'Request promotion' }).click()
  await expect(page.getByTestId('column-promotions')).toContainText(
    'Awaiting approval',
  )

  // A steward, who is not the requester, decides it.
  const steward = await createUser('Journey Steward')
  await withAdminDb((db) =>
    db.query(
      `insert into api.workspace_memberships(workspace_id, user_id, role) values ($1, $2, 'steward')`,
      [DESIGN_WORKSPACE, steward.id],
    ),
  )
  await signInAs(page, steward)
  await open(page, sheet)
  const panel = page.getByTestId('column-promotions')
  await panel.getByRole('button', { name: 'Approve' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Approve', exact: true })
    .click()
  await expect(panel).toContainText('Approved')

  // The person who asked applies it and lands on the dataset it wrote.
  await signIn(page)
  await open(page, sheet)
  await page
    .getByTestId('column-promotions')
    .getByRole('button', { name: 'Apply promotion' })
    .click()
  await expect(page).toHaveURL(/\/datasets\/[0-9a-f-]{36}/)
})
