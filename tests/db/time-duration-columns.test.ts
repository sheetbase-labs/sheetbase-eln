/**
 * Time of day and duration columns are checked by the database on every way
 * a value arrives. A time is stored as HH:MM:SS (so 9:10 and 09:10 are the
 * same value and 09:010 is refused), a duration as seconds of zero or more,
 * and both sort and filter as their type, not as free text.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '15000000-0000-4000-8000-0000000000d1'
const OWNER = 'time-duration-owner'

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

/** A published measurement table with a Time and a Duration column. */
async function timedDataset() {
  const key = `timed_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Timed') returning id`,
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
     values ($1,gen_random_uuid(),'started','Started','time',true,1),
            ($1,gen_random_uuid(),'spin','Spin','duration',true,2)
     returning key, field_id`,
    [version.id],
  )

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Timed') returning id`,
      [WS, version.id],
    )
  ).rows[0]

  const byKey = Object.fromEntries(
    fields.rows.map((row) => [row.key, row.field_id as string]),
  )

  return {
    datasetId: dataset.id as string,
    started: byKey.started as string,
    spin: byKey.spin as string,
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','time-duration@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'time-duration','Time and duration')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('time and duration dataset columns', () => {
  it('refuses a malformed time or a negative duration before anything is written', async () => {
    const owner = await actor()
    const { datasetId, started, spin } = await timedDataset()

    const values = [
      { [started]: '09:10' },
      { [started]: '9:10:30' },
      { [started]: '09:010' },
      { [started]: '24:00' },
      { [started]: 910 },
      { [spin]: 600 },
      { [spin]: -1 },
      { [spin]: '10 min' },
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
      [7, 'invalid_value'],
      [8, 'invalid_value_type'],
    ])
  })

  it('stores a time as HH:MM:SS and a duration as seconds, and sorts and filters them by value', async () => {
    const owner = await actor()
    const { datasetId, started, spin } = await timedDataset()

    const rows = [
      { [started]: '9:10', [spin]: 5400 },
      { [started]: '14:05', [spin]: 600 },
      { [started]: '10:00:30', [spin]: 45 },
    ]

    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,$3)`,
      [
        datasetId,
        JSON.stringify(
          rows.map((values) => ({
            operation: 'create',
            rowId: crypto.randomUUID(),
            values,
          })),
        ),
        `timed-${datasetId}`,
      ],
    )

    const stored = await migrator.query(
      `select v.text_value, v.numeric_value from api.dataset_row_values v
        join api.dataset_rows r on r.id = v.row_id
       where r.dataset_id = $1 order by v.text_value nulls last, v.numeric_value`,
      [datasetId],
    )

    expect(
      stored.rows
        .map((row) => row.text_value ?? Number(row.numeric_value))
        .sort(),
    ).toEqual(['09:10:00', '10:00:30', '14:05:00', 45, 5400, 600].sort())

    // A filter value is read the same way: 9:30 is after 09:10:00.
    const after = (
      await owner.query(
        `select * from api.query_dataset_rows($1,$2::jsonb,50,0)`,
        [
          datasetId,
          JSON.stringify({
            filters: [{ fieldId: started, operator: 'gt', value: '9:30' }],
            sort: { fieldId: spin, direction: 'asc' },
          }),
        ],
      )
    ).rows

    const json = JSON.stringify(after)

    expect(json).toContain('10:00:30')
    expect(json).toContain('14:05:00')
    expect(json).not.toContain('09:10:00')
  })
})

describe('time and duration model fields and sheet values', () => {
  it('stores a record field time as HH:MM:SS and refuses a negative duration', async () => {
    const owner = await actor()

    for (const [name, type] of [
      ['td_start', 'time'],
      ['td_spin', 'duration'],
    ])
      await owner.query(
        `select * from api.create_model_field($1,'sample',$2,$2,$3,true,null,'{}'::jsonb)`,
        [WS, name, type],
      )

    await migrator.query(
      `update api.record_field_definitions set lifecycle='active' where workspace_id=$1 and field_name like 'td\\_%'`,
      [WS],
    )

    const out = (
      await migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb) out`,
        [WS, JSON.stringify({ td_start: '7:45', td_spin: 90 })],
      )
    ).rows[0].out

    expect(out).toEqual({ td_start: '07:45:00', td_spin: 90 })

    await expect(
      migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb)`,
        [WS, JSON.stringify({ td_spin: -5 })],
      ),
    ).rejects.toThrow(/duration/)

    await expect(
      migrator.query(
        `select internal.validate_model_fields($1,'sample',$2::jsonb)`,
        [WS, JSON.stringify({ td_start: '09:010' })],
      ),
    ).rejects.toThrow(/time such as 09:30/)
  })

  it('checks sheet cells the same way', async () => {
    const matches = async (type: string, value: unknown) =>
      (
        await migrator.query(
          `select internal.sheet_definition_scalar_matches($1,$2::jsonb) ok`,
          [type, JSON.stringify(value)],
        )
      ).rows[0].ok

    expect(await matches('time', '07:05')).toBe(true)
    expect(await matches('time', '07:005')).toBe(false)
    expect(await matches('duration', 30)).toBe(true)
    expect(await matches('duration', -30)).toBe(false)
    expect(await matches('duration', '30')).toBe(false)
  })
})
