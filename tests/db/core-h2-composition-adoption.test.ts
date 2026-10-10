import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '10400000-0000-4000-8000-000000000001'
const OTHER_WS = '10400000-0000-4000-8000-000000000002'
const PROJECT = '10400000-0000-4000-8000-000000000003'
const RECORD = '10400000-0000-4000-8000-000000000004'
const OWNER = 'core-h2-owner'
const OTHER = 'core-h2-other'
const SAMPLE_FIELD = '10400000-0000-4000-8000-000000000010'
const COLUMN = '10400000-0000-4000-8000-000000000011'
const PARAMETER = '10400000-0000-4000-8000-000000000012'
const BINDING = '10400000-0000-4000-8000-000000000013'
const LOCAL_ROW = '10400000-0000-4000-8000-000000000014'
const LOCAL_FIELD = '10400000-0000-4000-8000-000000000015'
const CALCULATION = '10400000-0000-4000-8000-000000000016'
const SAMPLE = '10400000-0000-4000-8000-000000000017'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string, workspaceId = WS) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

function localField() {
  return {
    fieldId: LOCAL_FIELD,
    key: 'observation',
    label: 'Observation',
    description: null,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: null,
    validation: {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }
}

function definitionConfiguration(schemaVersionId: string) {
  const field = {
    fieldId: COLUMN,
    key: 'sample',
    label: 'Sample',
    description: null,
    logicalType: 'reference',
    nullable: true,
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
  }
  return {
    formatVersion: 1,
    parameters: [
      {
        id: PARAMETER,
        key: 'results',
        label: 'Results',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId },
        },
        constraints: {},
      },
    ],
    bindings: [{ id: BINDING, key: 'results', parameterId: PARAMETER }],
    rowIdentity: { kind: 'source', columnIds: [COLUMN] },
    joins: [],
    columns: [
      {
        id: COLUMN,
        field,
        source: {
          kind: 'bound',
          bindingId: BINDING,
          sourceFieldId: SAMPLE_FIELD,
        },
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

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','h2-owner@test.invalid',true),
      ('${OTHER}','Other','h2-other@test.invalid',true);
    insert into api.workspaces(id,slug,name) values
      ('${WS}','core-h2','CORE H2'),
      ('${OTHER_WS}','core-h2-other','CORE H2 other');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${OTHER_WS}','${OTHER}','owner');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values
      ('${PROJECT}','${WS}','h2','H2','${OWNER}')`)
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
      values ($1,$2,$3,'experiment','H2-A','Notebook',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id,deleted_at)
      values ($1,$2,'sample','H2-S','Sample',$3,null)`,
    [SAMPLE, WS, OWNER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('H2 ad-hoc Sheet Instance composition adoption', () => {
  it('keeps Instance identity while adopting a published Definition', async () => {
    const owner = await actor(OWNER)
    const created = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,null,$2,null) result`,
        [RECORD, 1],
      )
    ).rows[0].result
    const instanceId = created.instance.id as string
    const blockId = created.block.id as string
    expect(created.instance.source_definition_version_id).toBeNull()
    expect(created.block.payload).toEqual({ instanceId })
    expect(created.instance.state.localFields.length).toBeGreaterThan(0)

    const seeded = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,'[]'::jsonb,$4::jsonb,$5::jsonb)) result`,
        [
          instanceId,
          created.instance.revision,
          crypto.randomUUID(),
          JSON.stringify([{ kind: 'local', rowKey: LOCAL_ROW }]),
          JSON.stringify([
            {
              rowKey: LOCAL_ROW,
              fieldId: created.instance.state.localFields[0].fieldId,
              value: 'seeded',
            },
          ]),
        ],
      )
    ).rows[0].result
    const withObservation = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)) result`,
        [
          instanceId,
          seeded.revision,
          crypto.randomUUID(),
          JSON.stringify([{ operation: 'add', field: localField() }]),
          JSON.stringify([{ kind: 'local', rowKey: LOCAL_ROW }]),
          JSON.stringify([
            {
              rowKey: LOCAL_ROW,
              fieldId: LOCAL_FIELD,
              value: 4.2,
            },
          ]),
        ],
      )
    ).rows[0].result
    const calculated = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_calculations($1,$2,$3,$4::jsonb)) result`,
        [
          instanceId,
          withObservation.revision,
          crypto.randomUUID(),
          JSON.stringify([
            {
              operation: 'add',
              calculation: {
                id: CALCULATION,
                key: 'note_len',
                label: 'Note length',
                lifecycle: 'active',
                outputField: {
                  fieldId: CALCULATION,
                  key: 'note_len',
                  label: 'Note length',
                  description: null,
                  logicalType: 'decimal',
                  nullable: true,
                  defaultValue: null,
                  cardinality: 'one',
                  quantity: null,
                  validation: {},
                  category: null,
                  relationship: null,
                  computation: { mode: 'computed', expressionId: CALCULATION },
                  lifecycle: 'active',
                },
                dependencies: [{ kind: 'local-field', id: LOCAL_FIELD }],
                expression: {
                  language: 'sheetbase-formula-v1',
                  source: '=A1',
                },
              },
            },
          ]),
        ],
      )
    ).rows[0].result

    const schema = (
      await owner.query(
        `select api.create_dataset_schema_definition($1,'h2_results','H2 results',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify([
            {
              field_id: SAMPLE_FIELD,
              key: 'sample',
              label: 'Sample',
              logical_type: 'reference',
              nullable: true,
              relationship: {
                target: { kind: 'model', modelKey: 'sample' },
                cardinality: 'one',
              },
            },
          ]),
        ],
      )
    ).rows[0].result
    await owner.query(`select api.publish_dataset_schema_version($1)`, [
      schema.schema_version_id,
    ])
    const datasetId = (
      await migrator.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'H2 results') returning id`,
        [WS, schema.schema_version_id],
      )
    ).rows[0].id as string
    const datasetRowId = (
      await migrator.query(
        `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
        [datasetId, WS],
      )
    ).rows[0].id as string
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,reference_id) values($1,$2,$3)`,
      [datasetRowId, SAMPLE_FIELD, SAMPLE],
    )
    const otherSchema = (
      await owner.query(
        `select api.create_dataset_schema_definition($1,'h2_other','H2 other',null,'[]'::jsonb) result`,
        [WS],
      )
    ).rows[0].result
    await owner.query(`select api.publish_dataset_schema_version($1)`, [
      otherSchema.schema_version_id,
    ])
    const otherDatasetId = (
      await migrator.query(
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'H2 other') returning id`,
        [WS, otherSchema.schema_version_id],
      )
    ).rows[0].id as string

    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'h2_composed','H2 composed',null,$2::jsonb) result`,
        [WS, JSON.stringify(definitionConfiguration(schema.schema_version_id))],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const inputs = [{ parameterId: PARAMETER, kind: 'dataset', datasetId }]

    const preview = (
      await owner.query(
        `select api.preview_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb) result`,
        [
          instanceId,
          calculated.revision,
          definition.version.id,
          JSON.stringify(inputs),
        ],
      )
    ).rows[0].result
    expect(preview.compatible).toBe(true)
    expect(preview.instanceId).toBe(instanceId)
    expect(preview.notebookRecordId).toBe(RECORD)
    expect(preview.unmatchedLocalRowKeys).toContain(LOCAL_ROW)
    expect(preview.preserved.localFieldIds).toContain(LOCAL_FIELD)

    const token = crypto.randomUUID()
    const applied = (
      await owner.query(
        `select api.apply_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb,$5) result`,
        [
          instanceId,
          calculated.revision,
          definition.version.id,
          JSON.stringify(inputs),
          token,
        ],
      )
    ).rows[0].result
    expect(applied.status).toBe('applied')
    expect(applied.instance.id).toBe(instanceId)
    expect(applied.instance.source_definition_version_id).toBe(
      definition.version.id,
    )
    expect(applied.instance.state.provenance.createdFrom).toBe(
      'definition_version',
    )
    expect(applied.instance.state.localValues[LOCAL_ROW][LOCAL_FIELD]).toBe(4.2)
    expect(applied.instance.state.instanceCalculations[0].id).toBe(CALCULATION)
    expect(applied.unmatchedLocalRowKeys).toContain(LOCAL_ROW)

    const block = (
      await owner.query(`select payload from api.blocks where id=$1`, [blockId])
    ).rows[0]
    expect(block.payload).toEqual({ instanceId })

    const composed = (
      await owner.query(
        `select api.query_sheet_instance_rows($1,50,0) result`,
        [instanceId],
      )
    ).rows[0].result
    expect(composed.rows.length).toBeGreaterThan(0)
    expect(composed.definitionVersionId).toBe(definition.version.id)

    const retry = (
      await owner.query(
        `select api.apply_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb,$5) result`,
        [
          instanceId,
          calculated.revision,
          definition.version.id,
          JSON.stringify(inputs),
          token,
        ],
      )
    ).rows[0].result
    expect(retry.idempotent).toBe(true)
    expect(retry.instance.revision).toBe(applied.instance.revision)

    await expectDenied(
      owner.query(
        `select api.apply_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb,$5)`,
        [
          instanceId,
          applied.instance.revision,
          definition.version.id,
          JSON.stringify(inputs),
          crypto.randomUUID(),
        ],
      ),
      'SB104',
    )
    await expectDenied(
      owner.query(
        `select api.apply_sheet_instance_composition_adoption($1,1,$2,$3::jsonb,$4)`,
        [
          instanceId,
          definition.version.id,
          JSON.stringify(inputs),
          crypto.randomUUID(),
        ],
      ),
      'SB073',
    )

    const second = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,null,null,null) result`,
        [RECORD],
      )
    ).rows[0].result
    const incompatiblePreview = (
      await owner.query(
        `select api.preview_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb) result`,
        [
          second.instance.id,
          second.instance.revision,
          definition.version.id,
          JSON.stringify([
            {
              parameterId: PARAMETER,
              kind: 'dataset',
              datasetId: otherDatasetId,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(incompatiblePreview.compatible).toBe(false)
    const before = (
      await owner.query(
        `select revision, source_definition_version_id from api.sheet_instances where id=$1`,
        [second.instance.id],
      )
    ).rows[0]
    await expectDenied(
      owner.query(
        `select api.apply_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb,$5)`,
        [
          second.instance.id,
          second.instance.revision,
          definition.version.id,
          JSON.stringify([
            {
              parameterId: PARAMETER,
              kind: 'dataset',
              datasetId: otherDatasetId,
            },
          ]),
          crypto.randomUUID(),
        ],
      ),
      'SB074',
    )
    const after = (
      await owner.query(
        `select revision, source_definition_version_id from api.sheet_instances where id=$1`,
        [second.instance.id],
      )
    ).rows[0]
    expect(after).toEqual(before)

    const other = await actor(OTHER, OTHER_WS)
    const foreign = (
      await other.query(
        `select api.create_sheet_definition($1,'foreign','Foreign',null,$2::jsonb) result`,
        [
          OTHER_WS,
          JSON.stringify({
            ...definitionConfiguration('10400000-0000-4000-8000-000000000099'),
            parameters: [],
            bindings: [],
            joins: [],
            columns: [
              {
                id: COLUMN,
                field: {
                  fieldId: COLUMN,
                  key: 'row',
                  label: 'Row',
                  description: null,
                  logicalType: 'reference',
                  nullable: true,
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
                source: { kind: 'declared' },
              },
            ],
            rowIdentity: { kind: 'local', columnIds: [COLUMN] },
          }),
        ],
      )
    ).rows[0].result
    await other.query(`select api.publish_sheet_definition_version($1,$2)`, [
      foreign.version.id,
      foreign.version.revision,
    ])
    const cross = (
      await owner.query(
        `select api.preview_sheet_instance_composition_adoption($1,$2,$3,$4::jsonb) result`,
        [
          second.instance.id,
          second.instance.revision,
          foreign.version.id,
          JSON.stringify(inputs),
        ],
      )
    ).rows[0].result
    expect(cross.compatible).toBe(false)
    expect(cross.errorCode).toBe('SB074')
  })
})
