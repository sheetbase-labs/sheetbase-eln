/**
 * SCI-01 database contract proof for the distribution/grid chart types
 * (histogram, box, heatmap), type-parameter and annotation validation, and
 * freeze_chart materialisation of the aggregated series. The frozen output
 * must match the pure TypeScript materialiser in src/lib/chart-spec.ts —
 * hand-computed fixtures pin the numeric contract (quantiles use linear
 * interpolation on p·(n−1)).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, setActorJwt } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000110a'
const PROJECT_A = '00000000-0000-4000-8000-00000000111a'
const USER_A = 'sci-01-owner-a'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${USER_A}','SCI 01 A','sci-01-a@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS_A}','sci-01-a','SCI 01 A')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_A}','owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ('${PROJECT_A}','${WS_A}','sci-01-a','SCI 01 A')`,
  )
  // All fixture writes and lifecycle RPCs run with an authenticated JWT
  // bound to the workspace.
  await setActorJwt(migrator, USER_A, WS_A)
})

afterAll(async () => {
  const generated = await migrator.query<{ resource_name: string }>(
    `SELECT resource_name FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS_A],
  )
  for (const row of generated.rows) {
    if (/^sheet_[a-z2-7]{26}$/.test(row.resource_name)) {
      await migrator.query(`DROP TABLE IF EXISTS api.${row.resource_name}`)
    }
  }
  // scientific_tables rows RESTRICT block deletion; remove them first.
  await migrator.query(
    `DELETE FROM api.scientific_tables WHERE workspace_id=$1`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.blocks WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1))`,
    [WS_A],
  )
  await migrator.query(
    `DELETE FROM api.revisions WHERE record_id IN
      (SELECT id FROM api.records WHERE workspace_id IN ($1))`,
    [WS_A],
  )
  await migrator.query(`DELETE FROM api.records WHERE workspace_id=$1`, [WS_A])
  await migrator.query(`DELETE FROM api.projects WHERE workspace_id=$1`, [
    WS_A,
  ])
  await migrator.query(`DELETE FROM api.workspaces WHERE id=$1`, [WS_A])
  await migrator.query(`DELETE FROM internal."user" WHERE id=$1`, [USER_A])
  await migrator.end()
})

// Fixture state shared by the tests.
let experimentId = ''
let tableId = ''
let resourceName = ''
const cols: Record<string, { id: string; field_name: string }> = {}

function chartPayload(
  overrides: Record<string, unknown>,
  specOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: 'Distribution check',
    provenance: 'Test lab',
    frozen: null,
    ...overrides,
    spec: {
      specVersion: 1,
      datasets: [{ tableId }],
      filters: [],
      transformations: [],
      display: {
        axes: {
          x: { label: 'Time (h)', scale: 'linear' },
          y: { label: 'Recovery (%)', scale: 'linear' },
        },
        series: [],
        legend: { visible: true },
      },
      overlays: { errorBars: null },
      fields: {},
      ...specOverrides,
    },
  }
}

describe('SCI-01 distribution chart types', () => {
  beforeAll(async () => {
    // Experiment record.
    const rec = await migrator.query(
      `SELECT * FROM api.create_record(
         $1::uuid,'experiment','Chart types','draft',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT_A],
    )
    experimentId = rec.rows[0].id

    // Sheet block + scientific table with Time/Recovery/Condition columns.
    const sheet = await migrator.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'sheet','{}'::jsonb,1,$2) RETURNING id`,
      [experimentId, USER_A],
    )
    // The legacy create_scientific_table RPC is removed; build the fixture
    // dataset directly (table + generated resource + columns), mirroring the
    // shape the original DATA-002 migration created.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
    const suffix = Array.from(
      { length: 26 },
      () => alphabet[Math.floor(Math.random() * 32)],
    ).join('')
    resourceName = `sheet_${suffix}`
    await migrator.query(
      `CREATE TABLE api.${resourceName} (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         workspace_id uuid NOT NULL,
         version bigint NOT NULL DEFAULT 1,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now(),
         formula_column_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
         created_by_user_id text,
         updated_by_user_id text
       )`,
    )
    const tableRes = await migrator.query(
      `INSERT INTO api.scientific_tables(workspace_id,record_id,block_id,resource_name,name,created_by_user_id)
       VALUES ($1,$2,$3,$4,'Distribution readings',$5) RETURNING id`,
      [WS_A, experimentId, sheet.rows[0].id, resourceName, USER_A],
    )
    tableId = tableRes.rows[0].id
    const columnDefs = [
      { label: 'Time', logical_type: 'decimal', unit: { code: 'h', symbol: 'h' } },
      { label: 'Recovery', logical_type: 'decimal', unit: { code: '%', symbol: '%' } },
      { label: 'Condition', logical_type: 'text' },
    ]
    for (const [index, column] of columnDefs.entries()) {
      const fieldSuffix = Array.from(
        { length: 26 },
        () => alphabet[Math.floor(Math.random() * 32)],
      ).join('')
      const fieldName = `col_${fieldSuffix}`
      // The physical column must exist before the metadata row: the deferred
      // scientific_column_regrant trigger grants column privileges on the
      // generated relation the moment the metadata row commits.
      await migrator.query(
        `ALTER TABLE api.${resourceName} ADD COLUMN "${fieldName}" ${column.logical_type === 'text' ? 'text' : 'decimal'}`,
      )
      const colRes = await migrator.query(
        `INSERT INTO api.scientific_columns(table_id,workspace_id,field_name,label,display_order,logical_type,unit,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          tableId,
          WS_A,
          fieldName,
          column.label,
          index + 1,
          column.logical_type,
          JSON.stringify(column.unit),
          USER_A,
        ],
      )
      cols[column.label] = {
        id: colRes.rows[0].id,
        field_name: fieldName,
      }
    }

    // Rows: two conditions × four time points.
    const rows: Array<[number, number, string]> = [
      [0, 100, '4C'],
      [24, 97, '4C'],
      [48, 95, '4C'],
      [72, 93, '4C'],
      [0, 88, '20C'],
      [24, 84, '20C'],
      [48, 80, '20C'],
      [72, 70, '20C'],
    ]
    for (const [time, recovery, condition] of rows) {
      await migrator.query(
        `INSERT INTO api.${resourceName}(workspace_id,"${cols['Time'].field_name}","${cols['Recovery'].field_name}","${cols['Condition'].field_name}")
         VALUES ($1,$2,$3,$4)`,
        [WS_A, time, recovery, condition],
      )
    }

    // JWT context is already bound; nothing further needed here.
  })

  function binding(label: string) {
    return { columnId: cols[label].id, fieldName: cols[label].field_name }
  }

  let blockOrder = 1
  async function insertChart(payload: unknown) {
    blockOrder += 1
    const { rows } = await migrator.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'chart',$2::jsonb,$3,$4) RETURNING *`,
      [experimentId, JSON.stringify(payload), blockOrder * 0.001, USER_A],
    )
    return rows[0]
  }

  it('accepts histogram/box/heatmap specs and enforces per-type rules', async () => {
    const histogram = await insertChart(
      chartPayload({}, {
        type: 'histogram',
        fields: { y: binding('Recovery'), x: null, series: binding('Condition'), color: null, size: null, facet: null },
        typeParams: { histogram: { bins: 3 } },
      }),
    )
    expect(histogram.id).toBeTruthy()

    // Histograms must not carry an x mapping.
    await expect(
      insertChart(chartPayload({}, {
        type: 'histogram',
        fields: { y: binding('Recovery'), x: binding('Time'), series: null, color: null, size: null, facet: null },
        typeParams: {},
      })),
    ).rejects.toMatchObject({ code: '23514' })

    // Heatmaps reject series grouping but need both dimensions.
    await expect(
      insertChart(chartPayload({}, {
        type: 'heatmap',
        fields: { x: binding('Condition'), y: binding('Time'), series: binding('Condition'), color: null, size: null, facet: null },
        typeParams: { heatmap: { aggregate: 'count', valueField: null } },
      })),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      insertChart(chartPayload({}, {
        type: 'heatmap',
        fields: { x: null, y: binding('Time'), series: null, color: null, size: null, facet: null },
        typeParams: { heatmap: { aggregate: 'count', valueField: null } },
      })),
    ).rejects.toMatchObject({ code: '23514' })

    // Bin counts are range-checked.
    await expect(
      insertChart(chartPayload({}, {
        type: 'histogram',
        fields: { y: binding('Recovery'), x: null, series: null, color: null, size: null, facet: null },
        typeParams: { histogram: { bins: 500 } },
      })),
    ).rejects.toMatchObject({ code: '23514' })

    // Annotations are Cartesian-only.
    await expect(
      insertChart(chartPayload({}, {
        type: 'box',
        fields: { y: binding('Recovery'), x: null, series: binding('Condition'), color: null, size: null, facet: null },
        typeParams: { box: {} },
        display: {
          axes: {
            x: { label: 'Group', scale: 'linear' },
            y: { label: 'Recovery (%)', scale: 'linear' },
          },
          series: [],
          legend: { visible: true },
          annotations: [{ x: 1, y: 96, label: 'target' }],
        },
      })),
    ).rejects.toMatchObject({ code: '23514' })

    // …and accepted on line charts.
    const line = await insertChart(chartPayload({}, {
      type: 'line',
      fields: { x: binding('Time'), y: binding('Recovery'), series: null, color: null, size: null, facet: null },
      typeParams: {},
      display: {
        axes: {
          x: { label: 'Time (h)', scale: 'linear' },
          y: { label: 'Recovery (%)', scale: 'linear' },
        },
        series: [],
        legend: { visible: true },
        annotations: [{ x: 24, y: 90, label: 'midpoint' }],
      },
    }))
    expect(line.id).toBeTruthy()
  })

  it('freezes a histogram into binned counts with shared edges', async () => {
    const block = await insertChart(chartPayload({}, {
      type: 'histogram',
      fields: { y: binding('Recovery'), x: null, series: binding('Condition'), color: null, size: null, facet: null },
      typeParams: { histogram: { bins: 3 } },
    }))
    const res = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [block.id, block.version],
    )
    const frozen = res.rows[0].payload.frozen
    expect(frozen).toBeTruthy()
    // Shared edges over [70,100] with 3 bins: 70/80/90/100.
    expect(frozen.data.bins.edges.map((e: number) => Math.round(e))).toEqual([
      70, 80, 90, 100,
    ])
    const byKey = Object.fromEntries(
      frozen.data.series.map((s: any) => [s.identifier, s.points]),
    )
    // 4C values [93,95,97,100]: bin(93)=2, bin(97)=2, bin(95)=2, bin(100)=clamped to 2.
    expect(byKey['4C'].map((p: any) => p.y)).toEqual([0, 0, 4])
    // 20C values [88,84,80,70]: bin(88)=1, bin(84)=1, bin(80)=1, bin(70)=0.
    expect(byKey['20C'].map((p: any) => p.y)).toEqual([1, 3, 0])
  })

  it('freezes a box plot into Tukey summaries matching hand-computed stats', async () => {
    const block = await insertChart(chartPayload({}, {
      type: 'box',
      fields: { y: binding('Recovery'), x: null, series: binding('Condition'), color: null, size: null, facet: null },
      typeParams: { box: { showOutliers: true } },
    }))
    const res = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [block.id, block.version],
    )
    const frozen = res.rows[0].payload.frozen
    const byKey = Object.fromEntries(
      frozen.data.series.map((s: any) => [s.identifier, s.points[0].box]),
    )
    // sorted [93,95,97,100]: q1=94.5 median=96 q3=97.75 fences hold → lo 93 hi 100.
    expect(byKey['4C']).toMatchObject({ lo: 93, q1: 94.5, median: 96, q3: 97.75, hi: 100, n: 4 })
    expect(byKey['4C'].outliers).toEqual([])
    // sorted [70,80,84,88]: q1=77.5 median=82 q3=85 → lo 70 hi 88.
    expect(byKey['20C']).toMatchObject({ lo: 70, q1: 77.5, median: 82, q3: 85, hi: 88, n: 4 })
  })

  it('freezes a heatmap into an aggregated count grid', async () => {
    const block = await insertChart(chartPayload({}, {
      type: 'heatmap',
      fields: { x: binding('Condition'), y: binding('Time'), series: null, color: null, size: null, facet: null },
      typeParams: { heatmap: { aggregate: 'count', valueField: null, xBins: 4, yBins: 2 } },
    }))
    const res = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [block.id, block.version],
    )
    const frozen = res.rows[0].payload.frozen
    const heat = frozen.data.heatmap
    expect(heat.xLabels).toEqual(['20C', '4C'])
    expect(heat.aggregate).toBe('count')
    // Time 0–72 binned into 2: each condition contributes one row per bin.
    for (const cell of heat.cells) {
      if (cell.value !== null) expect(cell.value).toBe(2)
    }
    expect(heat.min).toBe(2)
    expect(heat.max).toBe(2)
  })

  it('refuses to freeze faceted charts and keeps frozen payloads immutable', async () => {
    const faceted = await insertChart(chartPayload({}, {
      type: 'line',
      fields: { x: binding('Time'), y: binding('Recovery'), series: null, color: null, size: null, facet: binding('Condition') },
      typeParams: {},
    }))
    await expect(
      migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
        faceted.id,
        faceted.version,
      ]),
    ).rejects.toThrow(/faceted charts cannot be frozen/)

    // Frozen payload immutability still holds for new types.
    const block = await insertChart(chartPayload({}, {
      type: 'box',
      fields: { y: binding('Recovery'), x: null, series: binding('Condition'), color: null, size: null, facet: null },
      typeParams: { box: {} },
    }))
    const res = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [block.id, block.version],
    )
    const frozenBlock = res.rows[0]
    await expect(
      migrator.query(
        `UPDATE api.blocks SET payload=$2::jsonb WHERE id=$1`,
        [frozenBlock.id, JSON.stringify({ ...frozenBlock.payload, title: 'Tampered' })],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
