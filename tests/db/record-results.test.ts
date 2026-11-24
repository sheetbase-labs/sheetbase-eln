/**
 * Every result on a record: `api.record_results` returns each dataset row whose
 * link column holds the record, with its measurement table, dataset, live or
 * snapshot, and every value. Only datasets the person may see are included.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '16000000-0000-4000-8000-000000000001'
const WS_OTHER = '16000000-0000-4000-8000-000000000002'
const OWNER = 'record-results-owner'
const OUTSIDER = 'record-results-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])

  return client
}

async function sampleRecord(identifier: string) {
  return (
    await migrator.query(
      `insert into api.records(workspace_id,kind,identifier,title,created_by_user_id)
       values ($1,'sample',$2,$2,$3) returning id`,
      [WS, identifier, OWNER],
    )
  ).rows[0].id as string
}

/** A measurement table with a sample link column and a number column, and a dataset on it. */
async function measurementDataset(tableName: string) {
  const key = `res_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$3) returning id`,
      [WS, key, tableName],
    )
  ).rows[0]

  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]

  const link = (
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,relationship,display_order)
       values ($1,gen_random_uuid(),'sample','Sample','reference',true,$2::jsonb,1) returning field_id`,
      [
        version.id,
        JSON.stringify({
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        }),
      ],
    )
  ).rows[0]

  const value = (
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,quantity,display_order)
       values ($1,gen_random_uuid(),'od','OD600','decimal',true,$2::jsonb,2) returning field_id`,
      [
        version.id,
        JSON.stringify({
          kind: 'dimensionless',
          dimension: 'none',
          storageUnit: 'AU',
          symbol: 'AU',
        }),
      ],
    )
  ).rows[0]

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,$3) returning id, revision`,
      [WS, version.id, `${tableName} run`],
    )
  ).rows[0]

  return {
    datasetId: dataset.id as string,
    linkFieldId: link.field_id as string,
    valueFieldId: value.field_id as string,
  }
}

async function addRow(
  owner: Client,
  dataset: Awaited<ReturnType<typeof measurementDataset>>,
  sample: string,
  od: number,
) {
  const revision = (
    await migrator.query(`select revision from api.datasets where id=$1`, [
      dataset.datasetId,
    ])
  ).rows[0].revision

  const rowId = crypto.randomUUID()

  await owner.query(`select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)`, [
    dataset.datasetId,
    revision,
    JSON.stringify([
      {
        operation: 'create',
        rowId,
        values: {
          [dataset.linkFieldId]: sample,
          [dataset.valueFieldId]: od,
        },
      },
    ]),
    `results-${rowId}`,
  ])

  return rowId
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','record-results-owner@test.invalid',true),
      ($2,'Outsider','record-results-outsider@test.invalid',true)`,
    [OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'record-results-a','Results A'),($2,'record-results-b','Results B')`,
    [WS, WS_OTHER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($2,$4,'owner')`,
    [WS, WS_OTHER, OWNER, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('every result on a record', () => {
  it('lists the rows that link to the record, from every measurement table', async () => {
    const owner = await actor(OWNER, WS)
    const sample = await sampleRecord('SMP-R001')
    const other = await sampleRecord('SMP-R002')
    const growth = await measurementDataset('Growth curve')
    const titre = await measurementDataset('Titre')

    await addRow(owner, growth, sample, 0.4)
    await addRow(owner, growth, sample, 0.9)
    await addRow(owner, growth, other, 1.2)
    await addRow(owner, titre, sample, 3)

    const result = (
      await owner.query(`select api.record_results($1) r`, [sample])
    ).rows[0].r

    expect(result.total).toBe(3)

    expect(
      result.rows.map((row: { tableName: string }) => row.tableName).sort(),
    ).toEqual(['Growth curve', 'Growth curve', 'Titre'])

    const row = result.rows.find(
      (r: { tableName: string }) => r.tableName === 'Titre',
    )

    expect(row.source).toBe('live')
    expect(row.datasetName).toBe('Titre run')

    expect(row.values).toEqual([
      expect.objectContaining({
        key: 'sample',
        linksHere: true,
        value: sample,
      }),
      expect.objectContaining({ key: 'od', unit: 'AU', value: 3 }),
    ])
  })

  it('includes the rows kept in snapshots only when asked', async () => {
    const owner = await actor(OWNER, WS)
    const sample = await sampleRecord('SMP-R010')
    const growth = await measurementDataset('Growth snapshots')

    await addRow(owner, growth, sample, 0.5)

    const revision = (
      await migrator.query(`select revision from api.datasets where id=$1`, [
        growth.datasetId,
      ])
    ).rows[0].revision

    await owner.query(`select api.snapshot_dataset($1,$2,'Day 3')`, [
      growth.datasetId,
      revision,
    ])

    const live = (
      await owner.query(`select api.record_results($1) r`, [sample])
    ).rows[0].r

    const all = (
      await owner.query(`select api.record_results($1,true) r`, [sample])
    ).rows[0].r

    expect(live.total).toBe(1)
    expect(all.total).toBe(2)

    expect(all.rows.map((r: { source: string }) => r.source).sort()).toEqual([
      'live',
      'snapshot',
    ])

    expect(
      all.rows.find((r: { source: string }) => r.source === 'snapshot')
        .snapshotLabel,
    ).toBe('Day 3')
  })

  it('refuses a person outside the workspace', async () => {
    const sample = await sampleRecord('SMP-R020')
    const outsider = await actor(OUTSIDER, WS_OTHER)

    await expect(
      outsider.query(`select api.record_results($1)`, [sample]),
    ).rejects.toThrow()
  })

  it('answers with nothing for a record no row links to', async () => {
    const owner = await actor(OWNER, WS)
    const sample = await sampleRecord('SMP-R030')

    const result = (
      await owner.query(`select api.record_results($1) r`, [sample])
    ).rows[0].r

    expect(result).toEqual({ total: 0, rows: [] })
  })
})
