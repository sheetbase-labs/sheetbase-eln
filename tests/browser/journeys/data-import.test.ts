/**
 * Journeys DATA-04, DATA-05 and DATA-15: an import refused for a bad row is fixed by
 * uploading the corrected file, and a wrong value in a dataset is flagged and
 * corrected by importing it again into the same dataset, and a record gains a late model field.
 */
import { expect, test } from 'playwright/test'

import {
  action,
  open,
  pickRecord,
  signIn,
  uniqueName,
  waitForHydration,
  withAdminDb,
} from './helpers'

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
  await pickRecord(
    page,
    page.getByLabel('Dataset structure for the new dataset'),
    /ELISA and turbidity.*Version 1/,
  )
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
  await expect(inspector.getByText('No flag on this value')).toBeVisible()

  await action(page, 'Correct by re-import').click()
  await expect(page).toHaveURL(
    new RegExp(`/import\\?.*dataset=${ELISA_DATASET}`),
  )
  await waitForHydration(page)
  await expect(page.getByLabel('Import into dataset')).toHaveAttribute(
    'data-value',
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

/**
 * A model of its own with a dataset on v1, and a published v2 that adds one
 * optional field. Publishing v2 leaves the dataset on v1 until a steward moves it.
 */
async function datasetBehindItsModel(name: string): Promise<string> {
  return withAdminDb(async (db) => {
    const workspace = '00000000-0000-4000-8000-000000000300'
    const definition = await db.query<{ id: string }>(
      `insert into api.dataset_schema_definitions(workspace_id, key, name, lifecycle)
       values ($1, $2, $3, 'active') returning id`,
      [workspace, `journey_${Math.random().toString(36).slice(2, 10)}`, name],
    )
    const fieldId = (
      await db.query<{ id: string }>('select gen_random_uuid() id')
    ).rows[0]!.id
    const versions: string[] = []
    for (const [version, fields] of [
      [1, [['note', 'Note']]],
      [
        2,
        [
          ['note', 'Note'],
          ['reviewer', 'Reviewer'],
        ],
      ],
    ] as const) {
      const row = await db.query<{ id: string }>(
        `insert into api.dataset_schema_versions(schema_id, "version", lifecycle)
         values ($1, $2, 'draft') returning id`,
        [definition.rows[0]!.id, version],
      )
      for (const [index, [key, label]] of fields.entries()) {
        await db.query(
          `insert into api.dataset_schema_version_fields
             (schema_version_id, field_id, key, label, logical_type, display_order)
           values ($1, case when $2 = 'note' then $5::uuid else gen_random_uuid() end, $2, $3, 'text', $4)`,
          [row.rows[0]!.id, key, label, index + 1, fieldId],
        )
      }
      await db.query(
        `update api.dataset_schema_versions set lifecycle = 'active', published_at = now() where id = $1`,
        [row.rows[0]!.id],
      )
      versions.push(row.rows[0]!.id)
    }
    const dataset = await db.query<{ id: string }>(
      `insert into api.datasets(workspace_id, schema_version_id, name)
       values ($1, $2, $3) returning id`,
      [workspace, versions[0], name],
    )
    return dataset.rows[0]!.id
  })
}

test('DATA-19 a steward upgrades an existing dataset to the newer model version', async ({
  page,
}) => {
  const name = uniqueName('Behind its model')
  const datasetId = await datasetBehindItsModel(name)
  await open(page, `/datasets/${datasetId}`)
  await page.getByRole('button', { name: 'Model v2 available' }).click()
  const dialog = page.getByRole('dialog')
  // The preview says what the move changes before anything is written.
  await expect(dialog.getByText(/Reviewer/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Upgrade to v2' }).click()
  await expect(page.getByText('Dataset now follows model v2')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Model v2 available' }),
  ).toHaveCount(0)
  const followed = await withAdminDb(
    async (db) =>
      (
        await db.query<{ version: number }>(
          `select v."version" from api.datasets d
           join api.dataset_schema_versions v on v.id = d.schema_version_id
          where d.id = $1`,
          [datasetId],
        )
      ).rows[0]?.version,
  )
  expect(followed).toBe(2)
})
