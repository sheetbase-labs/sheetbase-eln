/**
 * Well position and person columns are checked by the database on every way
 * a value arrives. A well is stored as A1 (so a01 and A01 are the same value
 * and A0 or AG1 are refused) and sorts row by row; a person is a user id of
 * someone in the workspace and sorts by their name.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '15000000-0000-4000-8000-0000000000e1'
const OWNER = 'well-person-owner'
const ZOE = 'well-person-zoe'
const OUTSIDER = 'well-person-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor() {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])

  return client
}

/** A published measurement table with a Well and a Person column. */
async function plateDataset() {
  const key = `plate_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Plate') returning id`,
      [WS, key],
    )
  ).rows[0]

  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]

  const fields = await migrator.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,display_order)
     values ($1,gen_random_uuid(),'well','Well','well',true,1),
            ($1,gen_random_uuid(),'analyst','Analyst','person',true,2)
     returning key, field_id`,
    [version.id],
  )

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Plate') returning id`,
      [WS, version.id],
    )
  ).rows[0]

  const byKey = Object.fromEntries(
    fields.rows.map((row) => [row.key, row.field_id as string]),
  )

  return {
    datasetId: dataset.id as string,
    well: byKey.well as string,
    analyst: byKey.analyst as string,
  }
}

async function commit(
  owner: Client,
  datasetId: string,
  rows: Array<Record<string, unknown>>,
) {
  await owner.query(`select api.commit_dataset_row_batch($1,1,$2::jsonb,$3)`, [
    datasetId,
    JSON.stringify(
      rows.map((values) => ({
        operation: 'create',
        rowId: crypto.randomUUID(),
        values,
      })),
    ),
    `plate-${crypto.randomUUID()}`,
  ])
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const [id, name] of [
    [OWNER, 'Ana Owner'],
    [ZOE, 'Zoe Analyst'],
    [OUTSIDER, 'Olly Outsider'],
  ])
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values ($1,$2,$3,true)`,
      [id, name, `${id}@test.invalid`],
    )

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'well-person','Well and person')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, ZOE],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('well position and person dataset columns', () => {
  it('refuses a bad well or someone outside the workspace before anything is written', async () => {
    const owner = await actor()
    const { datasetId, well, analyst } = await plateDataset()

    const values = [
      { [well]: 'A1' },
      { [well]: 'a01' },
      { [well]: 'A0' },
      { [well]: 'AG1' },
      { [well]: 12 },
      { [analyst]: ZOE },
      { [analyst]: OUTSIDER },
      { [analyst]: 'nobody' },
    ]

    const result = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
        [
          datasetId,
          JSON.stringify(
            values.map((value) => ({
              operation: 'create',
              rowId: crypto.randomUUID(),
              values: value,
            })),
          ),
        ],
      )
    ).rows[0].result

    expect(
      (result.errors as Array<{ rowIndex: number; code: string }>).map(
        (error) => [error.rowIndex, error.code],
      ),
    ).toEqual([
      [3, 'invalid_value'],
      [4, 'invalid_value'],
      [5, 'invalid_value_type'],
      [7, 'invalid_person'],
      [8, 'invalid_person'],
    ])
  })

  it('stores wells as A1, sorts them row by row and finds them by any typed form', async () => {
    const owner = await actor()
    const { datasetId, well } = await plateDataset()

    await commit(
      owner,
      datasetId,
      ['A10', 'b01', 'a2', 'AA1'].map((value) => ({ [well]: value })),
    )

    const sorted = (
      await owner.query(
        `select * from api.query_dataset_rows($1,$2::jsonb,50,0)`,
        [
          datasetId,
          JSON.stringify({ sort: { fieldId: well, direction: 'asc' } }),
        ],
      )
    ).rows

    const order = [
      ...JSON.stringify(sorted).matchAll(/"(A2|A10|B1|AA1)"/g),
    ].map((match) => match[1])

    expect(order).toEqual(['A2', 'A10', 'B1', 'AA1'])

    const found = JSON.stringify(
      (
        await owner.query(
          `select * from api.query_dataset_rows($1,$2::jsonb,50,0)`,
          [
            datasetId,
            JSON.stringify({
              filters: [{ fieldId: well, operator: 'eq', value: 'b 01' }],
            }),
          ],
        )
      ).rows,
    )

    expect(found).toContain('"B1"')
    expect(found).not.toContain('"A2"')
  })

  it('stores a person as their user id and sorts by name', async () => {
    const owner = await actor()
    const { datasetId, analyst } = await plateDataset()

    await commit(owner, datasetId, [{ [analyst]: ZOE }, { [analyst]: OWNER }])

    const sorted = JSON.stringify(
      (
        await owner.query(
          `select * from api.query_dataset_rows($1,$2::jsonb,50,0)`,
          [
            datasetId,
            JSON.stringify({ sort: { fieldId: analyst, direction: 'desc' } }),
          ],
        )
      ).rows,
    )

    // Zoe Analyst sorts after Ana Owner, so comes first descending.
    expect(sorted.indexOf(ZOE)).toBeGreaterThan(-1)
    expect(sorted.indexOf(ZOE)).toBeLessThan(sorted.indexOf(OWNER))
  })
})

describe('well position and person model fields and sheet values', () => {
  it('stores a record field well as A1 and refuses someone outside the workspace', async () => {
    const owner = await actor()

    for (const [name, type] of [
      ['wp_well', 'well'],
      ['wp_by', 'person'],
    ])
      await owner.query(
        `select * from api.create_model_field($1,'sample',$2,$2,$3,true,null,'{}'::jsonb)`,
        [WS, name, type],
      )

    await migrator.query(
      `update api.record_field_definitions set lifecycle='active' where workspace_id=$1 and field_name like 'wp\\_%'`,
      [WS],
    )

    const out = (
      await migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb) out`,
        [WS, JSON.stringify({ wp_well: 'h05', wp_by: ZOE })],
      )
    ).rows[0].out

    expect(out).toEqual({ wp_well: 'H5', wp_by: ZOE })

    await expect(
      migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb)`,
        [WS, JSON.stringify({ wp_by: OUTSIDER })],
      ),
    ).rejects.toThrow(/someone in this workspace/)

    await expect(
      migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb)`,
        [WS, JSON.stringify({ wp_well: 'Z99' })],
      ),
    ).rejects.toThrow(/well such as A1/)
  })

  it('checks sheet cells the same way', async () => {
    const matches = async (type: string, value: unknown) =>
      (
        await migrator.query(
          `select internal.sheet_definition_scalar_matches($1,$2::jsonb) ok`,
          [type, JSON.stringify(value)],
        )
      ).rows[0].ok

    expect(await matches('well', 'A1')).toBe(true)
    expect(await matches('well', 'A01')).toBe(false)
    expect(await matches('well', 'AG1')).toBe(false)
    expect(await matches('person', ZOE)).toBe(true)
    expect(await matches('person', '')).toBe(false)
  })
})
