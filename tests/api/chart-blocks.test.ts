/**
 * SCI-004 API contract proof. Chart block CRUD, the freeze/unfreeze/bind
 * lifecycle, dataset reference integrity, stale-calculation guards and
 * durable-event parity all travel through the same-origin /api/db PostgREST
 * proxy to a running PostgREST instance. The admin connection is used only for
 * fixture setup, cleanup and change-event verification.
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handleProxyRequest } from '#/lib/postgrest-proxy'
import { mintPostgrestToken } from '#/lib/postgrest-token'

config({ path: ['.env.local', '.env'] })

const WS_A = '6c000000-0000-4000-8000-000000000001'
const WS_B = '6c000000-0000-4000-8000-000000000002'
const PROJECT_A = '6c000000-0000-4000-8000-000000000003'
const PROJECT_B = '6c000000-0000-4000-8000-000000000004'
const USER_A = 'sci-004-api-owner-a'
const USER_B = 'sci-004-api-owner-b'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client

async function clean(): Promise<void> {
  // Drop generated scientific tables in these workspaces before removing the
  // blocks they reference (scientific_tables.block_id is ON DELETE RESTRICT).
  const generated = await admin.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await admin.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  await admin.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.record_links WHERE source_record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1,$2))`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.records WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM api.projects WHERE workspace_id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(
    `DELETE FROM api.workspace_memberships WHERE workspace_id IN ($1,$2)`,
    [WS_A, WS_B],
  )
  await admin.query(`DELETE FROM api.workspaces WHERE id IN ($1,$2)`, [
    WS_A,
    WS_B,
  ])
  await admin.query(`DELETE FROM internal."user" WHERE id IN ($1,$2)`, [
    USER_A,
    USER_B,
  ])
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
}

function proxy(
  path: string,
  userId: string,
  workspaceId: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  return handleProxyRequest(
    new Request(`http://sheetbase.test/api/db/${path}`, { ...init, headers }),
    path.split('?')[0],
    {
      getSession: async () => ({
        user: { id: userId },
        session: { id: 'sci-004-api-session' },
      }),
      getWorkspaceForUser: async () => ({ id: workspaceId }),
      mintToken: (input) => mintPostgrestToken(SECRET, input),
      resolveExternalToken: () => Promise.resolve(null),
      upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
    },
  )
}

async function rpc(
  path: string,
  user: string,
  workspace: string,
  body: unknown,
): Promise<Response> {
  return proxy(`rpc/${path}`, user, workspace, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createRecord(
  user: string,
  workspace: string,
  project: string,
  kind: string,
  title: string,
) {
  const response = await rpc('create_record', user, workspace, {
    p_project_id: project,
    p_kind: kind,
    p_title: title,
    p_status: 'draft',
    p_properties: {},
  })
  expect(response.status).toBe(200)
  return response.json()
}

async function insertBlock(
  user: string,
  workspace: string,
  record: { id: string; structure_version: number },
  type: string,
  payload: unknown,
) {
  const response = await rpc('insert_block', user, workspace, {
    p_record_id: record.id,
    p_type: type,
    p_payload: payload,
    p_payload_schema_version: 1,
    p_expected_structure_version: record.structure_version,
  })
  return response
}

function baseSpec(
  tableId: string,
  cols: Record<string, { id: string; field_name: string }>,
) {
  return {
    specVersion: 1,
    type: 'line' as const,
    datasets: [{ tableId }],
    fields: {
      x: { columnId: cols.x.id, fieldName: cols.x.field_name },
      y: { columnId: cols.y.id, fieldName: cols.y.field_name },
      series: { columnId: cols.series.id, fieldName: cols.series.field_name },
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: 'Time', scale: 'linear' as const, unit: 'h' },
        y: { label: 'Recovery', scale: 'linear' as const, unit: '%' },
      },
      series: [
        { identifier: '4C', label: '4 °C', color: '#006EDC' },
        { identifier: '20C', label: '20 °C', color: '#00A659' },
      ],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
}

function chartPayload(
  tableId: string,
  cols: Record<string, { id: string; field_name: string }>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: 'Stability curve',
    spec: baseSpec(tableId, cols),
    frozen: null,
    ...overrides,
  }
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.DATABASE_URL })
  await admin.connect()
  await clean()
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ($1,'SCI 004 API A','sci-004-api-a@test.invalid',true),
      ($2,'SCI 004 API B','sci-004-api-b@test.invalid',true)`,
    [USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ($1,'sci-004-api-a','SCI 004 API A'),($2,'sci-004-api-b','SCI 004 API B')`,
    [WS_A, WS_B],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, USER_A, USER_B],
  )
  await admin.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
      ($1,$2,'sci004api','SCI 004 API A'),($3,$4,'sci004b','SCI 004 API B')`,
    [PROJECT_A, WS_A, PROJECT_B, WS_B],
  )
})

afterAll(async () => {
  if (admin) {
    await clean()
    await admin.end()
  }
})

describe('SCI-004 chart blocks REST contract', () => {
  let experiment: { id: string; structure_version: number }
  let table: { id: string; resource_name: string }
  let cols: Record<string, { id: string; field_name: string }>
  let chart: { id: string; version: number; payload: Record<string, unknown> }

  async function buildDataset(
    user: string,
    workspace: string,
    recordId: string,
    structureVersion: number,
  ): Promise<number> {
    // Sheet block via insert_block, then a scientific table via the same RPC
    // the UI uses, then realistic rows via the generated resource.
    const sheetRes = await insertBlock(
      user,
      workspace,
      { id: recordId, structure_version: structureVersion },
      'sheet',
      {},
    )
    expect(sheetRes.status).toBe(200)
    const sheetJson = await sheetRes.json()
    const sheet = sheetJson.block
    const tableRes = await rpc('create_scientific_table', user, workspace, {
      p_block_id: sheet.id,
      p_name: 'Stability readings',
      p_columns: [
        {
          label: 'Time',
          logical_type: 'decimal',
          unit: { code: 'h', symbol: 'h' },
        },
        {
          label: 'Recovery',
          logical_type: 'decimal',
          unit: { code: '%', symbol: '%' },
        },
        { label: 'Condition', logical_type: 'text' },
      ],
    })
    expect(tableRes.status).toBe(200)
    const built = await tableRes.json()
    table = built.table
    const byLabel = Object.fromEntries(
      built.columns.map((c: any) => [c.label, c]),
    )
    cols = {
      x: byLabel['Time'],
      y: byLabel['Recovery'],
      series: byLabel['Condition'],
    }
    const rows = [
      [0, 100, '4C'],
      [24, 97, '4C'],
      [0, 100, '20C'],
      [24, 88, '20C'],
    ] as const
    for (const [t, recovery, condition] of rows) {
      const rowRes = await proxy(table.resource_name, user, workspace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          [cols.x.field_name]: t,
          [cols.y.field_name]: recovery,
          [cols.series.field_name]: condition,
        }),
      })
      expect(rowRes.status).toBe(201)
    }
    return sheetJson.structure_version as number
  }

  it('creates, reads and updates a chart block through the proxy', async () => {
    const rec = await createRecord(
      USER_A,
      WS_A,
      PROJECT_A,
      'experiment',
      'Stability API',
    )
    experiment = rec
    experiment.structure_version = await buildDataset(
      USER_A,
      WS_A,
      rec.id,
      rec.structure_version,
    )
    const insertRes = await insertBlock(
      USER_A,
      WS_A,
      rec,
      'chart',
      chartPayload(table.id, cols),
    )
    expect(insertRes.status).toBe(200)
    chart = (await insertRes.json()).block

    const read = await proxy(
      `blocks?id=eq.${chart.id}&select=id,type,payload`,
      USER_A,
      WS_A,
    )
    expect(read.status).toBe(200)
    const rows = await read.json()
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('chart')
    expect(rows[0].payload.title).toBe('Stability curve')

    // Update the title through update_block_payload (ordinary CRUD RPC).
    const updateRes = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: chart.id,
      p_payload: chartPayload(table.id, cols, { title: 'Renamed curve' }),
      p_expected_version: chart.version,
      p_payload_schema_version: 1,
    })
    expect(updateRes.status).toBe(200)
    chart = await updateRes.json()
    expect(chart.payload.title).toBe('Renamed curve')
  })

  it('rejects an invalid chart spec at the proxy boundary', async () => {
    const badRes = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: chart.id,
      p_payload: chartPayload(table.id, cols, {
        title: 'Bad',
        spec: { ...baseSpec(table.id, cols), type: 'pie' as unknown as string },
      }),
      p_expected_version: chart.version,
      p_payload_schema_version: 1,
    })
    expect(badRes.status).toBeGreaterThanOrEqual(400)
    const body = await badRes.json()
    expect(body.error || body.message || body.code).toBeTruthy()
  })

  it('rejects a cross-workspace dataset reference', async () => {
    // Build a dataset in workspace B and try to reference it from a chart in A.
    const recB = await createRecord(
      USER_B,
      WS_B,
      PROJECT_B,
      'experiment',
      'WS B data',
    )
    const sheetRes = await insertBlock(USER_B, WS_B, recB, 'sheet', {})
    const sheet = (await sheetRes.json()).block
    const tableRes = await rpc('create_scientific_table', USER_B, WS_B, {
      p_block_id: sheet.id,
      p_name: 'WS B readings',
      p_columns: [
        {
          label: 'Time',
          logical_type: 'decimal',
          unit: { code: 'h', symbol: 'h' },
        },
        {
          label: 'Recovery',
          logical_type: 'decimal',
          unit: { code: '%', symbol: '%' },
        },
        { label: 'Condition', logical_type: 'text' },
      ],
    })
    const builtB = await tableRes.json()
    const colsB = {
      x: builtB.columns[0],
      y: builtB.columns[1],
      series: builtB.columns[2],
    }
    const crossRes = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: chart.id,
      p_payload: chartPayload(builtB.table.id, colsB, { title: 'Cross-ws' }),
      p_expected_version: chart.version,
      p_payload_schema_version: 1,
    })
    expect(crossRes.status).toBeGreaterThanOrEqual(400)
  })

  it('freezes a chart through the transactional RPC and pins provenance', async () => {
    const freezeRes = await rpc('freeze_chart', USER_A, WS_A, {
      p_block_id: chart.id,
      p_expected_version: chart.version,
    })
    expect(freezeRes.status).toBe(200)
    chart = await freezeRes.json()
    expect(chart.payload.frozen).toBeTruthy()
    expect(chart.payload.frozen.frozenByUserId).toBe(USER_A)
    expect(chart.payload.frozen.datasetProvenance[0].tableId).toBe(table.id)
    expect(chart.payload.frozen.data.series.length).toBeGreaterThan(0)
  })

  it('guards freeze with a stale version (stale-calculation) error', async () => {
    const staleRes = await rpc('freeze_chart', USER_A, WS_A, {
      p_block_id: chart.id,
      p_expected_version: chart.version - 1,
    })
    expect(staleRes.status).toBeGreaterThanOrEqual(400)
    const body = await staleRes.json()
    // The proxy maps SB001 (PostgREST PG-protocol hint) to the stable
    // `stale_version` category; assert the surfaced category instead of the
    // internal code so the contract survives PostgREST hint formatting.
    expect(body.error.category).toBe('stale_version')
  })

  it('makes a frozen chart immutable to ordinary payload updates', async () => {
    const mutateRes = await rpc('update_block_payload', USER_A, WS_A, {
      p_block_id: chart.id,
      p_payload: chartPayload(table.id, cols, {
        title: 'Mutated after freeze',
        frozen: chart.payload.frozen,
      }),
      p_expected_version: chart.version,
      p_payload_schema_version: 1,
    })
    expect(mutateRes.status).toBeGreaterThanOrEqual(400)
  })

  it('binds a frozen chart to a same-record revision and then rejects unfreeze', async () => {
    const revRes = await proxy('revisions', USER_A, WS_A, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        record_id: experiment.id,
        structure_version: experiment.structure_version,
        metadata_version: 1,
        metadata_snapshot: { title: 'Submit run' },
        block_snapshot: [],
        reason: 'submit',
        created_by_user_id: USER_A,
      }),
    })
    expect(revRes.status).toBe(201)
    const rev = (await revRes.json())[0]

    const bindRes = await rpc('bind_chart_revision', USER_A, WS_A, {
      p_block_id: chart.id,
      p_revision_id: rev.id,
      p_expected_version: chart.version,
    })
    expect(bindRes.status).toBe(200)
    chart = await bindRes.json()
    expect(chart.payload.frozen.revisionId).toBe(rev.id)

    const unbindRes = await rpc('unfreeze_chart', USER_A, WS_A, {
      p_block_id: chart.id,
      p_expected_version: chart.version,
    })
    expect(unbindRes.status).toBeGreaterThanOrEqual(400)
  })

  it('emits durable block.update change events with actor attribution', async () => {
    const { rows } = await admin.query(
      `SELECT operation,actor_user_id FROM api.change_events
       WHERE record_id=$1 AND entity_type='block' ORDER BY sequence DESC LIMIT 20`,
      [experiment.id],
    )
    expect(
      rows.some(
        (e: any) => e.operation === 'update' && e.actor_user_id === USER_A,
      ),
    ).toBe(true)
  })

  it('rejects a cross-workspace reader at the blocks boundary', async () => {
    const read = await proxy(`blocks?id=eq.${chart.id}`, USER_B, WS_B)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual([])
  })

  it('rejects an unauthenticated REST request at the proxy boundary', async () => {
    const response = await handleProxyRequest(
      new Request('http://sheetbase.test/api/db/blocks'),
      'blocks',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: (input) => mintPostgrestToken(SECRET, input),
        upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
      },
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error.category).toBe('unauthenticated')
  })
})
