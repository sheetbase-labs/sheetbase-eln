import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '02000000-0000-4000-8000-000000000001'
const WS_B = '02000000-0000-4000-8000-000000000002'
const OWNER_A = 'dataset-owner-a'
const MEMBER_A = 'dataset-member-a'
const OWNER_B = 'dataset-owner-b'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let datasetId: string
let titreFieldId: string

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: workspaceId }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER_A}','Owner A','dataset-owner-a@test.invalid',true),
      ('${MEMBER_A}','Member A','dataset-member-a@test.invalid',true),
      ('${OWNER_B}','Owner B','dataset-owner-b@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS_A}','dataset-a','Dataset A'),('${WS_B}','dataset-b','Dataset B');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS_A}','${OWNER_A}','owner'),('${WS_A}','${MEMBER_A}','member'),
      ('${WS_B}','${OWNER_B}','owner');
  `)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('canonical Dataset metadata', () => {
  it('creates an independently addressable Dataset bound to an immutable schema version', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const schema = (
      await owner.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name,created_by_user_id)
         values($1,'assay_result','Assay result',$2) returning id`,
        [WS_A, OWNER_A],
      )
    ).rows[0]
    const version = (
      await owner.query(
        `insert into api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id)
         values($1,1,'draft',$2) returning id`,
        [schema.id, OWNER_A],
      )
    ).rows[0]
    const field = await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,display_order)
       values($1,gen_random_uuid(),'titre','Titre','decimal',1) returning field_id`,
      [version.id],
    )
    await owner.query(
      `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
      [version.id],
    )
    const dataset = await owner.query(
      `insert into api.datasets(workspace_id,schema_version_id,name,created_by_user_id)
       values($1,$2,'Stability results',$3) returning id,revision,lifecycle`,
      [WS_A, version.id, OWNER_A],
    )

    expect(dataset.rows[0]).toMatchObject({
      revision: '1',
      lifecycle: 'active',
    })
    datasetId = dataset.rows[0].id
    titreFieldId = field.rows[0].field_id
    expect(
      await owner.query(
        `select f.key from api.datasets d
         join api.dataset_schema_versions v on v.id=d.schema_version_id
         join api.dataset_schema_version_fields f on f.schema_version_id=v.id
         where d.id=$1`,
        [dataset.rows[0].id],
      ),
    ).toMatchObject({ rows: [{ key: 'titre' }] })
  })

  it('persists stable typed values and rejects mismatched storage types', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const row = await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS_A],
    )
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,numeric_value) values($1,$2,100000000)`,
      [row.rows[0].id, titreFieldId],
    )
    await expect(
      migrator.query(
        `insert into api.dataset_row_values(row_id,field_id,text_value) values($1,$2,'not numeric')`,
        [row.rows[0].id, titreFieldId],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('validates and atomically commits an idempotent typed row batch', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const firstRowId = '02000000-0000-4000-8000-000000000101'
    const secondRowId = '02000000-0000-4000-8000-000000000102'
    const batch = [
      {
        operation: 'create',
        rowId: firstRowId,
        values: { [titreFieldId]: 125000000 },
      },
      {
        operation: 'create',
        rowId: secondRowId,
        values: { [titreFieldId]: 135000000 },
      },
    ]

    const invalid = (
      await owner.query(
        `select api.validate_dataset_row_batch($1,$2,$3::jsonb) result`,
        [
          datasetId,
          1,
          JSON.stringify([
            batch[0],
            {
              ...batch[1],
              values: { [titreFieldId]: 'not a number' },
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(invalid).toMatchObject({ ok: false })
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowIndex: 2,
          rowId: secondRowId,
          fieldId: titreFieldId,
          code: 'invalid_value_type',
        }),
      ]),
    )
    expect(
      (await owner.query(`select * from api.dataset_rows where dataset_id=$1`, [
        datasetId,
      ])).rows,
    ).toHaveLength(1)

    const committed = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [datasetId, 1, JSON.stringify(batch), 'paste-001'],
      )
    ).rows[0].result
    expect(committed).toMatchObject({
      ok: true,
      datasetId,
      datasetRevision: 2,
      idempotent: false,
    })
    expect(committed.rows).toEqual([
      { rowId: firstRowId, revision: 1, operation: 'create' },
      { rowId: secondRowId, revision: 1, operation: 'create' },
    ])
    expect(
      (
        await owner.query(
          `select numeric_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
          [firstRowId, titreFieldId],
        )
      ).rows,
    ).toEqual([{ numeric_value: '125000000' }])

    const retried = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [datasetId, 1, JSON.stringify(batch), 'paste-001'],
      )
    ).rows[0].result
    expect(retried).toMatchObject({ ok: true, datasetRevision: 2, idempotent: true })
    await expect(
      owner.query(`select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)`, [
        datasetId,
        2,
        JSON.stringify(batch),
        'paste-001',
      ]),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects stale row writes without changing another row in the batch', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const result = (
      await owner.query(
        `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4) result`,
        [
          datasetId,
          2,
          JSON.stringify([
            {
              operation: 'update',
              rowId: '02000000-0000-4000-8000-000000000101',
              expectedRevision: 1,
              values: { [titreFieldId]: 140000000 },
            },
            {
              operation: 'update',
              rowId: '02000000-0000-4000-8000-000000000102',
              expectedRevision: 99,
              values: { [titreFieldId]: 150000000 },
            },
          ]),
          'paste-stale',
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({ ok: false, idempotent: false })
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'stale_row_revision' }),
      ]),
    )
    expect(
      (
        await owner.query(
          `select numeric_value from api.dataset_row_values where row_id=$1 and field_id=$2`,
          ['02000000-0000-4000-8000-000000000101', titreFieldId],
        )
      ).rows,
    ).toEqual([{ numeric_value: '125000000' }])
  })

  it('returns a bounded canonical Dataset window with typed field filtering', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const result = (
      await owner.query(
        `select api.query_dataset_rows($1,$2::jsonb,$3,$4) result`,
        [
          datasetId,
          JSON.stringify({
            filters: [
              { fieldId: titreFieldId, operator: 'gte', value: 130000000 },
            ],
            sort: { fieldId: titreFieldId, direction: 'desc' },
          }),
          1,
          0,
        ],
      )
    ).rows[0].result
    expect(result).toMatchObject({
      datasetId,
      offset: 0,
      limit: 1,
      totalCount: 1,
      hasMore: false,
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        rowId: '02000000-0000-4000-8000-000000000102',
        revision: 1,
        values: { [titreFieldId]: 135000000 },
      }),
    ])
    await expect(
      owner.query(`select api.query_dataset_rows($1,$2::jsonb,$3,$4)`, [
        datasetId,
        JSON.stringify({
          filters: [
            { fieldId: titreFieldId, operator: 'contains', value: '13' },
          ],
        }),
        10,
        0,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('keeps Dataset and schema metadata workspace-isolated', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const member = await actor(MEMBER_A, WS_A)
    const outsider = await actor(OWNER_B, WS_B)

    expect(
      (await member.query(`select * from api.datasets`)).rows,
    ).toHaveLength(1)
    expect((await outsider.query(`select * from api.datasets`)).rows).toEqual(
      [],
    )
    await expect(
      member.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name)
         values($1,'member_schema','Member schema')`,
        [WS_A],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      (await owner.query(`select * from api.dataset_schema_definitions`)).rows,
    ).toHaveLength(1)
  })

  it('rejects cross-workspace Dataset schema, row, and primary-project bindings at the database boundary', async () => {
    const ownerA = await actor(OWNER_A, WS_A)
    const ownerB = await actor(OWNER_B, WS_B)
    const otherSchema = (
      await ownerB.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name,created_by_user_id)
         values($1,'other_assay','Other assay',$2) returning id`,
        [WS_B, OWNER_B],
      )
    ).rows[0]
    const otherVersion = (
      await ownerB.query(
        `insert into api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id)
         values($1,1,'draft',$2) returning id`,
        [otherSchema.id, OWNER_B],
      )
    ).rows[0]
    await expect(
      ownerA.query(
        `insert into api.datasets(workspace_id,schema_version_id,name)
         values($1,$2,'invalid schema workspace')`,
        [WS_A, otherVersion.id],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      migrator.query(
        `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2)`,
        [datasetId, WS_B],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    const projectB = (
      await migrator.query(
        `insert into api.projects(workspace_id,key,title) values($1,'other-project','Other project') returning id`,
        [WS_B],
      )
    ).rows[0]
    await expect(
      ownerA.query(
        `update api.datasets set primary_project_id=$1 where id=$2`,
        [projectB.id, datasetId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('does not permit a publisher to mutate an active Schema Version or its fields', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `select schema_version_id from api.datasets where id=$1`,
      [datasetId],
    )
    await expect(
      owner.query(
        `update api.dataset_schema_versions set version=2 where id=$1`,
        [rows[0].schema_version_id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      owner.query(
        `update api.dataset_schema_version_fields set label='Changed' where schema_version_id=$1`,
        [rows[0].schema_version_id],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('creates an immutable, schema-pinned Dataset Version unaffected by later live edits', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const label = `Submission evidence ${crypto.randomUUID()}`
    const snapshot = (
      await owner.query(
        `select (api.snapshot_dataset($1,$2,$3)).*`,
        [datasetId, 2, label],
      )
    ).rows[0]
    expect(snapshot).toMatchObject({
      dataset_id: datasetId,
      source_dataset_revision: '2',
      label,
    })

    await owner.query(
      `select api.commit_dataset_row_batch($1,$2,$3::jsonb,$4)`,
      [
        datasetId,
        2,
        JSON.stringify([
          {
            operation: 'update',
            rowId: '02000000-0000-4000-8000-000000000101',
            expectedRevision: 1,
            values: { [titreFieldId]: 140000000 },
          },
        ]),
        'after-snapshot',
      ],
    )
    const historical = (
      await owner.query(`select api.query_dataset_version_rows($1,100,0) result`, [
        snapshot.id,
      ])
    ).rows[0].result
    expect(historical).toMatchObject({
      datasetVersionId: snapshot.id,
      schemaVersionId: snapshot.schema_version_id,
      sourceDatasetRevision: 2,
    })
    expect(historical.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowId: '02000000-0000-4000-8000-000000000101',
          values: { [titreFieldId]: 125000000 },
        }),
      ]),
    )
    await expect(
      migrator.query(`update api.dataset_versions set label='changed' where id=$1`, [
        snapshot.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
  })
})
