/**
 * A measurement table column can link to a record of any record type: a
 * built-in kind (sample), a record type the workspace defined (cell_bank) or
 * one of its subtypes. The value stored is the record's id; the database
 * refuses a record of another type, another workspace, or a deleted one, and
 * refuses to publish a column that links to a type that does not exist.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '15000000-0000-4000-8000-000000000001'
const WS_OTHER = '15000000-0000-4000-8000-000000000002'
const OWNER = 'record-link-owner'
const OTHER_OWNER = 'record-link-other'

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

async function record(
  workspaceId: string,
  kind: string,
  identifier: string,
  extra: { deleted?: boolean; modelVersionId?: string } = {},
) {
  return (
    await migrator.query(
      `insert into api.records(workspace_id,kind,identifier,title,created_by_user_id,deleted_at,model_version_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        workspaceId,
        kind,
        identifier,
        `${identifier} title`,
        OWNER,
        extra.deleted ? new Date() : null,
        extra.modelVersionId ?? null,
      ],
    )
  ).rows[0].id as string
}

/** A published version of a record type the workspace defined. */
async function publishedVersion(workspaceId: string, key: string) {
  return (
    await migrator.query(
      `insert into api.record_model_versions(workspace_id,model_id,version,lifecycle)
       select $1,id,1,'published' from api.record_models where workspace_id=$1 and key=$2 returning id`,
      [workspaceId, key],
    )
  ).rows[0].id as string
}

/** A published measurement table with one link column to `modelKey`. */
async function linkedDataset(modelKey: string, publish = true) {
  const key = `links_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Linked') returning id`,
      [WS, key],
    )
  ).rows[0]

  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema.id],
    )
  ).rows[0]

  const field = (
    await migrator.query(
      `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,relationship,display_order)
       values ($1,gen_random_uuid(),'target','Target','reference',true,$2::jsonb,1) returning field_id`,
      [
        version.id,
        JSON.stringify({
          target: { kind: 'model', modelKey },
          cardinality: 'one',
        }),
      ],
    )
  ).rows[0]

  if (!publish)
    return {
      versionId: version.id as string,
      fieldId: field.field_id as string,
    }

  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
    [version.id],
  )

  const dataset = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Linked') returning id`,
      [WS, version.id],
    )
  ).rows[0]

  return {
    datasetId: dataset.id as string,
    versionId: version.id as string,
    fieldId: field.field_id as string,
  }
}

