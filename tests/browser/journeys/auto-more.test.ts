/**
 * Journeys AUTO-07 and AUTO-08: a pipeline that needs a parameter runs on a
 * schedule, and a run that waits for a person is answered from the Inbox.
 * Each journey authors its own pipeline through the screens, so it shares no
 * state with the seeded ones.
 */
import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'

import {
  DESIGN_USER,
  createExperiment,
  createProject,
  open,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

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
  await expect(
    page.getByRole('heading', { name: 'Create your first version' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Configure steps', exact: true }).click()
  await expect(page).toHaveURL(`/pipelines/${id}/steps`)
  return id
}

async function publishDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create draft v1' }).click()
  await expect(page.getByText('Draft version created').first()).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Publish saved draft', exact: true }),
  ).toHaveCount(1)
  await page
    .getByRole('button', { name: 'Publish saved draft', exact: true })
    .click()
  await expect(page.getByText('Version published').first()).toBeVisible()
}

test('AUTO-07 a pipeline with a parameter runs on a schedule that supplies it', async ({
  page,
}) => {
  const id = await startPipeline(page, uniqueName('Nightly summary'))
  const fileHelp = page
    .locator('summary')
    .filter({ hasText: 'Author with a local Python file or notebook' })
  await fileHelp.focus()
  await page.keyboard.press('Enter')
  const command = page.getByRole('group', {
    name: 'Push a local Python step',
    exact: true,
  })
  await expect(command).toContainText(`--pipeline ${id}`)
  await expect(
    page.getByText(/Save the first draft below before using push-step/),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await page.getByLabel('Transform code').fill('select 1 as plates')
  await page.locator('summary').filter({ hasText: 'Run parameters' }).click()
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
  await page.getByLabel('Transform code').fill('select 1 as plates')
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

test('AUTO-09 a draft is tried on a chosen dataset version without publishing or recording anything', async ({
  page,
}) => {
  const id = await startPipeline(page, uniqueName('Try before publishing'))
  const recorded = () =>
    withAdminDb(async (db) => {
      const result = await db.query<{ versions: string; runs: string }>(
        `select (select count(*) from api.pipeline_definition_versions
                  where definition_id = $1)::text as versions,
                (select count(*) from api.pipeline_runs r
                   join api.pipeline_definition_versions v
                     on v.id = r.definition_version_id
                  where v.definition_id = $1)::text as runs`,
        [id],
      )
      return result.rows[0]
    })

  // A statement with a mistake says what is wrong and what is available.
  await page.getByRole('button', { name: /^Inputs/ }).click()
  await page.getByRole('button', { name: 'Add input' }).click()
  await page.getByLabel('Input 1 name').fill('readings')
  await page.getByRole('button', { name: /1 Transform SQL/ }).click()
  await page.getByLabel('Transform code').fill('select nope from readings')
  // The SQL is coloured as it is written.
  await expect(
    page.locator('[data-slot="sql-highlight"] .text-primary-text').first(),
  ).toHaveText('select')
  await page.getByRole('button', { name: 'Try draft' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Nothing is saved/)).toBeVisible()
  await dialog
    .getByLabel('Dataset Version for readings')
    .selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Try draft' }).click()
  const result = page.getByRole('region', { name: 'Try draft result' })
  await expect(result.getByText(/Transform failed/)).toBeVisible({
    timeout: 60_000,
  })
  await expect(result.getByText(/Available: readings\(/)).toBeVisible()

  // Fixing it and trying again shows the rows, still without saving.
  await page
    .getByLabel('Transform code')
    .fill('select count(*) as n from readings')
  await expect(result.getByText(/You changed the draft/)).toBeVisible()
  await result.getByRole('button', { name: 'Try the new draft' }).click()
  await expect(result.getByText(/Nothing was saved/)).toBeVisible({
    timeout: 60_000,
  })
  await expect(result.getByRole('columnheader', { name: 'n' })).toBeVisible()
  await expect(result.getByText('1 row.')).toBeVisible()

  // Nothing exists in the database for this pipeline: no version, no run.
  expect(await recorded()).toEqual({ versions: '0', runs: '0' })
  await expect(
    page.getByRole('button', { name: 'Create draft v1' }),
  ).toBeVisible()

  // A narrow pane uses the section selector without losing code or results.
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(
    page.getByRole('navigation', { name: 'Pipeline configuration' }),
  ).toBeHidden()
  await page
    .getByRole('combobox', { name: 'Pipeline section', exact: true })
    .selectOption('output')
  await expect(page.getByLabel('Output mode')).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Pipeline section', exact: true })
    .selectOption('transform')
  await expect(page.getByLabel('Transform code')).toHaveValue(
    'select count(*) as n from readings',
  )
  await expect(page.getByLabel('Transform code')).toBeInViewport()
  await expect(result.getByRole('columnheader', { name: 'n' })).toBeVisible()
})

test('AUTO-10 a run shows its time in the personal zone and is cited in a notebook with links', async ({
  page,
}) => {
  const clearZone = () =>
    withAdminDb((db) =>
      db.query(
        'update api.user_preferences set timezone = null where user_id = $1',
        [DESIGN_USER],
      ),
    )
  await withAdminDb((db) =>
    db.query(
      `update api.user_preferences set timezone = 'Pacific/Auckland' where user_id = $1`,
      [DESIGN_USER],
    ),
  )
  try {
    const experiment = uniqueName('Cites a pipeline run')
    const project = await createProject(page, uniqueName('Pipeline citations'))
    const experimentId = await createExperiment(page, project, experiment)

    const name = uniqueName('Daily plate count')
    const id = await startPipeline(page, name)
    await page.getByLabel('Transform code').fill('select 1 as plates')
    await publishDraft(page)
    await page.getByRole('link', { name: 'Overview' }).first().click()
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page).toHaveURL(/\/pipelines\/.*runs\/[0-9a-f-]{36}/)
    await expect(page.getByText('Succeeded').first()).toBeVisible({
      timeout: 60_000,
    })

    // The run's time is on the person's clock, named, not raw UTC.
    await expect(
      page.getByText(/\b(NZDT|NZST|GMT\+1[23])\b/).first(),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Add to notebook' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(/Search/).fill(experiment)
    await dialog.getByText(experiment).first().click()
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Added to notebook').first()).toBeVisible()

    // The block names the pipeline and links to it and to the run: no bare ids.
    const block = async () =>
      withAdminDb(async (db) => {
        const result = await db.query<{ payload: unknown }>(
          `select payload from api.blocks where record_id = $1 order by created_at desc limit 1`,
          [experimentId],
        )
        return JSON.stringify(result.rows[0]?.payload ?? {})
      })
    await expect.poll(block).toContain(`"href":"/pipelines/${id}"`)
    const stored = await block()
    expect(stored).toContain(name)
    expect(stored).toMatch(
      new RegExp(`"href":"/pipelines/${id}/runs/[0-9a-f-]{36}"`),
    )
  } finally {
    await clearZone()
  }
})
