import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '10500000-0000-4000-8000-000000000001'
const PROJECT = '10500000-0000-4000-8000-000000000002'
const RECORD = '10500000-0000-4000-8000-000000000003'
const OWNER = 'core-h3-owner'
const REVIEWER = 'core-h3-reviewer'
const SAMPLE_A = '10500000-0000-4000-8000-000000000004'
const SAMPLE_B = '10500000-0000-4000-8000-000000000005'
const SAMPLE_FIELD = '10500000-0000-4000-8000-000000000010'
const COLUMN = '10500000-0000-4000-8000-000000000011'
const PARAMETER = '10500000-0000-4000-8000-000000000012'
const BINDING = '10500000-0000-4000-8000-000000000013'
const LOCAL_FIELD = '10500000-0000-4000-8000-000000000014'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: WS,
      role: 'authenticated',
      session_id: `session-${userId}`,
    }),
  ])
  return client
}

function definitionConfiguration(schemaVersionId: string) {
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
        field: {
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
        },
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
      ('${OWNER}','Owner','h3-owner@test.invalid',true),
      ('${REVIEWER}','Reviewer','h3-reviewer@test.invalid',true);
    insert into api.workspaces(id,slug,name) values ('${WS}','core-h3','CORE H3');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${REVIEWER}','member');
    insert into api.projects(id,workspace_id,key,title) values
      ('${PROJECT}','${WS}','h3','H3')`)
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values ($1,$2,$3,'experiment','H3-A','Notebook',$4)`,
    [RECORD, WS, PROJECT, OWNER],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,created_by_user_id,deleted_at)
     values ($1,$2,'sample','H3-SA','Sample A',$3,null),
          ($4,$2,'sample','H3-SB','Sample B',$3,null)`,
    [SAMPLE_A, WS, OWNER, SAMPLE_B],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('H3 frozen composed Sheet evidence', () => {
  it('captures asymmetric local rows with stable identities and quantity metadata regardless of presentation order', async () => {
    const timeField = crypto.randomUUID()
    const firstRow = '10500000-0000-4000-8000-000000000021'
    const secondRow = '10500000-0000-4000-8000-000000000022'
    const state = {
      localFields: [
        {
          fieldId: timeField,
          key: 'time',
          label: 'Time',
          logicalType: 'decimal',
          quantity: { kind: 'duration', dimension: 'time', storageUnit: 'd' },
        },
        {
          fieldId: LOCAL_FIELD,
          key: 'titer',
          label: 'Log titer',
          logicalType: 'decimal',
          quantity: {
            kind: 'log_titer',
            dimension: 'dimensionless',
            storageUnit: 'log10',
          },
        },
      ],
      localValues: {
        [secondRow]: { [timeField]: 28, [LOCAL_FIELD]: 5.9 },
        [firstRow]: { [timeField]: 0, [LOCAL_FIELD]: 7.2 },
      },
      presentation: {
        columnOrder: [LOCAL_FIELD, timeField],
        hiddenColumnIds: [],
      },
    }
    const grid = (
      await migrator.query(
        `select internal.build_frozen_composed_sheet_grid($1::jsonb,null,'[]') grid`,
        [JSON.stringify(state)],
      )
    ).rows[0].grid
    expect(grid.rowKeys).toEqual([firstRow, secondRow])
    expect(grid.rows).toEqual([
      [7.2, 0],
      [5.9, 28],
    ])
    expect(grid.columns.map((column: { id: string }) => column.id)).toEqual([
      LOCAL_FIELD,
      timeField,
    ])
    expect(grid.columns[0].field.quantity).toEqual({
      kind: 'log_titer',
      dimension: 'dimensionless',
      storageUnit: 'log10',
    })
    expect(grid.columns[1].field.quantity).toEqual({
      kind: 'duration',
      dimension: 'time',
      storageUnit: 'd',
    })
    const owner = await actor(OWNER)
    await expectDenied(
      owner.query(
        `select internal.build_frozen_composed_sheet_grid($1::jsonb,null,'[]')`,
        [JSON.stringify(state)],
      ),
      '42501',
    )
  })

  it('reconstructs submitted Dataset values after live Dataset and Instance mutation', async () => {
    const owner = await actor(OWNER)
    const schema = (
      await owner.query(
        `select api.create_dataset_schema_definition($1,'h3_results','H3 results',null,$2::jsonb) result`,
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
        `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'H3 results') returning id`,
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
      [datasetRowId, SAMPLE_FIELD, SAMPLE_A],
    )
    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'h3_composed','H3 composed',null,$2::jsonb) result`,
        [WS, JSON.stringify(definitionConfiguration(schema.schema_version_id))],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])
    const instance = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance_from_definition($1,'H3 sheet',null,$2,null,$3,$4::jsonb,$5::jsonb)) result`,
        [
          WS,
          definition.version.id,
          RECORD,
          JSON.stringify({
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
              columnOrder: [COLUMN, LOCAL_FIELD],
              hiddenColumnIds: [],
              columnWidths: {},
              frozenColumnCount: 0,
              density: 'standard',
            },
            provenance: { createdFrom: 'definition_version' },
          }),
          JSON.stringify([
            { parameterId: PARAMETER, kind: 'dataset', datasetId },
          ]),
        ],
      )
    ).rows[0].result
    const embedded = (
      await owner.query(
        `select api.insert_sheet_instance_block($1,null,null,$2) result`,
        [RECORD, instance.id],
      )
    ).rows[0].result
    expect(embedded.block.payload.instanceId).toBe(instance.id)

    const preview = (
      await owner.query(`select api.preview_submission_digest($1) result`, [
        RECORD,
      ])
    ).rows[0].result
    const submitted = (
      await owner.query(
        `select api.submit_record_revision($1,$2,'default-scientific-review',1,ARRAY[$3]::text[],true,'submit-h3') result`,
        [RECORD, preview.sourceDigest, REVIEWER],
      )
    ).rows[0].result
    const stored = (
      await owner.query(
        `select composed_grid, dataset_versions, instance_state
           from api.revision_sheet_evidence where revision_id=$1`,
        [submitted.revision.id],
      )
    ).rows[0]
    expect(
      stored.composed_grid.columns.map((c: { id: string }) => c.id),
    ).toEqual(expect.arrayContaining([COLUMN, LOCAL_FIELD]))
    expect(stored.composed_grid.rowKeys).toHaveLength(
      stored.composed_grid.rows.length,
    )
    expect(stored.composed_grid.rowKeys[0]).toMatch(/^sb-row-v1:[a-f0-9]{64}$/)
    expect(stored.composed_grid.columns[0].field).toEqual(
      definitionConfiguration(schema.schema_version_id).columns[0].field,
    )
    expect(stored.composed_grid.fields).toEqual(
      expect.arrayContaining([
        definitionConfiguration(schema.schema_version_id).columns[0].field,
      ]),
    )
    const sampleCells = stored.composed_grid.rows.map(
      (row: unknown[]) => row[0],
    )
    expect(sampleCells).toContain(SAMPLE_A)
    const envelope = (
      await owner.query(
        `select canonical_snapshot->'sheetEvidence' evidence from api.revisions where id=$1`,
        [submitted.revision.id],
      )
    ).rows[0].evidence
    expect(envelope[0].composedGrid).toBeUndefined()

    await migrator.query(
      `update api.dataset_row_values set reference_id=$1 where row_id=$2 and field_id=$3`,
      [SAMPLE_B, datasetRowId, SAMPLE_FIELD],
    )
    await owner.query(
      `select api.mutate_sheet_instance_local_state($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [
        instance.id,
        instance.revision,
        crypto.randomUUID(),
        JSON.stringify([
          {
            operation: 'add',
            field: {
              fieldId: crypto.randomUUID(),
              key: 'later',
              label: 'Later',
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
          },
        ]),
      ],
    )
    const after = (
      await owner.query(
        `select composed_grid from api.revision_sheet_evidence where revision_id=$1`,
        [submitted.revision.id],
      )
    ).rows[0].composed_grid
    expect(after).toEqual(stored.composed_grid)
    await expectDenied(
      migrator.query(
        `update api.revision_sheet_evidence set composed_grid='{}'::jsonb where revision_id=$1`,
        [submitted.revision.id],
      ),
      'SB092',
    )
  })
})
