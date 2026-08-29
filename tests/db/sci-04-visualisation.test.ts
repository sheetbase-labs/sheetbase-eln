/**
 * SCI-04 database contract: new ChartSpec types are accepted, freeze pins a
 * Dataset Version, and later live Dataset edits do not rewrite frozen series.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChartSpec, FrozenChart } from '#/lib/chart-spec'
import { materialiseChart, validateChartSpec } from '#/lib/chart-spec'

import { prepareTestDatabase } from './helpers'
import {
  loadPinnedVersionRows,
  rematerialiseFrozenChart,
} from './sci-freeze-helpers'

const WS_A = crypto.randomUUID()
const PROJECT_A = crypto.randomUUID()
const USER_A = `sci-04-owner-${crypto.randomUUID().slice(0, 8)}`

let migrator: Client

let experimentId = ''
let dsId = ''
let fieldX = ''
let fieldY = ''

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
    [WS_A, `sci04_${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, name],
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
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [svId],
  )
  const dsRes = await migrator.query(
    `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
     VALUES ($1,$2,$3) RETURNING id`,
    [WS_A, svId, name],
  )
  const datasetId = dsRes.rows[0].id
  for (const row of rows) {
    const rowRes = await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [datasetId, WS_A],
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
  return { datasetId, fieldIds }
}

function signature(chart: {
  series: Array<{
    identifier: string
    points: Array<{
      x: number | null
      y: number | null
      yErrorLo?: number | null
      yErrorHi?: number | null
    }>
    violin?: Array<{ y: number; d: number }>
  }>
}) {
  return [...chart.series]
    .map((item) => ({
      identifier: item.identifier,
      ys: item.points
        .map((point) => Number(point.y))
        .sort((a, b) => a - b),
      errors: item.points
        .map((point) => [
          point.yErrorLo ?? null,
          point.yErrorHi ?? null,
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      violin: item.violin
        ? [...item.violin]
            .map((sample) => ({
              y: Number(sample.y.toFixed(8)),
              d: Number(sample.d.toFixed(8)),
            }))
            .sort((a, b) => a.y - b.y || a.d - b.d)
        : undefined,
    }))
    .sort((a, b) => a.identifier.localeCompare(b.identifier))
}

function specFor(type = 'scatter_line') {
  return {
    specVersion: 1,
    type,
    datasets: [{ datasetId: dsId }],
    fields: {
      x: { fieldId: fieldX },
      y: { fieldId: fieldY },
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
    overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
  }
}

let blockOrder = 0

async function insertChartBlock(spec: unknown) {
  const res = await migrator.query(
    `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
     VALUES ($1,'chart',$2::jsonb,$4,$3) RETURNING *`,
    [
      experimentId,
      JSON.stringify({ title: 'SCI-04', spec, frozen: null }),
      USER_A,
      ++blockOrder,
    ],
  )
  return res.rows[0]
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('${USER_A}','SCI 04','sci-04@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ('${WS_A}','sci-04','SCI 04')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ('${WS_A}','${USER_A}','owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title)
     VALUES ('${PROJECT_A}','${WS_A}','sci-04','SCI 04')`,
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER_A, workspace_id: WS_A }),
  ])
  const rec = await migrator.query(
    `SELECT * FROM api.create_record(
       $1::uuid,'experiment','Visualisation','draft',ARRAY[]::text[],'{}'::jsonb)`,
    [PROJECT_A],
  )
  experimentId = rec.rows[0].id
  const ds = await insertDataset(
    'dose_response',
    [
      { key: 'dose', label: 'Dose', type: 'decimal' },
      { key: 'response', label: 'Response', type: 'decimal' },
    ],
    [
      [1, 2],
      [2, 4],
      [3, 6],
    ],
  )
  dsId = ds.datasetId
  ;[fieldX, fieldY] = ds.fieldIds
})

afterAll(async () => {
  // Frozen Dataset Versions pin the creating user; they are immutable
  // evidence, so this fixture does not delete the Dataset or owner.
  await migrator.query(`DELETE FROM api.records WHERE project_id=$1`, [PROJECT_A])
  await migrator.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT_A])
})

describe('SCI-04 visualisation freeze', () => {
  it('accepts scatter_line and rematerialises from the pinned Version', async () => {
    const spec = specFor()
    const block = await insertChartBlock(spec)
    const res = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = res.rows[0].payload.frozen as FrozenChart
    expect(frozen.datasetProvenance[0].datasetId).toBe(dsId)
    expect(frozen.datasetProvenance[0].datasetVersionId).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
    expect(frozen.data.series).toEqual([])
    const rows = await loadPinnedVersionRows(
      migrator,
      frozen.datasetProvenance[0].datasetVersionId!,
    )
    const chart = rematerialiseFrozenChart(spec as ChartSpec, frozen, rows)
    expect(chart.state.kind).toBe('ok')
    expect(
      chart.series[0].points.map((point) => point.y).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([2, 4, 6])
  })

  it('keeps the pinned Version after the live Dataset is mutated', async () => {
    const spec = specFor('scatter')
    const block = await insertChartBlock(spec)
    const frozenRes = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = frozenRes.rows[0].payload.frozen as FrozenChart
    const versionId = frozen.datasetProvenance[0].datasetVersionId!
    const pinned = rematerialiseFrozenChart(
      spec as ChartSpec,
      frozen,
      await loadPinnedVersionRows(migrator, versionId),
    )
    expect(
      pinned.series[0].points.map((point) => point.y).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([2, 4, 6])

    const rowRes = await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id) VALUES ($1,$2) RETURNING id`,
      [dsId, WS_A],
    )
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       VALUES ($1,$2,$3), ($1,$4,$5)`,
      [rowRes.rows[0].id, fieldX, 99, fieldY, 99],
    )

    const liveCount = await migrator.query(
      `SELECT count(*)::int AS n FROM api.dataset_rows WHERE dataset_id=$1`,
      [dsId],
    )
    expect(liveCount.rows[0].n).toBeGreaterThan(3)
    const versionCount = await migrator.query(
      `SELECT count(*)::int AS n FROM api.dataset_version_rows WHERE dataset_version_id=$1`,
      [versionId],
    )
    expect(versionCount.rows[0].n).toBe(3)

    const still = rematerialiseFrozenChart(
      spec as ChartSpec,
      frozen,
      await loadPinnedVersionRows(migrator, versionId),
    )
    expect(still.series[0].points.map((point) => point.y).sort((a, b) => Number(a) - Number(b))).toEqual(
      [2, 4, 6],
    )
  })

  it('matches live materialisation for log10, SEM, violin, OLS and error bars', async () => {
    const groupDs = await insertDataset(
      'grouped_response',
      [
        { key: 'dose', label: 'Dose', type: 'decimal' },
        { key: 'response', label: 'Response', type: 'decimal' },
        { key: 'arm', label: 'Arm', type: 'text' },
      ],
      [
        [1, 10, 'A'],
        [2, 20, 'A'],
        [3, 30, 'A'],
        [1, 12, 'B'],
        [2, 22, 'B'],
        [3, 32, 'B'],
      ],
    )
    const [xId, yId, gId] = groupDs.fieldIds
    const columns = [
      { id: xId, label: 'Dose', logicalType: 'decimal' as const },
      { id: yId, label: 'Response', logicalType: 'decimal' as const },
      { id: gId, label: 'Arm', logicalType: 'text' as const },
    ]
    const liveRows = [
      { [xId]: 1, [yId]: 10, [gId]: 'A' },
      { [xId]: 2, [yId]: 20, [gId]: 'A' },
      { [xId]: 3, [yId]: 30, [gId]: 'A' },
      { [xId]: 1, [yId]: 12, [gId]: 'B' },
      { [xId]: 2, [yId]: 22, [gId]: 'B' },
      { [xId]: 3, [yId]: 32, [gId]: 'B' },
    ]
    const cases: ChartSpec[] = [
      {
        ...specFor('scatter'),
        datasets: [{ datasetId: groupDs.datasetId }],
        fields: {
          x: { fieldId: xId },
          y: { fieldId: yId },
          series: { fieldId: gId },
          color: null,
          size: null,
          facet: null,
        },
        transformations: [{ kind: 'log10', params: { fieldId: yId } }],
        overlays: { errorBars: null, fit: null },
      } as ChartSpec,
      {
        ...specFor('summary'),
        datasets: [{ datasetId: groupDs.datasetId }],
        fields: {
          x: { fieldId: xId },
          y: { fieldId: yId },
          series: { fieldId: gId },
          color: null,
          size: null,
          facet: null,
        },
        overlays: {
          errorBars: { source: 'computed', basis: 'sem' },
          fit: null,
        },
      } as ChartSpec,
      {
        ...specFor('violin'),
        datasets: [{ datasetId: groupDs.datasetId }],
        fields: {
          x: null,
          y: { fieldId: yId },
          series: { fieldId: gId },
          color: null,
          size: null,
          facet: null,
        },
        overlays: { errorBars: null, fit: null },
      } as ChartSpec,
      {
        ...specFor('scatter'),
        datasets: [{ datasetId: groupDs.datasetId }],
        fields: {
          x: { fieldId: xId },
          y: { fieldId: yId },
          series: null,
          color: null,
          size: null,
          facet: null,
        },
        overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
      } as ChartSpec,
      {
        ...specFor('scatter'),
        datasets: [{ datasetId: groupDs.datasetId }],
        fields: {
          x: { fieldId: xId },
          y: { fieldId: yId },
          series: { fieldId: gId },
          color: null,
          size: null,
          facet: null,
        },
        overlays: {
          errorBars: { source: 'computed', basis: 'sd' },
          fit: null,
        },
      } as ChartSpec,
    ]

    for (const spec of cases) {
      const live = materialiseChart(spec, columns, liveRows)
      const block = await insertChartBlock(spec)
      const frozenRes = await migrator.query(
        `SELECT * FROM api.freeze_chart($1,$2)`,
        [block.id, block.version],
      )
      const frozen = frozenRes.rows[0].payload.frozen as FrozenChart
      const pinnedRows = await loadPinnedVersionRows(
        migrator,
        frozen.datasetProvenance[0].datasetVersionId!,
      )
      const rematerialised = rematerialiseFrozenChart(spec, frozen, pinnedRows)
      expect(rematerialised.state).toEqual(live.state)
      expect(signature(rematerialised)).toEqual(signature(live))
      expect(rematerialised.fit?.equation).toEqual(live.fit?.equation)
      expect(rematerialised.fit?.r2).toEqual(live.fit?.r2)
    }
  })

  it('pages more than 5000 live Dataset rows without dataset_too_large', async () => {
    const large = await insertDataset(
      'large_envelope',
      [
        { key: 'x', label: 'X', type: 'decimal' },
        { key: 'y', label: 'Y', type: 'decimal' },
      ],
      [],
    )
    await migrator.query(
      `INSERT INTO api.dataset_rows(dataset_id,workspace_id)
       SELECT $1,$2 FROM generate_series(1, 5100)`,
      [large.datasetId, WS_A],
    )
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       SELECT r.id, $2, 1 FROM api.dataset_rows r WHERE r.dataset_id=$1`,
      [large.datasetId, large.fieldIds[0]],
    )
    await migrator.query(
      `INSERT INTO api.dataset_row_values(row_id,field_id,numeric_value)
       SELECT r.id, $2, 2 FROM api.dataset_rows r WHERE r.dataset_id=$1`,
      [large.datasetId, large.fieldIds[1]],
    )
    const page = await migrator.query<{ totalCount: number }>(
      `SELECT (api.query_dataset_rows($1,'{}'::jsonb,1000,0)->>'totalCount')::int AS "totalCount"`,
      [large.datasetId],
    )
    expect(page.rows[0].totalCount).toBe(5100)
  }, 60_000)

  it('rejects scatter_line without x in both TypeScript and the trigger', async () => {
    const invalid = {
      ...specFor('scatter_line'),
      fields: {
        x: null,
        y: { fieldId: fieldY },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
    }
    expect(validateChartSpec(invalid).some((error) => error.field === 'spec.fields.x')).toBe(
      true,
    )
    await expect(insertChartBlock(invalid)).rejects.toMatchObject({ code: '23514' })
  })
})
