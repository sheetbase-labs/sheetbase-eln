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

async function deleteFixtureDatasets() {
  await admin.query(
    `DELETE FROM api.datasets WHERE schema_version_id IN (
       SELECT sv.id
         FROM api.dataset_schema_versions sv
         JOIN api.dataset_schema_definitions d ON d.id = sv.schema_id
        WHERE d.workspace_id = $1 AND d.key = $2
     )`,
    [FIXTURE_WORKSPACE_ID, SCHEMA_KEY],
  )
}

async function ensureSchema(): Promise<string> {
  const existing = await admin.query<{ id: string }>(
    `SELECT id FROM api.dataset_schema_definitions
      WHERE workspace_id=$1 AND key=$2`,
    [FIXTURE_WORKSPACE_ID, SCHEMA_KEY],
  )
  if (existing.rows[0]) return existing.rows[0].id
  const schemaRes = await admin.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,$2,'Dose response','active') RETURNING id`,
    [FIXTURE_WORKSPACE_ID, SCHEMA_KEY],
  )
  return schemaRes.rows[0].id
}

async function ensureActiveVersion(schemaId: string): Promise<string> {
  const active = await admin.query<{ id: string }>(
    `SELECT id FROM api.dataset_schema_versions
      WHERE schema_id=$1 AND lifecycle='active' ORDER BY version DESC LIMIT 1`,
    [schemaId],
  )
  if (active.rows[0]) return active.rows[0].id
  const svRes = await admin.query(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schemaId],
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
  return svId
}

test.beforeAll(async () => {
  admin = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  })
  await admin.connect()
  await deleteFixtureDatasets()
  const schemaId = await ensureSchema()
  const svId = await ensureActiveVersion(schemaId)
  const dsRes = await admin.query(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
     VALUES ($1,$2,'Dose response',$3) RETURNING id`,
    [FIXTURE_WORKSPACE_ID, svId, FIXTURE_USER_ID],
  )
  datasetId = dsRes.rows[0].id
  const fields = await admin.query<{ field_id: string; key: string }>(
    `SELECT field_id, key FROM api.dataset_schema_version_fields WHERE schema_version_id=$1`,
    [svId],
  )
  const doseId = fields.rows.find((field) => field.key === 'dose')!.field_id
  const responseId = fields.rows.find(
    (field) => field.key === 'response',
  )!.field_id
  for (const [dose, response] of [
    [1, 2],
    [2, 4],
    [3, 6],
  ] as const) {
    const rowRes = await admin.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, FIXTURE_WORKSPACE_ID],
    )
    await admin.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       VALUES ($1,$2,$3), ($1,$4,$5)`,
      [rowRes.rows[0].id, doseId, dose, responseId, response],
    )
  }
})

test.afterAll(async () => {
  await deleteFixtureDatasets()
  await admin.end()
})

test.describe('SCI-04 visualisation builder', () => {
  test('opens the chart builder and chart-type controls', async ({ page }) => {
    await page.goto(`/analysis?dataset=${datasetId}`)
    await expect(page.getByRole('tab', { name: 'Chart builder' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('radiogroup', { name: 'Chart type' }),
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('radio', { name: /scatter/i }).first(),
    ).toBeVisible()
    await expect(page.getByLabel('Linear fit')).toBeVisible()
    await expect(page.getByLabel('Horizontal reference')).toBeVisible()
    const plot = page.locator('[data-analysis-chart]')
    await expect(plot).toBeVisible()
    const box = await plot.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.height ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.5)
    await expect(plot.locator('svg').first()).toBeVisible()
    const svgInfo = await plot
      .locator('svg')
      .first()
      .evaluate((el) => ({
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        circleCount: el.querySelectorAll('circle').length,
        pathCount: el.querySelectorAll('path').length,
        snippet: el.innerHTML.slice(0, 800),
      }))
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(svgInfo))
    await expect(plot.locator('circle').first()).toBeVisible()
  })
})
