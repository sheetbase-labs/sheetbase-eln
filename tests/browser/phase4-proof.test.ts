import { expect, test } from 'playwright/test'
import { config } from 'dotenv'
import { createHmac } from 'node:crypto'
import { Client } from 'pg'

import { mintApiClientToken } from '#/lib/api-credentials'
import { buildPersistedFormulaArtifact, parseFormula } from '#/lib/formula-ir'
import {
  createScientificTableAsMigrator,
  openMigratorWriter,
} from '../db/helpers'

config({ path: ['.env.local', '.env'] })

const WS = '65000000-0000-4000-8000-000000000001'
const PROJECT = '65000000-0000-4000-8000-000000000002'
const RECORD = '65000000-0000-4000-8000-000000000003'
const SOURCE_BLOCK = '65000000-0000-4000-8000-000000000004'
const SUMMARY_BLOCK = '65000000-0000-4000-8000-000000000005'
const CREDENTIAL = '65000000-0000-4000-8000-000000000006'
const SESSION = 'phase4-browser-session-token'
const USER = 'phase4-browser-owner'

let admin: Client
let externalToken: string
let source: any
let sourceRow: any

async function clean() {
  await admin.query('RESET ROLE')
  const resources = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS],
  )
  for (const { resource_name: resource } of resources.rows)
    if (/^sheet_[a-z2-7]{26}$/.test(resource))
      await admin.query(`DROP TABLE IF EXISTS api.${resource}`)
  await admin.query(
    `DELETE FROM api.formula_definitions WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.scientific_tables WHERE workspace_id=$1`, [
    WS,
  ])
  await admin.query(
    `DELETE FROM internal.api_credentials WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id=$1`, [WS])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id=$1`, [WS])
  await admin.query(`DELETE FROM api.change_events WHERE workspace_id=$1`, [WS])
  await admin.query(
    `DELETE FROM api.workspace_change_seq WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [USER])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

async function trustedFormula(payload: Record<string, unknown>) {
  await admin.query('SET ROLE formula_writer')
  try {
    return (
      await admin.query(
        `SELECT internal.apply_trusted_formula_write($1,$2::jsonb) result`,
        [USER, JSON.stringify(payload)],
      )
    ).rows[0].result
  } finally {
    await admin.query('RESET ROLE')
  }
}

test.beforeAll(async () => {
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Phase 4 browser owner','phase4-browser@test.invalid',true)`,
    [USER],
  )
  await admin.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES ('phase4-browser-session',$1,$2,now()+interval '1 hour')`,
    [SESSION, USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'phase4-browser','Phase 4 browser')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'VSB','Virus Stability Browser')`,
    [PROJECT, WS],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','VSB-001','Virus Stability at 4C',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$3,'sheet','{}',1,$4),($2,$3,'sheet','{}',2,$4)`,
    [SOURCE_BLOCK, SUMMARY_BLOCK, RECORD, USER],
  )
  await admin.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id) VALUES ($1,$2,'phase4b01','unused','Browser external edit',ARRAY['projects:read','projects:write'],$3)`,
    [CREDENTIAL, WS, USER],
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
  source = await createScientificTableAsMigrator(
    writer,
    USER,
    WS,
    SOURCE_BLOCK,
    'Raw stability data',
    [
      {
        label: 'Input titer',
        logical_type: 'decimal',
        nullable: false,
        default: 1,
        unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
        validation: { min: 0 },
      },
      {
        label: 'Projected titer',
        logical_type: 'decimal',
        nullable: true,
        unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
      },
    ],
  )
  const summary = await createScientificTableAsMigrator(
    writer,
    USER,
    WS,
    SUMMARY_BLOCK,
    'Stability summary',
    [
      {
        label: 'Combined titer',
        logical_type: 'decimal',
        nullable: true,
        unit: { code: 'PFU/mL', symbol: 'PFU/mL' },
      },
    ],
  )
  await writer.end()
  sourceRow = (
    await admin.query(
      `INSERT INTO api.${source.table.resource_name} (${source.columns[0].field_name}) VALUES (5) RETURNING *`,
    )
  ).rows[0]
  const summaryRow = (
    await admin.query(
      `INSERT INTO api.${summary.table.resource_name} DEFAULT VALUES RETURNING *`,
    )
  ).rows[0]
  await admin.query(
    `UPDATE api.blocks SET payload=jsonb_build_object('tableId',$2::text) WHERE id=$1`,
    [SOURCE_BLOCK, source.table.id],
  )
  await admin.query(
    `UPDATE api.blocks SET payload=jsonb_build_object('tableId',$2::text) WHERE id=$1`,
    [SUMMARY_BLOCK, summary.table.id],
  )
  await admin.query('RESET ROLE')
  const maps = [
    {
      tableId: source.table.id,
      name: source.table.name,
      rowIds: [sourceRow.id],
      columnIds: source.columns.map((column: any) => column.id),
    },
    {
      tableId: summary.table.id,
      name: summary.table.name,
      rowIds: [summaryRow.id],
      columnIds: summary.columns.map((column: any) => column.id),
    },
  ]
  const within = buildPersistedFormulaArtifact(
    parseFormula('=A1*2', { ...maps[0], tables: maps }),
    source.table.id,
  )
  const withinWrite = await trustedFormula({
    operation: 'create',
    target: {
      tableId: source.table.id,
      rowId: sourceRow.id,
      columnId: source.columns[1].id,
    },
    expectedSchemaVersion: source.table.schema_version,
    expectedRowVersion: sourceRow.version,
    artifact: within,
  })
  sourceRow.version = withinWrite.rowVersion
  const cross = buildPersistedFormulaArtifact(
    parseFormula("='Raw stability data'!A1+'Raw stability data'!B1", {
      ...maps[1],
      tables: maps,
    }),
    summary.table.id,
  )
  await trustedFormula({
    operation: 'create',
    target: {
      tableId: summary.table.id,
      rowId: summaryRow.id,
      columnId: summary.columns[0].id,
    },
    expectedSchemaVersion: summary.table.schema_version,
    expectedRowVersion: summaryRow.version,
    artifact: cross,
  })
  externalToken = await mintApiClientToken(process.env.PGRST_JWT_SECRET!, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['projects:read', 'projects:write'],
  })
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

test.afterAll(async () => {
  await clean()
  await admin.end()
})

test('scientific-table REST is fail-closed for external credentials', async ({
  page,
  request,
}) => {
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
  await page.goto(`/records/${RECORD}`)
  await expect(
    page.getByText('Virus Stability at 4C', { exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByLabel('Data interchange')).toHaveCount(2)
  await expect(page.getByText('10', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('15', { exact: true }).first()).toBeVisible()

  const response = await request.patch(
    `/api/db/${source.table.resource_name}?id=eq.${sourceRow.id}&version=eq.${sourceRow.version}`,
    {
      headers: {
        authorization: `Bearer ${externalToken}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      data: { [source.columns[0].field_name]: 7 },
    },
  )
  expect(response.status()).toBe(403)
})
