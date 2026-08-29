/**
 * SCI-04 browser: open Analysis Studio over a canonical Dataset and use
 * the Chart builder controls.
 */
import { config } from 'dotenv'
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

config({ path: ['.env.local', '.env'] })

const WS = '65000000-0000-4000-8000-000000000940'
const SESSION = 'sci-04-browser-session'
const USER = 'sci-04-browser-owner'

let admin: Client
let datasetId = ''

async function clean() {
  await admin.query('RESET ROLE')
  await admin.query(`DELETE FROM api.datasets WHERE workspace_id=$1`, [WS])
  await admin.query(
    `DELETE FROM api.dataset_schema_definitions WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
  await admin.query(`DELETE FROM internal.session WHERE "userId"=$1`, [USER])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [USER])
}

async function injectAuth(page: import('playwright/test').Page) {
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update(SESSION, 'utf8')
    .digest('base64')
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: `${SESSION}.${signature}`,
      url: 'http://127.0.0.1:3100',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'SCI-04 Owner','sci-04-browser@test.invalid',true)`,
    [USER],
  )
  await admin.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ($1,$2,$3,now()+interval '1 hour')`,
    [SESSION, SESSION, USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'sci-04-browser','SCI-04 Browser')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )

  const schemaRes = await admin.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,'sci04_browser','Dose response','active') RETURNING id`,
    [WS],
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
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
     VALUES ($1,$2,'Dose response') RETURNING id`,
    [WS, svId],
  )
  datasetId = dsRes.rows[0].id
  for (const [dose, response] of [
    [1, 2],
    [2, 4],
    [3, 6],
  ] as const) {
    const rowRes = await admin.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, WS],
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
  await clean()
  await admin.end()
})

test.describe('SCI-04 visualisation builder', () => {
  test('opens the chart builder and chart-type controls', async ({ page }) => {
    await injectAuth(page)
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
