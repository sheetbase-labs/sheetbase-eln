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
        `insert into api.dataset_schema_versions(schema_id,version,lifecycle,published_at,created_by_user_id)
         values($1,1,'active',now(),$2) returning id`,
        [schema.id, OWNER_A],
      )
    ).rows[0]
    const field = await owner.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,display_order)
       values($1,gen_random_uuid(),'titre','Titre','decimal',1) returning field_id`,
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
    const row = await owner.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS_A],
    )
    await owner.query(
      `insert into api.dataset_row_values(row_id,field_id,numeric_value) values($1,$2,100000000)`,
      [row.rows[0].id, titreFieldId],
    )
    await expect(
      owner.query(
        `insert into api.dataset_row_values(row_id,field_id,text_value) values($1,$2,'not numeric')`,
        [row.rows[0].id, titreFieldId],
      ),
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
})
