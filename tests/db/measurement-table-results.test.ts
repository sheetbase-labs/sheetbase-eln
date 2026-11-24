/**
 * One kind of result across datasets: the rows of a measurement table from
 * every dataset the caller can open, live or at snapshots, with the dataset and
 * snapshot of each row. A dataset in a project the caller cannot see is never
 * read, listed or confirmed to exist.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '16000000-0000-4000-8000-000000000001'
const OTHER_WS = '16000000-0000-4000-8000-000000000002'
const MEMBER = 'mtr-member'
const INSIDER = 'mtr-insider'
const OUTSIDER = 'mtr-outsider'
const OPEN = '16000000-0000-4000-8000-0000000000a1'
const CLOSED = '16000000-0000-4000-8000-0000000000a2'
const SCHEMA = '16000000-0000-4000-8000-0000000000b1'
const V1 = '16000000-0000-4000-8000-0000000000b2'
const V2 = '16000000-0000-4000-8000-0000000000b3'
const F_VALUE = '16000000-0000-4000-8000-0000000000c1'
const F_NOTE = '16000000-0000-4000-8000-0000000000c2'
const F_LINK = '16000000-0000-4000-8000-0000000000c3'
const DS_OPEN = '16000000-0000-4000-8000-0000000000d1'
const DS_CLOSED = '16000000-0000-4000-8000-0000000000d2'
const SAMPLE = '16000000-0000-4000-8000-0000000000e1'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(user: string, workspace = WS) {
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

const rows = async (client: Client, query: object = {}, limit = 200) =>
  (
    await client.query(
      `select api.query_measurement_table_rows($1,$2::jsonb,$3,0) result`,
      [SCHEMA, JSON.stringify(query), limit],
    )
  ).rows[0].result

async function addRow(
  datasetId: string,
  value: number,
  extra: { note?: string; sample?: string } = {},
) {
  const row = (
    await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS],
    )
  ).rows[0].id as string

  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,ordinal,numeric_value) values($1,$2,0,$3)`,
    [row, F_VALUE, value],
  )

  if (extra.note)
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,ordinal,text_value) values($1,$2,0,$3)`,
      [row, F_NOTE, extra.note],
    )

  if (extra.sample)
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,ordinal,reference_id) values($1,$2,0,$3)`,
      [row, F_LINK, extra.sample],
    )

  return row
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  for (const user of [MEMBER, INSIDER, OUTSIDER])
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'mtr','MTR'),($2,'mtr-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role)
     values($1,$2,'member'),($1,$3,'member'),($4,$5,'member')`,
    [WS, MEMBER, INSIDER, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values
       ($1,$3,'MTRA','Open',$4),($2,$3,'MTRB','Closed',$4)`,
    [OPEN, CLOSED, WS, MEMBER],
  )
  await migrator.query(
    `insert into api.project_access(workspace_id,project_id,user_id,can_view,granted_by_user_id)
     values($1,$2,$3,true,$3),($1,$2,$4,true,$3),($1,$5,$3,true,$3),($1,$5,$4,true,$3)
     on conflict do nothing`,
    [WS, OPEN, MEMBER, INSIDER, CLOSED],
  )
  await migrator.query(
    `delete from api.project_access where project_id=$1 and user_id=$2`,
    [CLOSED, INSIDER],
  )
  await migrator.query(
    `insert into api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle)
     values($1,$2,'mtr_table','MTR table','draft')`,
    [SCHEMA, WS],
  )
  // Version 1 has the value; version 2 adds a note. Fields keep their ids.
  await migrator.query(
    `insert into api.dataset_schema_versions(id,schema_id,version,lifecycle) values($1,$3,1,'draft'),($2,$3,2,'draft')`,
    [V1, V2, SCHEMA],
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields(id,schema_version_id,field_id,key,label,logical_type,nullable,validation,display_order)
     values(gen_random_uuid(),$1,$3,'value','Value','decimal',true,'{}',1),
           (gen_random_uuid(),$2,$3,'value','Value','decimal',true,'{}',1),
           (gen_random_uuid(),$2,$4,'note','Note','text',true,'{}',2)`,
    [V1, V2, F_VALUE, F_NOTE],
  )
  await migrator.query(
    `insert into api.dataset_schema_version_fields(id,schema_version_id,field_id,key,label,logical_type,nullable,validation,relationship,display_order)
     values(gen_random_uuid(),$1,$2,'sample','Sample','reference',true,'{}',
            '{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}',3)`,
    [V2, F_LINK],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id)
     values($1,$2,'sample','SMP-9001','Sample',$3)`,
    [SAMPLE, WS, MEMBER],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id in ($1,$2)`,
    [V1, V2],
  )
  await migrator.query(
    `insert into api.datasets(id,workspace_id,schema_version_id,name,primary_project_id) values
       ($1,$3,$4,'Open dataset',$5),($2,$3,$6,'Closed dataset',$7)`,
    [DS_OPEN, DS_CLOSED, WS, V1, OPEN, V2, CLOSED],
  )
  await addRow(DS_OPEN, 1.5)
  await addRow(DS_OPEN, 2.5)
  await addRow(DS_CLOSED, 9.5, { note: 'secret', sample: SAMPLE })
  await addRow(DS_CLOSED, 8.5)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('a measurement table read across datasets', () => {
  it('reads only the datasets the caller can open, and says where each row came from', async () => {
    const outsider = await actor(MEMBER)
    const result = await rows(outsider)

    expect(result.totalCount).toBe(4)
    expect(result.sources).toHaveLength(2)

    const visible = await actor(INSIDER)
    const narrowed = await rows(visible)

    expect(narrowed.totalCount).toBe(2)
    expect(narrowed.sources.map((s: { name: string }) => s.name)).toEqual([
      'Open dataset',
    ])
    expect(narrowed.rows[0]).toMatchObject({
      datasetId: DS_OPEN,
      datasetName: 'Open dataset',
      live: true,
      datasetVersionId: null,
      snapshotLabel: null,
    })
    expect(JSON.stringify(narrowed)).not.toContain('secret')
  })

  it('does not say whether a hidden dataset exists', async () => {
    const visible = await actor(INSIDER)

    const hidden = rows(visible, { datasets: [DS_CLOSED] })
    const unknown = rows(visible, {
      datasets: ['16000000-0000-4000-8000-0000000000ff'],
    })

    await expect(hidden).rejects.toMatchObject({ code: '42501' })
    await expect(unknown).rejects.toMatchObject({ code: '42501' })
    await expect(
      visible.query(`select api.measurement_table_sources($1)`, [SCHEMA]),
    ).resolves.toMatchObject({
      rows: [
        {
          measurement_table_sources: [
            expect.objectContaining({ datasetId: DS_OPEN }),
          ],
        },
      ],
    })
  })

  it('refuses another workspace’s table', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)

    await expect(rows(outsider)).rejects.toMatchObject({ code: '42501' })
  })

  it('lines up datasets on an older version under the latest columns', async () => {
    const member = await actor(MEMBER)
    const result = await rows(member, {}, 200)

    expect(result.columns.map((c: { key: string }) => c.key)).toEqual([
      'value',
      'note',
      'sample',
    ])

    const old = result.rows.find(
      (row: { datasetId: string }) => row.datasetId === DS_OPEN,
    )
    const current = result.rows.find(
      (row: { datasetId: string; values: { note: string | null } }) =>
        row.datasetId === DS_CLOSED && row.values.note,
    )

    expect(old.schemaVersion).toBe(1)
    expect(old.values.note ?? null).toBeNull()
    expect(current.values).toMatchObject({
      value: 9.5,
      note: 'secret',
      sample: SAMPLE,
    })
  })

  it('reads snapshots as they were, however the dataset changes after', async () => {
    const member = await actor(MEMBER)
    const row = await addRow(DS_OPEN, 3.5)

    const snapshot = (
      await migrator.query(
        `insert into api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label)
         values($1,$2,$3,1,'Frozen') returning id`,
        [DS_OPEN, WS, V1],
      )
    ).rows[0].id as string

    await migrator.query(
      `insert into api.dataset_version_rows(dataset_version_id,row_id,revision)
       select $1,r.id,1 from api.dataset_rows r where r.dataset_id=$2`,
      [snapshot, DS_OPEN],
    )
    await migrator.query(
      `insert into api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,numeric_value)
       select $1,v.row_id,v.field_id,0,v.numeric_value from api.dataset_row_values v
        join api.dataset_rows r on r.id=v.row_id where r.dataset_id=$2`,
      [snapshot, DS_OPEN],
    )
    // The live dataset moves on after the snapshot was taken.
    await migrator.query(
      `update api.dataset_row_values set numeric_value=99 where row_id=$1`,
      [row],
    )

    const frozen = await rows(member, { mode: 'latest_snapshot' })

    expect(frozen.totalCount).toBe(3)
    expect(frozen.skipped).toEqual([
      expect.objectContaining({ datasetId: DS_CLOSED, reason: 'no_snapshot' }),
    ])
    expect(frozen.rows.every((r: { live: boolean }) => !r.live)).toBe(true)
    expect(
      frozen.rows
        .map((r: { values: { value: number } }) => r.values.value)
        .sort(),
    ).toEqual([1.5, 2.5, 3.5])
    expect(frozen.rows[0]).toMatchObject({
      datasetVersionId: snapshot,
      snapshotLabel: 'Frozen',
    })

    const live = await rows(member, { datasets: [DS_OPEN] })

    expect(
      live.rows
        .map((r: { values: { value: number } }) => r.values.value)
        .sort((a: number, b: number) => a - b),
    ).toEqual([1.5, 2.5, 99])

    const pinned = await rows(member, { pins: { [DS_OPEN]: snapshot } })

    expect(pinned.totalCount).toBe(5)
    expect(
      pinned.sources.find(
        (s: { datasetId: string }) => s.datasetId === DS_OPEN,
      ),
    ).toMatchObject({ live: false, snapshotLabel: 'Frozen' })

    await expect(
      rows(member, { pins: { [DS_OPEN]: DS_CLOSED } }),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('filters, sorts and finds the rows that link to a record', async () => {
    const member = await actor(MEMBER)

    const big = await rows(member, {
      datasets: [DS_OPEN],
      filters: [{ field: 'value', operator: 'gte', value: 2 }],
      sort: { field: 'value', direction: 'desc' },
    })

    expect(
      big.rows.map((r: { values: { value: number } }) => r.values.value),
    ).toEqual([99, 2.5])

    const linked = await rows(member, { recordId: SAMPLE })

    expect(linked.totalCount).toBe(1)
    expect(linked.rows[0]).toMatchObject({ datasetId: DS_CLOSED })
    expect((await rows(member, { recordId: DS_OPEN })).totalCount).toBe(0)

    await expect(
      rows(member, { filters: [{ field: 'nope', operator: 'eq', value: 1 }] }),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(rows(member, { mode: 'weekly' })).rejects.toMatchObject({
      code: '22023',
    })
  })
})
