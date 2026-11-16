import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '14000000-0000-4000-8000-000000000001'
const WS_OTHER = '14000000-0000-4000-8000-000000000002'
const OWNER = 'open-sheet-owner'
const MEMBER = 'open-sheet-member'
const OUTSIDER = 'open-sheet-outsider'
const PROJECT = '14000000-0000-4000-8000-000000000020'
const NOTEBOOK = '14000000-0000-4000-8000-000000000030'

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

/** A dataset made from a file: a schema with columns, and no sheet definition. */
async function datasetFromFile(workspaceId: string, name: string) {
  const key = `from_file_${crypto.randomUUID().replaceAll('-', '')}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$3) returning id`,
      [workspaceId, key, name],
    )
  ).rows[0]

  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]

  const columns: Array<[string, string, string, object | null]> = [
    ['sample', 'Sample', 'text', null],
    ['dilution', 'Dilution', 'integer', null],
    [
      'od450',
      'OD450',
      'decimal',
      { kind: 'quantity', symbol: 'AU', dimension: 'AU', storageUnit: 'AU' },
    ],
  ]

  for (const [index, [fieldKey, label, type, quantity]] of columns.entries()) {
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,quantity,display_order)
       values ($1,gen_random_uuid(),$2,$3,$4,$5,$6)`,
      [version.id, fieldKey, label, type, quantity, index],
    )
  }

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name,primary_project_id) values($1,$2,$3,$4) returning id`,
      [workspaceId, version.id, name, PROJECT],
    )
  ).rows[0]

  return {
    datasetId: dataset.id as string,
    schemaVersionId: version.id as string,
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','open-sheet-owner@test.invalid',true),
      ($2,'Member','open-sheet-member@test.invalid',true),
      ($3,'Outsider','open-sheet-outsider@test.invalid',true)`,
    [OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'open-sheet-a','Open sheet A'),($2,'open-sheet-b','Open sheet B')`,
    [WS, WS_OTHER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($1,$4,'member'),($2,$5,'owner')`,
    [WS, WS_OTHER, OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'open-sheet-project','Open sheet',$3)`,
    [PROJECT, WS, OWNER],
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: MEMBER,
    canView: true,
    canEdit: true,
  })
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id) values ($1,$2,$3,'experiment','OPEN-1','Opened',$4)`,
    [NOTEBOOK, WS, PROJECT, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('opening a dataset in a sheet', () => {
  it('makes the sheet from the dataset’s own columns, with no steward-made definition', async () => {
    const member = await actor(MEMBER, WS)
    const { datasetId, schemaVersionId } = await datasetFromFile(WS, 'ELISA')

    const options = (
      await member.query(`select api.dataset_sheet_options($1) result`, [
        datasetId,
      ])
    ).rows[0].result

    // Nothing a steward made fits, which is why "Open in a sheet" used to stop.
    expect(options).toEqual([])

    const opened = (
      await member.query(
        `select api.open_dataset_in_sheet($1,'ELISA plate',$2) result`,
        [datasetId, NOTEBOOK],
      )
    ).rows[0].result

    expect(opened.instance.name).toBe('ELISA plate')
    expect(opened.instance.notebook_record_id).toBe(NOTEBOOK)
    expect(opened.instance.state.bindings[0]).toMatchObject({
      kind: 'dataset',
      datasetId,
    })
    expect(opened.instance.state.resolvedRowIdentity.kind).toBe('composite')
    expect(opened.block.type).toBe('sheet')

    const definition = (
      await migrator.query(
        `select d.key, v.lifecycle, v.configuration
           from api.sheet_definition_versions v
           join api.sheet_definitions d on d.id = v.definition_id
          where v.id = $1`,
        [opened.definitionVersionId],
      )
    ).rows[0]

    expect(definition.lifecycle).toBe('published')
    expect(definition.configuration.parameters[0].type.contract).toEqual({
      mode: 'exact',
      schemaVersionId,
    })
    expect(
      definition.configuration.columns.map(
        (column: { field: { key: string } }) => column.field.key,
      ),
    ).toEqual(['sample', 'dilution', 'od450'])
  })

  it('writes the definition once per measurement table version and reuses it', async () => {
    const member = await actor(MEMBER, WS)
    const { datasetId } = await datasetFromFile(WS, 'Reused')

    const first = (
      await member.query(`select api.open_dataset_in_sheet($1) result`, [
        datasetId,
      ])
    ).rows[0].result

    const second = (
      await member.query(`select api.open_dataset_in_sheet($1) result`, [
        datasetId,
      ])
    ).rows[0].result

    expect(second.definitionVersionId).toBe(first.definitionVersionId)
    expect(second.instance.id).not.toBe(first.instance.id)
    expect(first.block).toBeNull()
  })

  it('refuses a dataset from another workspace', async () => {
    const outsider = await actor(OUTSIDER, WS_OTHER)
    const { datasetId } = await datasetFromFile(WS, 'Private')

    await expect(
      outsider.query(`select api.open_dataset_in_sheet($1) result`, [
        datasetId,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
