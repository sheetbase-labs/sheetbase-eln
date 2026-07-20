import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { mintApiClientToken } from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { buildScientificApiExamples } from '#/components/sheet/scientific-api-inspector'

config({ path: ['.env.local', '.env'] })

const WS = '62000000-0000-4000-8000-000000000001'
const PROJECT = '62000000-0000-4000-8000-000000000002'
const RECORD = '62000000-0000-4000-8000-000000000003'
const BLOCK = '62000000-0000-4000-8000-000000000004'
const OWNER = 'data-003-api-owner'
const CREDENTIAL = '62000000-0000-4000-8000-000000000005'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let readToken: string
let writeToken: string
let rowToken: string
let projectToken: string
let resource: string
let tableId: string
let textField: string
let numberField: string
let textColumnId: string
let numberColumnId: string
let schemaVersion: number

async function cleanFixture(): Promise<void> {
  const existing = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS],
  )
  for (const row of existing.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await admin.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await admin.query(`DELETE FROM api.scientific_tables WHERE workspace_id=$1`, [
    WS,
  ])
  await admin.query(
    `DELETE FROM internal.api_credentials WHERE workspace_id=$1`,
    [WS],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS])
  await admin.query(`DELETE FROM internal."user" WHERE id=$1`, [OWNER])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => ({
      user: { id: OWNER },
      session: { id: 'data-003-api-session' },
    }),
    getWorkspaceForUser: async () => ({ id: WS }),
    mintToken: (input) => mintPostgrestToken(SECRET, input),
    resolveExternalToken: (token, method, parsedPath) =>
      resolveExternalToken(database, token, SECRET, method, parsedPath),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function request(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(`http://sheetbase.test/api/db/${path}`, {
    ...init,
    headers,
  })
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({
    connectionString: process.env.DATABASE_URL,
  })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await cleanFixture()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'API Owner','data-003-api@test.invalid',true)`,
    [OWNER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'data-003-api','DATA-003 API')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, OWNER],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES ($1,$2,'D3API','DATA-003 API')`,
    [PROJECT, WS],
  )
  await admin.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     VALUES ($1,$2,$3,'experiment','D3API-1','API sheet',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await admin.query(
    `INSERT INTO api.blocks(id,record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,$2,'sheet','{}',1,$3)`,
    [BLOCK, RECORD, OWNER],
  )
  await admin.query(
    `INSERT INTO internal.api_credentials
     (id,workspace_id,display_prefix,secret_hash,name,scopes,created_by_user_id)
     VALUES ($1,$2,'d3api001','unused','API contract',$3,$4)`,
    [
      CREDENTIAL,
      WS,
      [
        'projects:read',
        'scientific:read',
        'scientific:write',
        'scientific:schema',
      ],
      OWNER,
    ],
  )
  readToken = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['scientific:read'],
  })
  writeToken = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['scientific:write'],
  })
  rowToken = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['scientific:read', 'scientific:write'],
  })
  projectToken = await mintApiClientToken(SECRET, {
    workspaceId: WS,
    credentialId: CREDENTIAL,
    scopes: ['projects:read'],
  })

  const create = await proxy(
    request('rpc/create_scientific_table', null, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        p_block_id: BLOCK,
        p_name: 'HTTP measurements',
        p_columns: [
          { label: 'Sample', logical_type: 'text', nullable: false },
          { label: 'Result', logical_type: 'integer' },
        ],
      }),
    }),
    'rpc/create_scientific_table',
  )
  expect(create.status).toBe(200)
  const created = await create.json()
  resource = created.resourceName
  tableId = created.table.id
  schemaVersion = created.table.schema_version
  textField = created.columns[0].field_name
  numberField = created.columns[1].field_name
  textColumnId = created.columns[0].id
  numberColumnId = created.columns[1].id
})

afterAll(async () => {
  if (admin) {
    await cleanFixture()
    await admin.end()
  }
  await database?.$client.end()
})

