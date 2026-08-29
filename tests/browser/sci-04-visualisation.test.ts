/**
 * SCI-04 browser: open Analysis Studio over a canonical Dataset in the
 * auth-free fixture workspace (cookies are ignored when
 * SHEETBASE_DEV_AUTH_FREE is enabled).
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

config({ path: ['.env.local', '.env'] })

const FIXTURE_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000001'

const SCHEMA_KEY = 'sci04_browser_e580'

let admin: Client
let datasetId = ''

async function cleanDataset() {
  await admin.query('RESET ROLE')
  if (datasetId) {
    await admin.query(`DELETE FROM api.datasets WHERE id=$1`, [datasetId])
  }
  await admin.query(
    `DELETE FROM api.dataset_schema_definitions WHERE workspace_id=$1 AND key=$2`,
    [FIXTURE_WORKSPACE_ID, SCHEMA_KEY],
  )
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await cleanDataset()

  const schemaRes = await admin.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,$2,'Dose response','active') RETURNING id`,
    [FIXTURE_WORKSPACE_ID, SCHEMA_KEY],
  )
  const svRes = await admin.query(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schemaRes.rows[0].id],
  )
  const svId = svRes.rows[0].id
  await admin.query(
    `INSERT INTO api.dataset_schema_version_fields
      (schema_version_id,field_id,key,label,logical_type,display_order)
     VALUES
      ($1,gen_random_uuid(),'dose','Dose','decimal',1),
      ($1,gen_random_uuid(),'response','Response','decimal',2)`,
    [svId],
  )
  await admin.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [svId],
  )
  const dsRes = await admin.query(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
     VALUES ($1,$2,'Dose response',$3) RETURNING id`,
    [FIXTURE_WORKSPACE_ID, svId, FIXTURE_USER_ID],
  )
  datasetId = dsRes.rows[0].id
  for (const [dose, response] of [
    [1, 2],
    [2, 4],
    [3, 6],
  ] as const) {
    const rowRes = await admin.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, FIXTURE_WORKSPACE_ID],
    )
    const fields = await admin.query<{ field_id: string; key: string }>(
      `SELECT field_id, key FROM api.dataset_schema_version_fields WHERE schema_version_id=$1`,
      [svId],
    )
    const doseId = fields.rows.find((field) => field.key === 'dose')!.field_id
    const responseId = fields.rows.find((field) => field.key === 'response')!
      .field_id
    await admin.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       VALUES ($1,$2,$3), ($1,$4,$5)`,
      [rowRes.rows[0].id, doseId, dose, responseId, response],
    )
  }
})

test.afterAll(async () => {
  await cleanDataset()
  await admin.end()
})

test.describe('SCI-04 visualisation builder', () => {
  test('opens the chart builder and chart-type controls', async ({ page }) => {
    await page.goto(`/analysis?dataset=${datasetId}`)
    await expect(
      page.getByRole('tab', { name: 'Chart builder' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('radiogroup', { name: 'Chart type' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('radio', { name: /scatter/i }).first()).toBeVisible()
    await expect(page.getByLabel('Linear fit')).toBeVisible()
    await expect(page.getByLabel('Horizontal reference')).toBeVisible()
  })
})
