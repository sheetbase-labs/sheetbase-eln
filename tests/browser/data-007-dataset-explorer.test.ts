/**
 * DATA-007 browser acceptance: open the Dataset Explorer at /datasets and
 * exercise the Data, Schema, Relationships and Lineage tabs over a real
 * scientific-table fixture, then save a named view. The fixture is built
 * through ordinary database RPCs (the same the API contract test uses) and
 * the browser proves the rendered explorer works with a real authenticated
 * page load.
 */
import { config } from 'dotenv'
import { createHmac } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from 'playwright/test'

import {
  createScientificTableAsMigrator,
  openMigratorWriter,
} from '../db/helpers'

config({ path: ['.env.local', '.env'] })

const WS = '65000000-0000-4000-8000-000000000701'
const PROJECT = '65000000-0000-4000-8000-000000000702'
const RECORD = '65000000-0000-4000-8000-000000000703'
const BLOCK = '65000000-0000-4000-8000-000000000704'
const SESSION = 'data-007-browser-session'
const USER = 'data-007-browser-owner'

let admin: Client
let sheetTable: { id: string; resource_name: string }
let sheetCols: Array<{ field_name: string; label: string }>

async function clean() {
  await admin.query('RESET ROLE')
  const resources = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS],
  )
  for (const { resource_name: resource } of resources.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(resource)) {
      await admin.query(`DROP TABLE IF EXISTS api.${resource}`)
    }
  }
  await admin.query(`DELETE FROM api.scientific_tables WHERE workspace_id=$1`, [
    WS,
  ])
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN (SELECT id FROM api.records WHERE workspace_id=$1)`,
    [WS],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id=$1`, [WS])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id=$1`, [WS])
  await admin.query(`DELETE FROM api.change_events WHERE workspace_id=$1`, [WS])
  await admin.query(
    `DELETE FROM api.workspace_change_seq WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [USER])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'DATA-007 Owner','data-007-browser@test.invalid',true)`,
    [USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-007','DATA-007')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'D7','DATA-007')`,
    [PROJECT, WS],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id) VALUES ($1,$2,$3,'experiment','D7-1','Stability readings','in_progress',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',1,$3)`,
    [BLOCK, RECORD, USER],
  )

  await admin.query('SET ROLE authenticated')
  await admin.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  const writer = await openMigratorWriter(
    process.env.DATABASE_URL ?? '',
    USER,
    WS,
  )
  const built = await createScientificTableAsMigrator(
    writer,
    USER,
    WS,
    BLOCK,
    'Stability readings (qPCR)',
    [
      {
        label: 'Time (days)',
        logical_type: 'decimal',
        unit: { code: 'd', symbol: 'd' },
      },
      {
        label: 'Log titer',
        logical_type: 'decimal',
        unit: { code: 'log10', symbol: 'log₁₀' },
      },
      { label: 'Condition', logical_type: 'text' },
    ],
  )
  await writer.end()
  sheetTable = built.table
  sheetCols = built.columns
  const x = sheetCols[0]
  const y = sheetCols[1]
  const series = sheetCols[2]
  for (const [t, logTiter, condition] of [
    [0, 7.2, '4 °C'],
    [7, 7.0, '4 °C'],
    [14, 6.6, '4 °C'],
  ] as const) {
    await admin.query(
      `INSERT INTO api.${sheetTable.resource_name} (${x.field_name},${y.field_name},${series.field_name}) VALUES ($1,$2,$3)`,
      [t, logTiter, condition],
    )
  }
  await admin.query('RESET ROLE')
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

test.afterAll(async () => {
  await clean()
  await admin.end()
})

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

test.describe('DATA-007 Dataset Explorer browser acceptance', () => {
  test('renders the explorer tabs and a saved view over a real dataset', async ({
    page,
  }) => {
    await injectAuth(page)
    await page.goto('/datasets')
    await expect(
      page.getByRole('heading', { name: 'Dataset Explorer' }),
    ).toBeVisible({ timeout: 15_000 })

    // The dataset selector lists the fixture sheet.
    const selector = page.getByLabel('Select dataset')
    await expect(selector).toBeVisible({ timeout: 15_000 })
    await expect(selector).toContainText('Stability readings (qPCR)')

    // Data tab: rows from the fixture are rendered.
    await expect(page.getByText('7.2').first()).toBeVisible({
      timeout: 15_000,
    })

    // Schema tab: local columns render.
    await page.getByRole('tab', { name: /Schema/ }).click()
    await expect(page.getByText('Local columns').first()).toBeVisible()
    await expect(page.getByText('Log titer').first()).toBeVisible()

    // Lineage tab: empty state renders (no formulas written).
    await page.getByRole('tab', { name: /Lineage/ }).click()
    await expect(
      page.getByText(/No calculated columns or cross-sheet dependencies/),
    ).toBeVisible()

    // Data tab again: save a named view.
    await page.getByRole('tab', { name: /Data/ }).click()
    await expect(page.getByText('7.2').first()).toBeVisible()
    const nameInput = page.getByLabel('Saved view name')
    await nameInput.fill('Default view')
    await page.getByLabel('Save current view').click()
  })
})
