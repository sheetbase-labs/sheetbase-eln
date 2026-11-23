/**
 * The chart editor clears the fields and options that mean nothing for a new
 * chart type (`chartTypePatch`), and the database trigger refuses a chart spec
 * that keeps them. They are two copies of one rule, so this switches a chart
 * to every type and checks the database accepts the result.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CHART_TYPES } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import { chartTypePatch } from '#/lib/chart-type-patch'

import { prepareTestDatabase } from './helpers'

const WS = crypto.randomUUID()
const PROJECT = crypto.randomUUID()
const USER = `chart-type-patch-${crypto.randomUUID().slice(0, 8)}`

let migrator: Client
let experimentId = ''
let datasetId = ''
let fieldX = ''
let fieldY = ''
let order = 0

function lineSpec(): ChartSpec {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId }],
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
    overlays: { errorBars: null },
  } as unknown as ChartSpec
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'Chart patch','chart-type-patch@sheetbase.test',true)`,
    [USER],
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,$2,'Chart patch')`,
    [WS, `chart-patch-${WS.slice(0, 8)}`],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role)
     VALUES ($1,$2,'owner')`,
    [WS, USER],
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ($1,$2,'chart-patch','Chart patch',$3)`,
    [PROJECT, WS, USER],
  )
  await migrator.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ role: 'authenticated', sub: USER, workspace_id: WS }),
  ])
  experimentId = (
    await migrator.query(
      `SELECT * FROM api.create_record(
         $1::uuid,'experiment','Chart patch','draft',ARRAY[]::text[],'{}'::jsonb)`,
      [PROJECT],
    )
  ).rows[0].id

  const schema = await migrator.query(
    `INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
     VALUES ($1,$2,'Chart patch','active') RETURNING id`,
    [WS, `chart_patch_${Date.now()}`],
  )
  const version = await migrator.query(
    `INSERT INTO api.dataset_schema_versions(schema_id,"version",lifecycle)
     VALUES ($1,1,'draft') RETURNING id`,
    [schema.rows[0].id],
  )
  const ids: string[] = []

  for (const [index, key] of ['time', 'recovery'].entries()) {
    const field = await migrator.query(
      `INSERT INTO api.dataset_schema_version_fields
        (schema_version_id,field_id,key,label,logical_type,display_order)
       VALUES ($1,gen_random_uuid(),$2,$2,'decimal',$3) RETURNING field_id`,
      [version.rows[0].id, key, index + 1],
    )

    ids.push(field.rows[0].field_id)
  }
  ;[fieldX, fieldY] = ids
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle='active' WHERE id=$1`,
    [version.rows[0].id],
  )
  datasetId = (
    await migrator.query(
      `INSERT INTO api.datasets(workspace_id,schema_version_id,name)
       VALUES ($1,$2,'Chart patch') RETURNING id`,
      [WS, version.rows[0].id],
    )
  ).rows[0].id
})

afterAll(async () => {
  await migrator.query(`DELETE FROM api.records WHERE project_id=$1`, [PROJECT])
  await migrator.query(`DELETE FROM api.projects WHERE id=$1`, [PROJECT])
})

describe('chartTypePatch against the chart trigger', () => {
  it.each(CHART_TYPES)('accepts a line chart switched to %s', async (type) => {
    const base = lineSpec()
    const spec = { ...base, ...chartTypePatch(base, type) }

    const insert = migrator.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES ($1,'chart',$2::jsonb,$3,$4)`,
      [
        experimentId,
        JSON.stringify({ title: 'T', spec, frozen: null }),
        ++order,
        USER,
      ],
    )

    await expect(insert).resolves.toBeDefined()
  })
})
