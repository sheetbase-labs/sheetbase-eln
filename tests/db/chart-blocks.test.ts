/**
 * SCI-004 database contract proof: chart block payload validation, dataset
 * reference integrity, frozen-chart immutability, the freeze/unfreeze
 * lifecycle RPCs, actor attribution, durable change events, and isolation
 * from the existing protocol/material/file scientific blocks.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000040a'
const WS_B = '00000000-0000-4000-8000-00000000040b'
const PROJECT_A = '00000000-0000-4000-8000-00000000041a'
const PROJECT_B = '00000000-0000-4000-8000-00000000041b'
const USER_A = 'sci-004-owner-a'
const USER_B = 'sci-004-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function authenticated(user: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
      session_id: `session-${user}`,
    }),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid,$2,$3,$4,ARRAY[]::text[],'{}'::jsonb)`,
    [project, kind, title, 'draft'],
  )
  return rows[0]
}

async function createSheetBlock(
  client: Client,
  recordId: string,
  order: number,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES($1,'sheet','{}'::jsonb,$2,$3) RETURNING *`,
    [recordId, order, USER_A],
  )
  return rows[0]
}

async function createScientificTable(
  user: string,
  workspace: string,
  sheetBlockId: string,
  name: string,
  specs: unknown[],
): Promise<{ table: Record<string, any>; columns: Record<string, any>[] }> {
  await setActorJwt(migrator, user, workspace)
  const { rows } = await migrator.query(
    `SELECT api.create_scientific_table($1,$2,$3::jsonb) result`,
    [sheetBlockId, name, JSON.stringify(specs)],
  )
  return rows[0].result
}

async function insertBlock(
  client: Client,
  recordId: string,
  type: string,
  payload: unknown,
  order: number,
  userId = USER_A,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *`,
    [recordId, type, JSON.stringify(payload), order, userId],
  )
  return rows[0]
}

async function updateBlock(
  client: Client,
  blockId: string,
  payload: unknown,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `UPDATE api.blocks SET payload=$2::jsonb,version=version+1 WHERE id=$1 RETURNING *`,
    [blockId, JSON.stringify(payload)],
  )
  return rows[0]
}

function baseSpec(tableId: string, cols: Record<string, Record<string, any>>) {
  return {
    specVersion: 1,
    type: 'line' as const,
    datasets: [{ tableId }],
    fields: {
      x: { columnId: cols.x.id, fieldName: cols.x.field_name },
      y: { columnId: cols.y.id, fieldName: cols.y.field_name },
      series: cols.series.id
        ? { columnId: cols.series.id, fieldName: cols.series.field_name }
        : null,
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: 'Time', scale: 'linear', unit: 'h' },
        y: { label: 'Recovery', scale: 'linear', unit: '%' },
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
  cols: Record<string, Record<string, any>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    title: 'Stability curve',
    spec: baseSpec(tableId, cols),
    frozen: null,
  }
  return { ...base, ...overrides } as Record<string, unknown>
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
    ('${USER_A}','SCI 004 A','sci-004-a@sheetbase.test',true),
    ('${USER_B}','SCI 004 B','sci-004-b@sheetbase.test',true)`)
  await migrator.query(`INSERT INTO api.workspaces(id,slug,name) VALUES
    ('${WS_A}','sci-004-a','SCI 004 A'),('${WS_B}','sci-004-b','SCI 004 B')`)
  await migrator.query(`INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
    ('${WS_A}','${USER_A}','owner'),('${WS_B}','${USER_B}','owner')`)
  await migrator.query(`INSERT INTO api.projects(id,workspace_id,key,title) VALUES
    ('${PROJECT_A}','${WS_A}','sci-004-a','SCI 004 A'),
    ('${PROJECT_B}','${WS_B}','sci-004-b','SCI 004 B')`)
})

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()))
  await migrator.end()
})

describe('SCI-004 chart blocks', () => {
  let a: Client
  let b: Client
  let experimentA: Record<string, any>
  let tableA: Record<string, any>
  let colsA: Record<string, Record<string, any>>
  let tableB: Record<string, any>

  beforeAll(async () => {
    a = await authenticated(USER_A, WS_A)
    b = await authenticated(USER_B, WS_B)
    experimentA = await createRecord(
      a,
      PROJECT_A,
      'experiment',
      'Virus stability',
    )
    const experimentB = await createRecord(
      b,
      PROJECT_B,
      'experiment',
      'Other run',
    )

    const sheetA = await createSheetBlock(a, experimentA.id, 1)
    const builtA = await createScientificTable(
      USER_A,
      WS_A,
      sheetA.id,
      'Stability readings',
      [
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
        {
          label: 'Recovery SD',
          logical_type: 'decimal',
          unit: { code: '%', symbol: '%' },
        },
      ],
    )
    tableA = builtA.table
    colsA = {
      x: builtA.columns[0],
      y: builtA.columns[1],
      series: builtA.columns[2],
      err: builtA.columns[3],
    }
    const f = Object.fromEntries(
      builtA.columns.map((c) => [c.label, c.field_name]),
    )
    await a.query(
      `INSERT INTO api."${tableA.resource_name}"
         ("${f['Time']}","${f['Recovery']}","${f['Condition']}","${f['Recovery SD']}") VALUES
       (0, 100, '4C', 1.0),(24, 98, '4C', 1.1),(48, 95, '4C', 1.4),
       (0, 100, '20C', 1.0),(24, 90, '20C', 1.2),(48, 82, '20C', 1.5)`,
    )

    const sheetB = await createSheetBlock(b, experimentB.id, 1)
    const builtB = await createScientificTable(
      USER_B,
      WS_B,
      sheetB.id,
      'Other readings',
      [
      { label: 'Time', logical_type: 'decimal' },
      { label: 'Recovery', logical_type: 'decimal' },
    ])
    tableB = builtB.table
  })

  it('accepts a draft empty chart block and a populated chart spec', async () => {
    const draft = await insertBlock(a, experimentA.id, 'chart', {}, 2)
    expect(draft.type).toBe('chart')
    const populated = await updateBlock(
      a,
      draft.id,
      chartPayload(tableA.id, colsA),
    )
    expect(populated.payload.spec.type).toBe('line')
  })

  it('rejects a chart payload missing a title', async () => {
    await expect(
      insertBlock(
        a,
        experimentA.id,
        'chart',
        chartPayload(tableA.id, colsA, { title: ' ' }),
        3,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects an unsupported chart type', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = { ...payload.spec, type: 'pie' }
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a chart with no datasets', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = { ...payload.spec, datasets: [] }
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a chart with a missing fields.y binding', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = {
      ...payload.spec,
      fields: { ...payload.spec.fields, y: null },
    }
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a series colour outside the approved palette', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = {
      ...payload.spec,
      display: {
        ...payload.spec.display,
        series: [{ identifier: '4C', label: '4 °C', color: '#FF00FF' }],
      },
    }
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a dataset reference in another workspace', async () => {
    await expect(
      insertBlock(
        a,
        experimentA.id,
        'chart',
        chartPayload(tableB.id, colsA),
        3,
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects an unknown dataset UUID', async () => {
    const payload = chartPayload('00000000-0000-4000-8000-0000000000ff', colsA)
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('is invisible from another workspace', async () => {
    const chart = await insertBlock(
      a,
      experimentA.id,
      'chart',
      chartPayload(tableA.id, colsA),
      4,
    )
    const { rows } = await b.query('SELECT id FROM api.blocks WHERE id=$1', [
      chart.id,
    ])
    expect(rows).toHaveLength(0)
  })

  it('supports a scatter chart with x optional and an error-bar overlay', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = {
      ...payload.spec,
      type: 'scatter',
      fields: { ...payload.spec.fields, x: null },
      overlays: {
        errorBars: {
          columnId: colsA.err.id,
          fieldName: colsA.err.field_name,
          basis: 'sd',
          multiplier: 1,
        },
      },
    }
    const block = await insertBlock(a, experimentA.id, 'chart', payload, 5)
    expect(block.payload.spec.type).toBe('scatter')
    expect(block.payload.spec.overlays.errorBars.basis).toBe('sd')
  })

  it('rejects an invalid error-bar overlay', async () => {
    const payload = chartPayload(tableA.id, colsA)
    payload.spec = {
      ...payload.spec,
      overlays: {
        errorBars: {
          columnId: colsA.err.id,
          fieldName: colsA.err.field_name,
          basis: 'quantile',
        },
      },
    }
    await expect(
      insertBlock(a, experimentA.id, 'chart', payload, 3),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('SCI-004 chart freeze lifecycle', () => {
  let a: Client
  let experiment: Record<string, any>
  let table: Record<string, any>
  let cols: Record<string, Record<string, any>>
  let chart: Record<string, any>

  beforeAll(async () => {
    a = await authenticated(USER_A, WS_A)
    experiment = await createRecord(
      a,
      PROJECT_A,
      'experiment',
      'Freeze lifecycle',
    )
    const sheet = await createSheetBlock(a, experiment.id, 1)
    const built = await createScientificTable(
      USER_A,
      WS_A,
      sheet.id,
      'Freeze readings',
      [
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
    ])
    table = built.table
    cols = {
      x: built.columns[0],
      y: built.columns[1],
      series: built.columns[2],
    }
    const f = Object.fromEntries(
      built.columns.map((c) => [c.label, c.field_name]),
    )
    await a.query(
      `INSERT INTO api."${table.resource_name}"
         ("${f['Time']}","${f['Recovery']}","${f['Condition']}") VALUES
       (0, 100, '4C'),(24, 97, '4C'),(0, 100, '20C'),(24, 88, '20C')`,
    )
    chart = await insertBlock(
      a,
      experiment.id,
      'chart',
      chartPayload(table.id, cols),
      2,
    )
  })

  it('materialises the dataset and pins provenance on freeze', async () => {
    const { rows } = await a.query('SELECT * FROM api.freeze_chart($1,$2)', [
      chart.id,
      chart.version,
    ])
    const frozen = rows[0]
    expect(frozen.payload.frozen).toBeTruthy()
    expect(frozen.payload.frozen.frozenByUserId).toBe(USER_A)
    expect(frozen.payload.frozen.revisionId).toBeNull()
    expect(frozen.payload.frozen.data.series.length).toBeGreaterThan(0)
    expect(frozen.payload.frozen.datasetProvenance[0].tableId).toBe(table.id)
    expect(frozen.payload.frozen.datasetProvenance[0].rowCount).toBe(4)
    expect(frozen.payload.frozen.datasetProvenance[0].checksum).toMatch(
      /^[0-9a-f]{32}$/,
    )
    chart = frozen
  })

  it('emits a durable block.update change event with actor attribution', async () => {
    const { rows } = await a.query(
      `SELECT actor_user_id,operation FROM api.change_events
       WHERE record_id=$1 AND entity_type='block' ORDER BY sequence DESC LIMIT 3`,
      [experiment.id],
    )
    expect(
      rows.some((r) => r.operation === 'update' && r.actor_user_id === USER_A),
    ).toBe(true)
  })

  it('rejects a second freeze and stale version guards', async () => {
    await expect(
      a.query('SELECT api.freeze_chart($1,$2)', [chart.id, chart.version - 1]),
    ).rejects.toMatchObject({ code: 'SB001' })
    await expect(
      a.query('SELECT api.freeze_chart($1,$2)', [chart.id, chart.version]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('makes the frozen chart spec immutable', async () => {
    const mutated = {
      ...chart.payload,
      spec: { ...chart.payload.spec, type: 'bar' },
      frozen: chart.payload.frozen,
    }
    await expect(updateBlock(a, chart.id, mutated)).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects direct CRUD fabricating a frozen payload on a live chart', async () => {
    // A live chart cannot gain a frozen object through ordinary authenticated
    // CRUD; only the SECURITY DEFINER freeze_chart RPC may materialise one.
    const live = await a.query('SELECT * FROM api.unfreeze_chart($1,$2)', [
      chart.id,
      chart.version,
    ])
    chart = live.rows[0]
    const fabricated = {
      ...chart.payload,
      frozen: {
        revisionId: null,
        frozenAt: '2026-07-21T00:00:00Z',
        frozenByUserId: USER_A,
        datasetProvenance: [],
        data: { columns: [], rows: [], series: [] },
      },
    }
    await expect(updateBlock(a, chart.id, fabricated)).rejects.toMatchObject({
      code: '42501',
    })
    // Re-freeze via the RPC so later lifecycle tests start from a frozen chart.
    const refrozen = await a.query('SELECT * FROM api.freeze_chart($1,$2)', [
      chart.id,
      chart.version,
    ])
    chart = refrozen.rows[0]
  })

  it('rejects direct CRUD unfreezing or revision-binding a frozen chart', async () => {
    // Direct CRUD cannot drop the frozen object...
    const withoutFrozen = { ...chart.payload }
    delete (withoutFrozen as Record<string, unknown>).frozen
    await expect(updateBlock(a, chart.id, withoutFrozen)).rejects.toMatchObject(
      {
        code: '42501',
      },
    )
    // ...and cannot bind an arbitrary revisionId onto the frozen object.
    const bound = {
      ...chart.payload,
      frozen: {
        ...(chart.payload.frozen as Record<string, unknown>),
        revisionId: '00000000-0000-4000-8000-000000000999',
      },
    }
    await expect(updateBlock(a, chart.id, bound)).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('unfreezes a chart not yet tied to a revision and permits edits', async () => {
    const { rows } = await a.query('SELECT * FROM api.unfreeze_chart($1,$2)', [
      chart.id,
      chart.version,
    ])
    const thawed = rows[0]
    expect(thawed.payload.frozen).toBeUndefined()
    chart = thawed
    const edited = await updateBlock(
      a,
      chart.id,
      chartPayload(table.id, cols, { title: 'Edited after thaw' }),
    )
    expect(edited.payload.title).toBe('Edited after thaw')
    chart = edited
  })

  it('rejects unfreeze once the freeze is tied to a revision', async () => {
    const frozen = await a.query('SELECT * FROM api.freeze_chart($1,$2)', [
      chart.id,
      chart.version,
    ])
    chart = frozen.rows[0]
    // Create immutable evidence through the submission contract, then bind
    // this freeze to that revision through the chart lifecycle contract.
    const preview = await a.query(
      'SELECT api.preview_submission_digest($1) result',
      [chart.record_id],
    )
    const submitted = await a.query(
      `SELECT api.submit_record_revision(
         $1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,$4
       ) result`,
      [
        chart.record_id,
        preview.rows[0].result.sourceDigest,
        USER_A,
        'chart-freeze-lifecycle',
      ],
    )
    const revId = submitted.rows[0].result.revision.id
    const bound = await a.query(
      'SELECT * FROM api.bind_chart_revision($1,$2,$3)',
      [chart.id, revId, chart.version],
    )
    chart = bound.rows[0]
    expect(chart.payload.frozen.revisionId).toBe(revId)
    await expect(
      a.query('SELECT api.unfreeze_chart($1,$2)', [chart.id, chart.version]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects freezing a chart whose dataset is empty', async () => {
    const exp2 = await createRecord(a, PROJECT_A, 'experiment', 'Empty dataset')
    const sheet = await createSheetBlock(a, exp2.id, 1)
    const built = await createScientificTable(
      USER_A,
      WS_A,
      sheet.id,
      'Empty readings',
      [
      { label: 'Time', logical_type: 'decimal' },
      { label: 'Recovery', logical_type: 'decimal' },
    ])
    const cols2 = {
      x: built.columns[0],
      y: built.columns[1],
      series: { id: '', field_name: '' },
    }
    const payload = chartPayload(built.table.id, cols2)
    payload.spec = {
      ...payload.spec,
      fields: {
        x: {
          columnId: built.columns[0].id,
          fieldName: built.columns[0].field_name,
        },
        y: {
          columnId: built.columns[1].id,
          fieldName: built.columns[1].field_name,
        },
        series: null,
        color: null,
        size: null,
      },
    }
    const block = await insertBlock(a, exp2.id, 'chart', payload, 2)
    await expect(
      a.query('SELECT api.freeze_chart($1,$2)', [block.id, block.version]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('SCI-004 chart blocks do not disturb existing scientific blocks', () => {
  it('still validates protocol reference drafts and materials payloads', async () => {
    const a = await authenticated(USER_A, WS_A)
    const experiment = await createRecord(a, PROJECT_A, 'experiment', 'Coexist')
    const draft = await insertBlock(
      a,
      experiment.id,
      'protocol_reference',
      {},
      1,
    )
    expect(draft.type).toBe('protocol_reference')
    await expect(
      insertBlock(a, experiment.id, 'materials', { items: 'not-an-array' }, 2),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
