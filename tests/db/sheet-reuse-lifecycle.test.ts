import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rowIdentityKey } from '../../src/lib/row-identity'
import { prepareTestDatabase } from './helpers'

const WS = '35000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-reuse-owner'
const PARAMETER = '35000000-0000-4000-8000-000000000010'
const BINDING = '35000000-0000-4000-8000-000000000011'
const COLUMN = '35000000-0000-4000-8000-000000000012'
const FIELD = '35000000-0000-4000-8000-000000000013'
const LOCAL_FIELD = '35000000-0000-4000-8000-000000000014'

let migrator: Client
let owner: Client
let datasetId: string
let definitionId: string
let versionOneId: string
let versionTwoId: string

function configuration(label = 'Sample') {
  return {
    formatVersion: 1,
    parameters: [
      {
        id: PARAMETER,
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId: '' },
        },
        constraints: {},
      },
    ],
    bindings: [{ id: BINDING, key: 'source', parameterId: PARAMETER }],
    rowIdentity: { kind: 'source', columnIds: [COLUMN] },
    joins: [],
    columns: [
      {
        id: COLUMN,
        field: {
          fieldId: COLUMN,
          key: 'sample',
          label,
          description: null,
          logicalType: 'reference',
          nullable: false,
          defaultValue: null,
          cardinality: 'one',
          quantity: null,
          validation: {},
          category: null,
          relationship: {
            target: { kind: 'model', modelKey: 'sample' },
            cardinality: 'one',
          },
          computation: { mode: 'stored' },
          lifecycle: 'active',
        },
        source: { kind: 'bound', bindingId: BINDING, sourceFieldId: FIELD },
      },
    ],
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: [COLUMN],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
  }
}

function state() {
  return {
    bindings: [],
    localFields: [
      {
        fieldId: LOCAL_FIELD,
        key: 'observation',
        label: 'Observation',
        description: null,
        logicalType: 'text',
        nullable: true,
        defaultValue: null,
        cardinality: 'one',
        quantity: null,
        validation: {},
        category: null,
        relationship: null,
        computation: { mode: 'stored' },
        lifecycle: 'active',
      },
    ],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

async function instantiate(name: string, versionId = versionOneId) {
  const created = (
    await owner.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,$2,null,$3,null,null,$4::jsonb,$5::jsonb)) result`,
      [
        WS,
        name,
        versionId,
        JSON.stringify(state()),
        JSON.stringify([
          { parameterId: PARAMETER, kind: 'dataset', datasetId },
        ]),
      ],
    )
  ).rows[0].result
  return (
    await owner.query(
      `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
      [created.id],
    )
  ).rows[0].result
}

