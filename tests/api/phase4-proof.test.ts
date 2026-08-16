/** DATA-006 — real PostgREST proof for an external edit and live invalidation. */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { mintApiClientToken } from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import { buildPersistedFormulaArtifact, parseFormula } from '#/lib/formula-ir'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import {
  createScientificTableAsMigrator,
  openMigratorWriter,
} from '../db/helpers'

config({ path: ['.env.local', '.env'] })

const WS = '64000000-0000-4000-8000-000000000001'
const PROJECT = '64000000-0000-4000-8000-000000000002'
const RECORD = '64000000-0000-4000-8000-000000000003'
const BLOCK = '64000000-0000-4000-8000-000000000004'
const CREDENTIAL = '64000000-0000-4000-8000-000000000005'
const USER = 'phase4-api-owner'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let token: string
let table: any
let row: any
let formulaId: string

async function clean() {
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
  await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [USER])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(path: string, bearer: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (bearer) headers.set('authorization', `Bearer ${bearer}`)
  const resourcePath = path.split('?')[0]
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    resourcePath,
    {
      getSession: async () => ({
        user: { id: USER },
        session: { id: 'phase4-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: WS }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: (value, method, parsed) =>
        resolveExternalToken(database, value, SECRET, method, parsed),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES ($1,'Phase 4 API owner','phase4-api@test.invalid',true)`,
    [USER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'phase4-api','Phase 4 API')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'VSAPI','Virus Stability API')`,
    [PROJECT, WS],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) VALUES ($1,$2,$3,'experiment','VSAPI-1','Virus Stability API',$4)`,
    [RECORD, WS, PROJECT, USER],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id) VALUES ($1,$2,'sheet','{}',1,$3)`,
    [BLOCK, RECORD, USER],
  )
  await admin.query(
    `INSERT INTO internal.api_credentials(id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id)
     VALUES ($1,$2,'phase4api','unused','Phase 4 acceptance',ARRAY['scientific:read','scientific:write'],$3)`,
    [CREDENTIAL, WS, USER],
  )
  token = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['scientific:read', 'scientific:write'],
  })
  const writer = await openMigratorWriter(
    process.env.DATABASE_URL ?? '',
    USER,
    WS,
  )
  table = await createScientificTableAsMigrator(
    writer,
    USER,
    WS,
    BLOCK,
    'External edit proof',
    [
      {
        label: 'Input',
        logical_type: 'decimal',
        nullable: false,
        default: 1,
      },
      { label: 'Double', logical_type: 'decimal', nullable: true },
    ],
  )
  await writer.end()
  const inserted = await proxy(table.resourceName, token, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify({ [table.columns[0].field_name]: 5 }),
  })
  expect(inserted.status).toBe(201)
  row = (await inserted.json())[0]
  const artifact = buildPersistedFormulaArtifact(
    parseFormula('=A1*2', {
      tableId: table.table.id,
      name: table.table.name,
      rowIds: [row.id],
      columnIds: table.columns.map((column: any) => column.id),
      tables: [
        {
          tableId: table.table.id,
          name: table.table.name,
          rowIds: [row.id],
          columnIds: table.columns.map((column: any) => column.id),
        },
      ],
    }),
    table.table.id,
  )
  await admin.query('SET ROLE formula_writer')
  const written = (
    await admin.query(
      `SELECT internal.apply_trusted_formula_write($1,$2::jsonb) result`,
      [
        USER,
        JSON.stringify({
          operation: 'create',
          target: {
            tableId: table.table.id,
            rowId: row.id,
            columnId: table.columns[1].id,
          },
          expectedSchemaVersion: table.table.schema_version,
          expectedRowVersion: row.version,
          artifact,
        }),
      ],
    )
  ).rows[0].result
  formulaId = written.formulaId
  row.version = written.rowVersion
  await admin.query(
    `SELECT internal.apply_trusted_calculation($1,$2,$3,'completed',$4::jsonb,$5::jsonb,$6,$7,NULL)`,
    [
      USER,
      RECORD,
      written.calculationInputRevision,
      JSON.stringify([
        {
          formulaId,
          formulaVersion: 1,
          status: 'completed',
          resultKind: 'value',
          value: 10,
        },
      ]),
      JSON.stringify({ [table.table.id]: table.table.schema_version }),
      'fnv1a32-dcfa915f',
      'fnv1a32-5678abcd',
    ],
  )
  await admin.query('RESET ROLE')
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
  await database?.$client.end()
})

describe('DATA-006 external API acceptance proof', () => {
  it('attributes an external literal edit and exposes the live stale-result transition', async () => {
    const patched = await proxy(
      `${table.resourceName}?id=eq.${row.id}&version=eq.${row.version}`,
      token,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ [table.columns[0].field_name]: 7 }),
      },
    )
    const patchedBody = await patched.json()
    expect({ status: patched.status, body: patchedBody }).toMatchObject({
      status: 200,
      body: expect.any(Array),
    })
    expect(patchedBody).toHaveLength(1)

    const results = await proxy(
      `formula_results?formula_id=eq.${formulaId}`,
      token,
    )
    expect(results.status).toBe(200)
    expect(await results.json()).toMatchObject([
      { calculation_status: 'stale', calculated_value: null },
    ])
    const event = (
      await admin.query(
        `SELECT actor_credential_id,payload FROM api.change_events WHERE entity_uuid=$1 ORDER BY sequence DESC LIMIT 1`,
        [row.id],
      )
    ).rows[0]
    expect(event).toMatchObject({
      actor_credential_id: CREDENTIAL,
      payload: { tableId: table.table.id },
    })
  })
})