async function check(
  client: Client,
  datasetId: string,
  fieldId: string,
  values: string[],
) {
  const result = (
    await client.query(
      `select api.validate_dataset_row_batch($1,1,$2::jsonb) result`,
      [
        datasetId,
        JSON.stringify(
          values.map((value) => ({
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: { [fieldId]: value },
          })),
        ),
      ],
    )
  ).rows[0].result

  return result.errors as Array<{ rowIndex: number; code: string }>
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','record-link-owner@test.invalid',true),
      ($2,'Other','record-link-other@test.invalid',true)`,
    [OWNER, OTHER_OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'record-link-a','Links A'),($2,'record-link-b','Links B')`,
    [WS, WS_OTHER],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$3,'owner'),($2,$4,'owner')`,
    [WS, WS_OTHER, OWNER, OTHER_OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('a measurement table column that links to a record type', () => {
  it('takes a record the lab’s own record type defines, and no other', async () => {
    const owner = await actor(OWNER, WS)

    await migrator.query(
      `insert into api.record_models(workspace_id,key,name,identifier_prefix,lifecycle,parent_key,created_by_user_id)
       values ($1,'cell_bank','Cell bank','CB','published','sample',$2)`,
      [WS, OWNER],
    )
    const bankVersion = await publishedVersion(WS, 'cell_bank')
    const bank = await record(WS, 'sample', 'CB-0001', {
      modelVersionId: bankVersion,
    })
    const sample = await record(WS, 'sample', 'SMP-0001')
    const gone = await record(WS, 'sample', 'CB-0002', {
      deleted: true,
      modelVersionId: bankVersion,
    })
    const elsewhere = await record(WS_OTHER, 'sample', 'CB-0003')
    const { datasetId, fieldId } = await linkedDataset('cell_bank')

    const errors = await check(owner, datasetId!, fieldId, [
      bank,
      sample,
      gone,
      elsewhere,
    ])

    expect(errors.map((error) => [error.rowIndex, error.code])).toEqual([
      [2, 'invalid_reference'],
      [3, 'invalid_reference'],
      [4, 'invalid_reference'],
    ])
  })

  it('takes a record of a subtype, which keeps the kind of the type above it', async () => {
    const owner = await actor(OWNER, WS)

    const model = (
      await migrator.query(
        `insert into api.record_models(workspace_id,key,name,identifier_prefix,lifecycle,parent_key,created_by_user_id)
         values ($1,'culture_run','Culture run','CCR','published','experiment',$2) returning id`,
        [WS, OWNER],
      )
    ).rows[0]

    const version = (
      await migrator.query(
        `insert into api.record_model_versions(workspace_id,model_id,version,lifecycle) values ($1,$2,1,'published') returning id`,
        [WS, model.id],
      )
    ).rows[0]

    const run = await record(WS, 'experiment', 'EXP-9001', {
      modelVersionId: version.id,
    })

    const plain = await record(WS, 'experiment', 'EXP-9002')
    const { datasetId, fieldId } = await linkedDataset('culture_run')
    const errors = await check(owner, datasetId!, fieldId, [run, plain])

    expect(errors.map((error) => [error.rowIndex, error.code])).toEqual([
      [2, 'invalid_reference'],
    ])
  })

  it('stores the record’s id and reads it back', async () => {
    const owner = await actor(OWNER, WS)
    const sample = await record(WS, 'sample', 'SMP-0100')
    const { datasetId, fieldId } = await linkedDataset('sample')
    const rowId = crypto.randomUUID()

    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,$3)`,
      [
        datasetId,
        JSON.stringify([
          { operation: 'create', rowId, values: { [fieldId]: sample } },
        ]),
        `links-${rowId}`,
      ],
    )

    const stored = await migrator.query(
      `select reference_id from api.dataset_row_values where row_id=$1 and field_id=$2`,
      [rowId, fieldId],
    )

    expect(stored.rows).toEqual([{ reference_id: sample }])
  })

  it('refuses to publish a column that links to a record type that does not exist', async () => {
    const { versionId } = await linkedDataset('no_such_type', false)

    await expect(
      migrator.query(
        `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
        [versionId],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('finds the records of the lab’s own record type to pick from', async () => {
    const owner = await actor(OWNER, WS)

    const found = (
      await owner.query(
        `select api.search_sheet_records('cell_bank','CB-0001',10,false) result`,
      )
    ).rows[0].result

    expect(found.map((hit: { identifier: string }) => hit.identifier)).toEqual([
      'CB-0001',
    ])

    await expect(
      owner.query(
        `select api.search_sheet_records('no_such_type','',10,false)`,
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('opens in a sheet when the first columns can be empty', async () => {
    const owner = await actor(OWNER, WS)
    const sample = await record(WS, 'sample', 'SMP-0200')

    const key = `optional_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

    const schema = (
      await migrator.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,'Optional first') returning id`,
        [WS, key],
      )
    ).rows[0]

    const version = (
      await migrator.query(
        `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
        [schema.id],
      )
    ).rows[0]

    const link = JSON.stringify({
      target: { kind: 'model', modelKey: 'sample' },
      cardinality: 'one',
    })

    // The link and the label are optional; plate and well always hold a value.
    const fields: Array<[string, string, string, boolean, string | null]> = [
      ['sample', 'Sample', 'reference', true, link],
      ['label', 'Label', 'text', true, null],
      ['plate', 'Plate', 'text', false, null],
      ['well', 'Well', 'text', false, null],
    ]

    const ids: Record<string, string> = {}

    for (const [
      index,
      [fieldKey, label, type, nullable, relationship],
    ] of fields.entries()) {
      ids[fieldKey] = (
        await migrator.query(
          `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,relationship,display_order)
           values ($1,gen_random_uuid(),$2,$3,$4,$5,$6::jsonb,$7) returning field_id`,
          [version.id, fieldKey, label, type, nullable, relationship, index],
        )
      ).rows[0].field_id
    }

    await migrator.query(
      `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
      [version.id],
    )

    const dataset = (
      await migrator.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Optional first') returning id`,
        [WS, version.id],
      )
    ).rows[0]

    await owner.query(
      `select api.commit_dataset_row_batch($1,1,$2::jsonb,'optional-first')`,
      [
        dataset.id,
        JSON.stringify([
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: {
              [ids.sample]: sample,
              [ids.plate]: 'P1',
              [ids.well]: 'A1',
            },
          },
          {
            operation: 'create',
            rowId: crypto.randomUUID(),
            values: {
              [ids.label]: 'S-003',
              [ids.plate]: 'P1',
              [ids.well]: 'A2',
            },
          },
        ]),
      ],
    )

    const opened = (
      await owner.query(`select api.open_dataset_in_sheet($1) result`, [
        dataset.id,
      ])
    ).rows[0].result

    // Rows are told apart by the columns that are never empty.
    expect(opened.instance.state.resolvedRowIdentity.columnIds).toEqual([
      ids.plate,
      ids.well,
    ])

    const rows = (
      await owner.query(
        `select api.query_sheet_instance_rows($1,50,0) result`,
        [opened.instance.id],
      )
    ).rows[0].result

    expect(rows.rows).toHaveLength(2)
  })
})
