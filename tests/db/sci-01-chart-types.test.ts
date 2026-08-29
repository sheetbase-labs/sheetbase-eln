/**
 * SCI-01 database contract proof for scientific chart blocks against
 * canonical Datasets (decisions 0037/0041): trigger validation of canonical
 * identity, server-side materialisation parity for distribution/grid charts,
 * and faceted freeze semantics. Fixtures build real Datasets with typed
 * row values keyed by stable field ids.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChartSpec, FrozenChart } from '#/lib/chart-spec'

import { prepareTestDatabase } from './helpers'
import {
  loadPinnedVersionRows,
  rematerialiseFrozenChart,
  rematerialiseFrozenFacets,
} from './sci-freeze-helpers'

const WS_A = crypto.randomUUID()
const PROJECT_A = crypto.randomUUID()
const USER_A = `sci-01-owner-${crypto.randomUUID().slice(0, 8)}`

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

let experimentId = ''
let dsIdMain = ''
let FIELD_TIME = ''
let FIELD_RECOVERY = ''
let FIELD_CONDITION = ''

interface FieldSpec {
  key: string
  label: string
  type: string
}

async function insertDataset(
  name: string,
  fields: FieldSpec[],
  rows: unknown[][],
): Promise<{ datasetId: string; fieldIds: string[] }> {
  const schemaRes = await migrator.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,$2,$3,'active') RETURNING id`,
    [
      WS_A,
      `sci01_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      name,
    ],
  )
  const svRes = await migrator.query(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schemaRes.rows[0].id],
  )
  const svId = svRes.rows[0].id
  const fieldIds: string[] = []
  for (const [index, field] of fields.entries()) {
    const res = await migrator.query(
      `INSERT INTO api.dataset_schema_version_fields
        (schema_version_id,field_id,key,label,logical_type,display_order)
       VALUES ($1,gen_random_uuid(),$2,$3,$4,$5) RETURNING field_id`,
      [svId, field.key, field.label, field.type, index + 1],
    )
    fieldIds.push(res.rows[0].field_id)
  }
  // Published-version immutability guards require fields to exist while the
  // version is still draft.
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [svId],
  )
  const dsRes = await migrator.query(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
     VALUES ($1,$2,$3) RETURNING id`,
    [WS_A, svId, name],
  )
  const dsId = dsRes.rows[0].id
  for (const row of rows) {
    const rowRes = await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [dsId, WS_A],
    )
    const rowId = rowRes.rows[0].id
    for (const [index, value] of row.entries()) {
      if (fields[index].type === 'decimal') {
        await migrator.query(
          `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
           VALUES ($1,$2,$3)`,
          [rowId, fieldIds[index], value],
        )
      } else {
        await migrator.query(
          `INSERT INTO api.dataset_row_values(row_id,field_id,text_value)
           VALUES ($1,$2,$3)`,
          [rowId, fieldIds[index], String(value)],
        )
      }
    }
  }
  return { datasetId: dsId, fieldIds }
}

function specFor(datasetId: string, overrides: Record<string, unknown>) {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId }],
    fields: {
      x: { fieldId: FIELD_TIME },
      y: { fieldId: FIELD_RECOVERY },
      series: null,
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
      series: [],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

let blockOrder = 0

async function insertChartBlock(spec: unknown) {
  const res = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'chart',$2::jsonb,$4,$3) RETURNING *`,
    [experimentId, JSON.stringify({ title: 'T', spec, frozen: null }), USER_A, ++blockOrder],
  )
  return res.rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
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
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER_A, workspace_id: WS_A }),
  ])
  const rec = await migrator.query(
    `SELECT * FROM api.create_record(
       $1::uuid,'experiment','Chart types','draft',ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT_A],
  )
  experimentId = rec.rows[0].id

  const ds = await insertDataset(
    'assay',
    [
      { key: 'time', label: 'Time', type: 'decimal' },
      { key: 'recovery', label: 'Recovery', type: 'decimal' },
      { key: 'condition', label: 'Condition', type: 'text' },
    ],
    [
      [0, 1, 'A'],
      [24, 3, 'A'],
      [48, 5, 'A'],
      [0, 2, 'B'],
      [24, 4, 'B'],
    ],
  )
  dsIdMain = ds.datasetId
  ;[FIELD_TIME, FIELD_RECOVERY, FIELD_CONDITION] = ds.fieldIds
})

afterAll(async () => {
  await migrator.query(`DELETE FROM api.analysis_definitions WHERE workspace_id=$1`, [WS_A])
  await migrator.query(`DELETE FROM api.records WHERE project_id=$1`, [PROJECT_A])
  await migrator.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT_A])
  // freeze_chart now pins a Dataset Version that references the creating
  // user; those versions are immutable evidence so the owner is left in place.
  for (const client of clients) await client.end()
})

describe('SCI-01 chart blocks on canonical Datasets', () => {
  it('freezes a line chart into fieldId-keyed evidence with canonical provenance', async () => {
    const block = await insertChartBlock(specFor(dsIdMain, {}))
    const res = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = res.rows[0].payload.frozen as FrozenChart
    expect(frozen).toBeTruthy()

    const prov = frozen.datasetProvenance[0]
    expect(prov.datasetId).toBe(dsIdMain)
    expect(prov.schemaVersionNumber).toBe(1)
    expect(prov.rowCount).toBe(5)
    expect(prov.checksum).toMatch(/^[0-9a-f]{32}$/)

    const columns = frozen.data.columns
    expect(columns.map((c: { fieldId: string }) => c.fieldId)).toEqual(
      expect.arrayContaining([FIELD_TIME, FIELD_RECOVERY]),
    )

    expect(frozen.data.series).toEqual([])
    expect(frozen.data.facets).toBeUndefined()
    const rows = await loadPinnedVersionRows(
      migrator,
      frozen.datasetProvenance[0].datasetVersionId!,
    )
    const chart = rematerialiseFrozenChart(
      specFor(dsIdMain, {}) as ChartSpec,
      frozen,
      rows,
    )
    expect(chart.series).toHaveLength(1)
    const points = chart.series[0].points
    expect(points.map((p) => p.x)).toEqual([0, 24, 48, 0, 24])
    expect(points.map((p) => p.y)).toEqual([1, 3, 5, 2, 4])
    expect(res.rows[0].version).toBe(block.version + 1)
  })

  it('refuses freezing against an empty dataset', async () => {
    const empty = await insertDataset(
      'empty_assay',
      [
        { key: 'x', label: 'X', type: 'decimal' },
        { key: 'y', label: 'Y', type: 'decimal' },
      ],
      [],
    )
    const block = await insertChartBlock({
      ...specFor(empty.datasetId, {
        fields: {
          x: { fieldId: empty.fieldIds[0] },
          y: { fieldId: empty.fieldIds[1] },
          series: null,
          color: null,
          size: null,
          facet: null,
        },
      }),
    })
    await expect(
      migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
        block.id,
        block.version,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects unknown dataset references at the trigger', async () => {
    await expect(
      insertChartBlock(specFor('00000000-0000-4000-8000-0000000000ff', {})),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('freezes a faceted line chart into codepoint-sorted per-value panels', async () => {
    const spec = specFor(dsIdMain, {
        fields: {
          x: { fieldId: FIELD_TIME },
          y: { fieldId: FIELD_RECOVERY },
          series: null,
          color: null,
          size: null,
          facet: { fieldId: FIELD_CONDITION },
        },
      })
    const block = await insertChartBlock(spec)
    const res = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = res.rows[0].payload.frozen as FrozenChart
    const rows = await loadPinnedVersionRows(
      migrator,
      frozen.datasetProvenance[0].datasetVersionId!,
    )
    const facets = rematerialiseFrozenFacets(spec as ChartSpec, frozen, rows)
    expect(facets.panels.map((f) => f.value)).toEqual(['A', 'B'])
    expect(facets.panels[0].chart.series[0].points).toHaveLength(3)
    expect(facets.panels[1].chart.series[0].points).toHaveLength(2)
    expect(facets.total).toBe(2)

    // Facet cap disclosure: 13 distinct values → 12 panels, total 13.
    const many: Array<[number, number, string]> = []
    for (let i = 1; i <= 13; i++)
      many.push([i, i * 10, `v${String(i).padStart(2, '0')}`])
    const wide = await insertDataset(
      `wide_facets_${Date.now()}`,
      [
        { key: 'x', label: 'X', type: 'decimal' },
        { key: 'y', label: 'Y', type: 'decimal' },
        { key: 'g', label: 'G', type: 'text' },
      ],
      many,
    )
    const wideBlock = await insertChartBlock(
      specFor(wide.datasetId, {
        fields: {
          x: { fieldId: wide.fieldIds[0] },
          y: { fieldId: wide.fieldIds[1] },
          series: null,
          color: null,
          size: null,
          facet: { fieldId: wide.fieldIds[2] },
        },
      }),
    )
    const wideRes = await migrator.query(
      `SELECT * FROM api.freeze_chart($1,$2)`,
      [wideBlock.id, wideBlock.version],
    )
    const wideFrozen = wideRes.rows[0].payload.frozen as FrozenChart
    const wideRows = await loadPinnedVersionRows(
      migrator,
      wideFrozen.datasetProvenance[0].datasetVersionId!,
    )
    const wideFacets = rematerialiseFrozenFacets(
      specFor(wide.datasetId, {
        fields: {
          x: { fieldId: wide.fieldIds[0] },
          y: { fieldId: wide.fieldIds[1] },
          series: null,
          color: null,
          size: null,
          facet: { fieldId: wide.fieldIds[2] },
        },
      }) as ChartSpec,
      wideFrozen,
      wideRows,
    )
    expect(wideFacets.panels).toHaveLength(12)
    expect(wideFacets.total).toBe(13)
  })

  it('freezes faceted histogram charts and rematerialises in TypeScript', async () => {
    const spec = specFor(dsIdMain, {
      type: 'histogram',
      fields: {
        x: null,
        y: { fieldId: FIELD_RECOVERY },
        series: null,
        color: null,
        size: null,
        facet: { fieldId: FIELD_CONDITION },
      },
      typeParams: { histogram: { bins: 4 } },
    })
    const block = await insertChartBlock(spec)
    const res = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = res.rows[0].payload.frozen as FrozenChart
    const rows = await loadPinnedVersionRows(
      migrator,
      frozen.datasetProvenance[0].datasetVersionId!,
    )
    const facets = rematerialiseFrozenFacets(spec as ChartSpec, frozen, rows)
    expect(facets.total).toBe(2)
    expect(facets.panels).toHaveLength(2)
  })
})