async function composed(instanceId: string) {
  return (
    await owner.query(`select api.query_sheet_instance_rows($1) result`, [
      instanceId,
    ])
  ).rows[0].result
}

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','sheet-reuse@test.invalid',true)`,
    [OWNER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-reuse','Sheet reuse')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  await owner.query('set role authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS }),
  ])

  const schemaId = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,'reuse_source','Reuse source') returning id`,
      [WS],
    )
  ).rows[0].id
  const schemaVersionId = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schemaId],
    )
  ).rows[0].id
  await migrator.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,nullable,cardinality,relationship,lifecycle,display_order)
     values($1,$2,'sample','Sample','reference',false,'one',$3::jsonb,'active',0)`,
    [
      schemaVersionId,
      FIELD,
      JSON.stringify({
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      }),
    ],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [schemaVersionId],
  )
  datasetId = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Reusable dataset') returning id`,
      [WS, schemaVersionId],
    )
  ).rows[0].id
  const sampleId = (
    await migrator.query(
      `insert into api.records(workspace_id,kind,identifier,title,created_by_user_id) values($1,'sample','REUSE-1','Reusable sample',$2) returning id`,
      [WS, OWNER],
    )
  ).rows[0].id
  const rowId = (
    await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS],
    )
  ).rows[0].id
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,reference_id) values($1,$2,$3)`,
    [rowId, FIELD, sampleId],
  )

  const config = configuration()
  config.parameters[0].type.contract.schemaVersionId = schemaVersionId
  const created = (
    await owner.query(
      `select api.create_sheet_definition($1,'reuse_definition','Reuse Definition',null,$2::jsonb) result`,
      [WS, JSON.stringify(config)],
    )
  ).rows[0].result
  definitionId = created.definition.id
  versionOneId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [created.version.id],
    )
  ).rows[0].result.id
  const changed = configuration('Renamed sample')
  changed.parameters[0].type.contract.schemaVersionId = schemaVersionId
  versionTwoId = (
    await owner.query(
      `select to_jsonb(api.create_sheet_definition_version($1,1,$2::jsonb)) result`,
      [definitionId, JSON.stringify(changed)],
    )
  ).rows[0].result.id
  versionTwoId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [versionTwoId],
    )
  ).rows[0].result.id
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

describe('CORE-03.15 Sheet reuse and lifecycle invariants', () => {
  it('reuses one Dataset in independent Instances without silently upgrading their Definition version', async () => {
    const first = await instantiate('First')
    const second = await instantiate('Second')

    expect(first.id).not.toBe(second.id)
    expect(first.source_definition_version_id).toBe(versionOneId)
    expect(second.source_definition_version_id).toBe(versionOneId)
    expect(first.state.bindings[0].datasetId).toBe(datasetId)
    expect(second.state.bindings[0].datasetId).toBe(datasetId)
    expect(versionTwoId).not.toBe(versionOneId)
    expect((await composed(first.id)).definitionVersionId).toBe(versionOneId)
  })

  it('keeps deliberate references to one Instance on its same durable local data', async () => {
    const shared = await instantiate('Shared')
    const result = await composed(shared.id)
    const identityValues = result.rows[0].identityValues
    const rowKey = rowIdentityKey(result.identity, identityValues)
    const updated = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,2,$2,'[]'::jsonb,$3::jsonb,$4::jsonb)) result`,
        [
          shared.id,
          crypto.randomUUID(),
          JSON.stringify([
            {
              kind: 'composed',
              rowKey,
              identityValues,
              compositionOffset: 0,
            },
          ]),
          JSON.stringify([{ rowKey, fieldId: LOCAL_FIELD, value: 'shared' }]),
        ],
      )
    ).rows[0].result

    const consumers = await Promise.all(
      [shared.id, shared.id].map(async (instanceId) =>
        owner.query(`select state from api.sheet_instances where id=$1`, [
          instanceId,
        ]),
      ),
    )
    expect(updated.state.localValues[rowKey][LOCAL_FIELD]).toBe('shared')
    expect(
      consumers.map(
        (consumer) => consumer.rows[0].state.localValues[rowKey][LOCAL_FIELD],
      ),
    ).toEqual(['shared', 'shared'])
  })

  it('duplicates only Instance-owned state while retaining the bound Dataset reference', async () => {
    const source = await instantiate('Source')
    const copy = (
      await owner.query(
        `select to_jsonb(api.duplicate_sheet_instance($1,$2,'Copy')) result`,
        [source.id, source.revision],
      )
    ).rows[0].result

    expect(copy.id).not.toBe(source.id)
    expect(copy.state.bindings).toEqual(source.state.bindings)
    expect(copy.state.bindings[0].datasetId).toBe(datasetId)
    expect(
      (
        await owner.query(
          `select count(*)::integer count from api.datasets where id=$1`,
          [datasetId],
        )
      ).rows[0].count,
    ).toBe(1)
  })

  it('blocks new use of retired Definitions while existing Instances and archived sources remain resolvable', async () => {
    const existing = await instantiate('Existing')
    await migrator.query(
      `update api.datasets set lifecycle='archived' where id=$1`,
      [datasetId],
    )
    await expect(instantiate('Archived input')).rejects.toMatchObject({
      code: 'SB074',
    })
    expect((await composed(existing.id)).rows).toHaveLength(1)

    const revision = (
      await owner.query(
        `select revision from api.sheet_definitions where id=$1`,
        [definitionId],
      )
    ).rows[0].revision
    await owner.query(`select api.retire_sheet_definition($1,$2)`, [
      definitionId,
      revision,
    ])

    await expect(instantiate('Blocked')).rejects.toMatchObject({
      code: 'SB074',
    })
    expect((await composed(existing.id)).rows).toHaveLength(1)
  })
})
