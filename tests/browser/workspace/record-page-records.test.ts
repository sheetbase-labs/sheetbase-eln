/**
 * The shared record page on a lab's own records (a registry entry, an
 * incident): the header says the ID, status and facts once, the page opens on
 * the model's Details, the notebook's Submit stays in the header on every tab,
 * and History sits at the far end. A locked record says so once, in a state
 * line with Amend, not again in the pane header and the notebook.
 */
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

import { DESIGN_USER_IDS } from '../../visual/design-states'
import { signInAsDesignUser } from '../../visual/sign-in'

test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, DESIGN_USER_IDS.gareth!)
})

test('a registry entry says itself once and opens on its details', async ({
  page,
}) => {
  await page.goto('/records/CL-0001/notebook')
  await expect(
    page.getByRole('heading', { level: 1, name: 'HEK293' }),
  ).toBeVisible({ timeout: 30_000 })

  const meta = page.locator('[data-record-page] [data-page-meta]')

  await expect(meta.locator('[data-record-id]')).toHaveText('CL-0001')
  expect(await meta.locator('[data-record-fact]').count()).toBeLessThan(5)
  await expect(
    page
      .locator('[data-pane-page-actions]')
      .getByRole('button', { name: 'Follow' }),
  ).toBeVisible({ timeout: 20_000 })

  const tabs = page.getByRole('tablist', { name: 'Record sections' })

  await expect(tabs.getByRole('tab', { name: 'Details' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs.getByRole('tab').last()).toHaveText('History')
  await expect(page.getByText('Embryonic kidney')).toBeVisible()

  // The ID and status are the header's: Details lists the model's own fields.
  await expect(
    page.locator('[data-record-page] dt', { hasText: /^ID$/ }),
  ).toHaveCount(0)

  const submit = page.getByRole('button', { name: 'Submit for review' })

  await expect(submit).toBeVisible()
  await tabs.getByRole('tab', { name: 'Notebook' }).click()
  await expect(submit).toBeVisible()
  await expect(page.locator('[data-local-inspector]')).toBeVisible()
})

test('an incident keeps its links and activity beside the details', async ({
  page,
}) => {
  await page.goto('/records/INC-0001/notebook')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Freezer F-2 temperature excursion over the weekend',
    }),
  ).toBeVisible({ timeout: 30_000 })

  const side = page.locator('[data-local-inspector]')

  await expect(side.getByRole('heading', { name: 'Links' })).toBeVisible()
  await expect(side.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(
    page.getByText('Door latch worn.', { exact: false }),
  ).toBeVisible()
})

test('a locked record says so once, with Amend beside it', async ({ page }) => {
  // The experiment page is the first this file opens, so its first render
  // may wait on the dev server compiling it.
  test.setTimeout(90_000)

  const db = new Client({ connectionString: process.env.DATABASE_URL })

  await db.connect()

  const locked = await db
    .query<{ identifier: string }>(
      `select identifier from api.records
        where kind = 'experiment' and locked_at is not null and archived_at is null
          and workspace_id = (select workspace_id from api.records where identifier = 'CL-0001' limit 1)
        order by identifier limit 1`,
    )
    .finally(() => db.end())

  const identifier = locked.rows[0]?.identifier

  expect(identifier, 'the design seed has an approved experiment').toBeTruthy()

  await page.goto(`/experiments/${identifier}`)
  await expect(
    page.getByText(/^Locked since .+, when it was approved\.$/),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Amend…' })).toBeVisible()
  await expect(page.getByText(/Approved · locked/)).toHaveCount(0)
})
