/**
 * Journeys ADMIN-13, ADMIN-20, ADMIN-22/REV-11 and REV-12: the bell, a second
 * workspace, sharing with a client, and the evidence page of a signed revision.
 */
import { expect, test } from 'playwright/test'

import {
  createUser,
  createWorkspace,
  open,
  pickRecord,
  signIn,
  signInAs,
  uniqueName,
  withAdminDb,
} from './helpers'

test.setTimeout(90_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('ADMIN-13 the bell lists what needs me and leads to the inbox and its settings', async ({
  page,
}) => {
  await open(page, '/')
  await page.getByRole('button', { name: /^Notifications/ }).click()
  await expect(page.getByText('Mark all read')).toBeVisible()
  await page.getByText('Notification settings').click()
  await expect(page).toHaveURL(/\/settings\/notifications/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Notifications/ }).click()
  await page.getByText('Open inbox').click()
  await expect(page).toHaveURL(/\/inbox/)
})

test('ADMIN-20 a person in two workspaces can switch between them', async ({
  page,
}) => {
  // A fresh person, so the owner's own saved workspace is left alone.
  const person = await createUser(uniqueName('Switcher'))
  const first = uniqueName('First lab')
  const second = uniqueName('Second lab')
  await createWorkspace(person, first)
  await createWorkspace(person, second)
  await signInAs(page, person)
  await open(page, '/')
  const switcher = page.getByRole('button', { name: 'Switch workspace' })
  await switcher.click()
  const other = (await switcher.textContent())?.includes(first) ? second : first
  await page.getByRole('menuitem', { name: new RegExp(other) }).click()
  await expect(switcher).toContainText(other)
})

test('ADMIN-22 a record is shared with a client and previewed as that client', async ({
  page,
}) => {
  await open(page, '/settings/clients')
  const client = uniqueName('Client')
  await page.getByRole('button', { name: 'New client' }).click()
  await page.getByPlaceholder('e.g. Acme Biologics').fill(client)
  await page.getByRole('button', { name: 'Add client' }).click()
  await expect(
    page.getByRole('combobox', { name: 'Client' }).locator('option:checked'),
  ).toContainText(client)
  await pickRecord(
    page,
    page.getByRole('button', { name: 'Share an approved record' }),
    'first',
  )
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByRole('button', { name: 'Preview as client' }).click()
  await expect(
    page.getByRole('button', { name: 'Close preview' }),
  ).toBeVisible()
})

test('REV-12 the evidence page of a signed revision offers the PDF and the package', async ({
  page,
}) => {
  // Seed revision ids are generated per seed, so find a signed one.
  const signedRevision = await withAdminDb(
    async (db) =>
      (
        await db.query<{ revision_id: string }>(
          `SELECT s.revision_id FROM api.signatures s
             JOIN api.records r ON r.id = s.record_id
            WHERE r.workspace_id = '00000000-0000-4000-8000-000000000300'
            ORDER BY s.signed_at LIMIT 1`,
        )
      ).rows[0]?.revision_id,
  )
  expect(signedRevision).toBeTruthy()
  await open(page, `/evidence/${signedRevision}`)
  for (const heading of ['Integrity', 'Signatures', 'Revision']) {
    await expect(
      page.getByRole('heading', { name: heading }).first(),
    ).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Export evidence package' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Create amendment' }),
  ).toBeVisible()
})