describe('DATA-003 real PostgREST contract', () => {
  it('discovers metadata and rejects a projects-only credential', async () => {
    const metadata = await proxy(
      request(`rpc/scientific_table_metadata?p_table_id=${tableId}`, readToken),
      'rpc/scientific_table_metadata',
    )
    expect(metadata.status).toBe(200)
    const body = await metadata.json()
    expect(body).toMatchObject([
      {
        id: tableId,
        resource_name: resource,
        relationships: [],
      },
    ])
    expect(
      body[0].columns.map((column: { label: string }) => column.label),
    ).toEqual(['Sample', 'Result'])

    const formulaResults = await proxy(
      request(`formula_results?record_id=eq.${RECORD}`, readToken),
      'formula_results',
    )
    expect(formulaResults.status).toBe(200)
    expect(await formulaResults.json()).toEqual([])

    const denied = await proxy(request(resource, projectToken), resource)
    expect(denied.status).toBe(403)
    expect((await denied.json()).error.category).toBe('permission_denied')
  })

  it('creates, reads, filters, orders and paginates generated rows', async () => {
    const writeOnly = await proxy(
      request(resource, writeToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [textField]: 'Z', [numberField]: 9 }),
      }),
      resource,
    )
    expect(writeOnly.status).toBe(201)

    const inserted = await proxy(
      request(resource, rowToken, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify([
          { [textField]: 'B', [numberField]: 2 },
          { [textField]: 'A', [numberField]: 1 },
        ]),
      }),
      resource,
    )
    expect(inserted.status).toBe(201)
    expect(await inserted.json()).toHaveLength(2)

    const filtered = await proxy(
      request(
        `${resource}?select=id,version,${textField},${numberField}&${numberField}=gte.1&order=${textField}.asc&limit=1`,
        readToken,
        { headers: { range: '0-0', 'range-unit': 'items' } },
      ),
      resource,
    )
    expect(filtered.status).toBe(200)
    expect(await filtered.json()).toMatchObject([{ [textField]: 'A' }])
    expect(filtered.headers.get('content-range')).toMatch(/^0-0\//)
  })

  it('updates and deletes by id/version and returns a stable stale conflict', async () => {
    const rowsResponse = await proxy(
      request(`${resource}?order=${textField}.asc&limit=1`, readToken),
      resource,
    )
    const row = (await rowsResponse.json())[0]
    const updated = await proxy(
      request(
        `${resource}?id=eq.${row.id}&version=eq.${row.version}`,
        rowToken,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [numberField]: 5 }),
        },
      ),
      resource,
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject([{ id: row.id, version: 2 }])

    const stale = await proxy(
      request(
        `${resource}?id=eq.${row.id}&version=eq.${row.version}`,
        rowToken,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [numberField]: 6 }),
        },
      ),
      resource,
    )
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.category).toBe('stale_version')

    const deleted = await proxy(
      request(`${resource}?id=eq.${row.id}&version=eq.2`, rowToken, {
        method: 'DELETE',
      }),
      resource,
    )
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject([{ id: row.id }])
  })

  it('rejects null bulk concurrency and edit arguments over PostgREST', async () => {
    const nullVersion = await proxy(
      request('rpc/apply_scientific_row_edits', rowToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_table_id: tableId,
          p_expected_schema_version: null,
          p_edits: [],
        }),
      }),
      'rpc/apply_scientific_row_edits',
    )
    expect(nullVersion.status).toBe(400)
    expect((await nullVersion.json()).error.category).toBe('validation_error')

    const nullEdits = await proxy(
      request('rpc/apply_scientific_row_edits', rowToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_table_id: tableId,
          p_expected_schema_version: schemaVersion,
          p_edits: null,
        }),
      }),
      'rpc/apply_scientific_row_edits',
    )
    expect(nullEdits.status).toBe(400)
    expect((await nullEdits.json()).error.category).toBe('validation_error')
  })

  it('executes the API inspector request model against the real contract', async () => {
    const metadataResponse = await proxy(
      request(`rpc/scientific_table_metadata?p_table_id=${tableId}`, readToken),
      'rpc/scientific_table_metadata',
    )
    const metadata = (await metadataResponse.json())[0]
    const examples = buildScientificApiExamples(metadata)
    const insert = examples.find((example) => example.id === 'insert')!
    const insertedResponse = await proxy(
      request(insert.path.replace('/api/db/', ''), rowToken, {
        method: insert.method,
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify(insert.body),
      }),
      resource,
    )
    expect(insertedResponse.status).toBe(201)
    const inserted = (await insertedResponse.json())[0]
    const executable = buildScientificApiExamples(metadata, {
      rowId: inserted.id,
      rowVersion: inserted.version,
    })
    for (const id of ['list', 'filter'] as const) {
      const example = executable.find((item) => item.id === id)!
      const response = await proxy(
        request(example.path.replace('/api/db/', ''), rowToken, {
          method: example.method,
        }),
        resource,
      )
      expect(response.status).toBe(200)
    }
    const update = executable.find((example) => example.id === 'update')!
    const updated = await proxy(
      request(update.path.replace('/api/db/', ''), rowToken, {
        method: update.method,
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify(update.body),
      }),
      resource,
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toHaveLength(1)
  })

  it('imports rows and reads transfer provenance through the real API boundary', async () => {
    const imported = await proxy(
      request('rpc/import_scientific_rows', rowToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_table_id: tableId,
          p_expected_schema_version: schemaVersion,
          p_file: {
            name: 'api.csv',
            size: 12,
            sha256: 'b'.repeat(64),
            encoding: 'utf-8',
            delimiter: ',',
            header: true,
          },
          p_mappings: [
            { source: 'Sample', columnId: textColumnId },
            { source: 'Result', columnId: numberColumnId },
          ],
          p_rows: [
            { Sample: 'api-import', Result: 4 },
            { Sample: 'api-import', Result: 4 },
          ],
          p_duplicate_strategy: 'skip_file',
        }),
      }),
      'rpc/import_scientific_rows',
    )
    expect(imported.status).toBe(200)
    expect(await imported.json()).toMatchObject({
      importedRows: 1,
      skippedDuplicates: 1,
    })
    const transfers = await proxy(
      request(`scientific_transfers?table_id=eq.${tableId}`, readToken),
      'scientific_transfers',
    )
    expect(transfers.status).toBe(200)
    expect(await transfers.json()).toMatchObject([
      {
        operation: 'import',
        row_count: 1,
        actor_credential_id: CREDENTIAL,
      },
    ])
    const recordedExport = await proxy(
      request('rpc/record_scientific_export', readToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_table_id: tableId,
          p_row_count: 1,
          p_format: 'csv+metadata',
        }),
      }),
      'rpc/record_scientific_export',
    )
    expect(recordedExport.status).toBe(200)
  })
})
