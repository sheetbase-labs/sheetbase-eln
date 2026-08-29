/**
 * SCI-04 database contract: new ChartSpec types are accepted, freeze pins a
 * Dataset Version, and later live Dataset edits do not rewrite frozen series.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

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
  it('accepts scatter_line and pins a Dataset Version on freeze', async () => {
    const block = await insertChartBlock(specFor())
    const res = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const frozen = res.rows[0].payload.frozen
    expect(frozen.datasetProvenance[0].datasetId).toBe(dsId)
    expect(frozen.datasetProvenance[0].datasetVersionId).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
    expect(frozen.data.series[0].points.map((p: { y: number }) => p.y)).toEqual([
      2, 4, 6,
    ])
  })

  it('keeps frozen series after the live Dataset is mutated', async () => {
    const block = await insertChartBlock(specFor('scatter'))
    const frozenRes = await migrator.query(`SELECT * FROM api.freeze_chart($1,$2)`, [
      block.id,
      block.version,
    ])
    const original = frozenRes.rows[0].payload.frozen.data.series[0].points.map(
      (p: { y: number }) => p.y,
    )

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

    const still = await migrator.query(`SELECT payload FROM api.blocks WHERE id=$1`, [
      block.id,
    ])
    const frozenYs = still.rows[0].payload.frozen.data.series[0].points.map(
      (p: { y: number }) => p.y,
    )
    expect(frozenYs).toEqual(original)
  })
})
