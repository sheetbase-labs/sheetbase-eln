/**
 * Journeys AUTO-07 and AUTO-08: a pipeline that needs a parameter runs on a
 * schedule, and a run that waits for a person is answered from the Inbox.
 * Each journey authors its own pipeline through the screens, so it shares no
 * state with the seeded ones.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import { open, signIn, uniqueName, waitForHydration } from './helpers'

test.setTimeout(180_000)
test.use({ viewport: { width: 1280, height: 900 } })

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** Register a pipeline and land on its steps editor. */
async function startPipeline(page: Page, name: string): Promise<string> {
  await open(page, '/pipelines')
  await page.getByRole('button', { name: 'New pipeline' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^key/i).fill(`journey_${Date.now().toString(36)}`)
  await dialog.getByLabel(/^name/i).fill(name)
  await dialog.getByRole('button', { name: 'Create pipeline' }).click()
  await expect(page).toHaveURL(/\/pipelines\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/')[2] ?? ''
  await open(page, `/pipelines/${id}/steps`)
  return id
}

async function publishDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create draft v1' }).click()
  await expect(page.getByText('Draft version created').first()).toBeVisible()
  await page.getByRole('button', { name: 'Publish version' }).click()
  await expect(page.getByText('Version published').first()).toBeVisible()
}

test('AUTO-07 a pipeline with a parameter runs on a schedule that supplies it', async ({
  page,
}) => {
  const id = await startPipeline(page, uniqueName('Nightly summary'))
  await page.getByLabel('Transform').fill('select 1 as plates')
  await page.getByRole('button', { name: 'Add parameter' }).click()
  await page.getByLabel('Parameter 1 name').fill('plate_size')
  await page.getByLabel('Parameter 1 type').selectOption('integer')
  await page.getByLabel('Parameter 1 required').click()
  await publishDraft(page)

  await open(page, `/pipelines/${id}/triggers`)
  await page.getByRole('button', { name: 'New trigger' }).first().click()
  const dialog = page.getByRole('dialog')
  // A trigger that leaves a required parameter out is refused before it is saved.
  await dialog.getByRole('button', { name: 'Add trigger' }).click()
  await expect(dialog.getByText('Required.')).toBeVisible()
  await dialog.getByLabel('Parameter plate_size').fill('384')
  await dialog.getByRole('button', { name: 'Add trigger' }).click()
  await expect(page.getByText('Trigger added').first()).toBeVisible()
  await expect(
    page.getByRole('row', { name: /Daily at 09:00.*With plate_size=384/ }),
  ).toBeVisible()
})

test('AUTO-08 a run waiting for a person is answered from the Inbox', async ({
  page,
}) => {
  const name = uniqueName('Confirm before keeping')
  await startPipeline(page, name)
  await page.getByLabel('Transform').fill('select 1 as plates')
  await page.getByRole('button', { name: 'Add step' }).click()
  await page.getByLabel('Step 1 name').fill('review_plates')
  await page.getByLabel('Step 1 code').fill('select 2 as plates')
  await page.getByLabel('Step 1 waits for a person').click()
  const asked = page.getByLabel('Step 1 asked person')
  const gareth = await asked
    .locator('option', { hasText: /Gareth/ })
    .first()
    .getAttribute('value')
  await asked.selectOption(gareth)
  await publishDraft(page)

  await page.getByRole('link', { name: 'Overview' }).first().click()
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page).toHaveURL(/\/pipelines\/.*runs\/[0-9a-f-]{36}/)
  await expect(page.getByLabel('Waiting prompt')).toBeVisible({
    timeout: 60_000,
  })

  // The Inbox owes the answer, and its row opens the run.
  await open(page, '/inbox')
  await page.getByText(name).first().click()
  await page.getByRole('link', { name: /open the run/i }).click()
  await expect(page).toHaveURL(/\/pipelines\/.*runs\/[0-9a-f-]{36}/)
  await page
    .getByRole('textbox', { name: 'Reason' })
    .fill('Plate counts match.')
  await page.getByRole('button', { name: 'Confirm and continue' }).click()
  await expect(page.getByLabel('Answered prompt')).toBeVisible()
  // Answered, it no longer waits in the Inbox.
  await open(page, '/inbox')
  await expect(
    page.getByRole('list', { name: 'Inbox items' }).getByText(name),
  ).toHaveCount(0)
})
