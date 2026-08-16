import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c055'
const OWNER = 'core-05-evo-owner'
const STEWARD = 'core-05-evo-steward'
const MEMBER = 'core-05-evo-member'
const LOCAL_ROW = '00000000-0000-4000-8000-00000000c255'
const LOCAL_FIELD = '00000000-0000-4000-8000-00000000c256'
const CALC_ID = '00000000-0000-4000-8000-00000000c257'
const DEF_CALC_ID = '00000000-0000-4000-8000-00000000c258'

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
    }),
  ])
  return client
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','evo-owner@test.invalid',true),
      ('${STEWARD}','Steward','evo-steward@test.invalid',true),
      ('${MEMBER}','Member','evo-member@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','core-05-evo','CORE-05 evolution');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${STEWARD}','steward'),
      ('${WS}','${MEMBER}','member')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-05 governed evolution and promotion', () => {
  it('classifies Model field changes and blocks destructive contract edits', async () => {
    const steward = await actor(STEWARD)
    const created = (
      await steward.query(
        `select * from api.create_and_activate_model_field(
           $1,'sample','evo_note','Note','text',true,null,'{}'::jsonb,'[]'::jsonb
         )`,
        [WS],
      )
    ).rows[0]
    const compatible = (
      await steward.query(
        `select api.preview_model_field_evolution($1,'update','{"label":"Observation"}'::jsonb) result`,
        [created.id],
      )
    ).rows[0].result
    expect(compatible).toMatchObject({
      classification: 'compatible',
      blocked: false,
    })
    const applied = (
      await steward.query(
        `select api.apply_model_field_evolution($1,'update','{"label":"Observation"}'::jsonb,false) result`,
        [created.id],
      )
    ).rows[0].result
    expect(applied.field.label).toBe('Observation')
    const blocked = (
      await steward.query(
        `select api.preview_model_field_evolution($1,'update','{"validation":{"minLength":2}}'::jsonb) result`,
        [created.id],
      )
    ).rows[0].result
    expect(blocked.blocked).toBe(true)
    await expectDenied(
      steward.query(
        `select api.apply_model_field_evolution($1,'update','{"validation":{"minLength":2}}'::jsonb,true)`,
        [created.id],
      ),
      'SB072',
    )
    await expectDenied(
      steward.query(
        `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,false)`,
        [created.id],
      ),
      'SB071',
    )
    const retired = (
      await steward.query(
        `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,true) result`,
        [created.id],
      )
    ).rows[0].result
    expect(retired.field.lifecycle).toBe('retired')
  })

  it('publishes an explicit Dataset Schema version without rebinding live Datasets', async () => {
    const steward = await actor(STEWARD)
    const created = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'evo_result','Evo result',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'decimal',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    await steward.query(`select api.publish_dataset_schema_version($1)`, [
      created.schema_version_id,
    ])
    const dataset = (
      await steward.query(
        `insert into api.datasets(workspace_id,schema_version_id,name)
         values($1,$2,'Live') returning id,schema_version_id`,
        [WS, created.schema_version_id],
      )
    ).rows[0]
    const optional = (
      await steward.query(
        `select api.preview_dataset_schema_evolution($1,$2::jsonb) result`,
        [
          created.schema_version_id,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'decimal',
              nullable: true,
            },
            {
              key: 'comment',
              label: 'Comment',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(optional.classification).toBe('compatible')
    const required = (
      await steward.query(
        `select api.preview_dataset_schema_evolution($1,$2::jsonb) result`,
        [
          created.schema_version_id,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'decimal',
              nullable: true,
            },
            {
              key: 'batch',
              label: 'Batch',
              logical_type: 'text',
              nullable: false,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(required.classification).toBe('migration-requiring')
    const breaking = (
      await steward.query(
        `select api.preview_dataset_schema_evolution($1,$2::jsonb) result`,
        [
          created.schema_version_id,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(breaking.classification).toBe('breaking')
    const applied = (
      await steward.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-1') result`,
        [
          created.schema_version_id,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'decimal',
              nullable: true,
            },
            {
              key: 'comment',
              label: 'Comment',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(applied.ok).toBe(true)
    expect(applied.schemaVersionId).not.toBe(created.schema_version_id)
    const rebound = (
      await steward.query(
        `select schema_version_id from api.datasets where id=$1`,
        [dataset.id],
      )
    ).rows[0]
    expect(rebound.schema_version_id).toBe(dataset.schema_version_id)
    const retry = (
      await steward.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-1') result`,
        [
          created.schema_version_id,
          JSON.stringify([
            {
              field_id: '00000000-0000-4000-8000-00000000c301',
              key: 'titre',
              label: 'Titre',
              logical_type: 'decimal',
              nullable: true,
            },
            {
              key: 'comment',
              label: 'Comment',
              logical_type: 'text',
              nullable: true,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(retry.idempotent).toBe(true)
  })

  it('promotes a local field explicitly and rejects local-dependent calculation promotion', async () => {
    const steward = await actor(STEWARD)
    const member = await actor(MEMBER)
    const configuration = structuredClone(
      validSheetDefinitionConfiguration(),
    ) as Record<string, unknown>
    const column = (
      configuration.columns as Array<Record<string, unknown>>
    )[0] as Record<string, unknown>
    ;(column as { source: unknown }).source = { kind: 'declared' }
    configuration.parameters = []
    configuration.bindings = []
    configuration.joins = []
    configuration.columns = [column]
    configuration.calculations = []
    configuration.writeBackRules = []
    configuration.actions = []
    configuration.rowIdentity = { kind: 'local', columnIds: [column.id] }
    configuration.presentation = {
      columnOrder: [column.id],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    }
    const definition = (
      await steward.query(
        `select api.create_sheet_definition($1,'evo_local','Local','',$2::jsonb) result`,
        [WS, JSON.stringify(configuration)],
      )
    ).rows[0].result
    await steward.query(`select api.publish_sheet_definition_version($1,1)`, [
      definition.version.id,
    ])
    const schema = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'promo_schema','Promo',null,'[]'::jsonb) result`,
        [WS],
      )
    ).rows[0].result
    await steward.query(`select api.publish_dataset_schema_version($1)`, [
      schema.schema_version_id,
    ])
    const state = {
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
      localValues: { [LOCAL_ROW]: { [LOCAL_FIELD]: 'kept-local' } },
      instanceCalculations: [],
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
    const created = (
      await steward.query(
        `select to_jsonb(api.create_sheet_instance_from_definition($1,'Promo',null,$2,null,null,$3::jsonb,'[]'::jsonb)) result`,
        [WS, definition.version.id, JSON.stringify(state)],
      )
    ).rows[0].result
    const resolved = (
      await steward.query(
        `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
        [created.id],
      )
    ).rows[0].result
    await steward.query(
      `select api.mutate_sheet_instance_calculations($1,$2,$3::uuid,$4::jsonb)`,
      [
        created.id,
        resolved.revision,
        crypto.randomUUID(),
        JSON.stringify([
          {
            operation: 'add',
            calculation: {
              id: CALC_ID,
              key: 'recovery',
              label: 'Recovery',
              lifecycle: 'active',
              outputField: {
                fieldId: CALC_ID,
                key: 'recovery',
                label: 'Recovery',
                description: null,
                logicalType: 'decimal',
                nullable: true,
                defaultValue: null,
                cardinality: 'one',
                quantity: null,
                validation: {},
                category: null,
                relationship: null,
                computation: { mode: 'computed', expressionId: CALC_ID },
                lifecycle: 'active',
              },
              dependencies: [{ kind: 'local-field', id: LOCAL_FIELD }],
              expression: { language: 'sheetbase-formula-v1', source: '=A1' },
            },
          },
        ]),
      ],
    )
    await expectDenied(
      member.query(
        `select api.promote_local_field($1,$2,'dataset_schema',$3,'promo-1')`,
        [created.id, LOCAL_FIELD, schema.schema_definition_id],
      ),
      '42501',
    )
    const promoted = (
      await steward.query(
        `select api.promote_local_field($1,$2,'dataset_schema',$3,'promo-1') result`,
        [created.id, LOCAL_FIELD, schema.schema_definition_id],
      )
    ).rows[0].result
    expect(promoted.ok).toBe(true)
    expect(promoted.historicalValuesRemainLocal).toBe(true)
    const promoDraft = (
      await steward.query(
        `select revision from api.dataset_schema_versions where id=$1`,
        [promoted.schemaVersionId],
      )
    ).rows[0]
    const stillLocal = (
      await steward.query(
        `select state->'localValues'->$1->$2 as value from api.sheet_instances where id=$3`,
        [LOCAL_ROW, LOCAL_FIELD, created.id],
      )
    ).rows[0]
    expect(stillLocal.value).toBe('kept-local')
    const calcPreview = (
      await steward.query(
        `select api.preview_calculation_promotion($1,$2,'dataset_schema') result`,
        [created.id, CALC_ID],
      )
    ).rows[0].result
    expect(calcPreview.ok).toBe(false)
    expect(calcPreview.reason).toBe('incompatible_local_dependency')
    const current = (
      await steward.query(
        `select revision from api.sheet_instances where id=$1`,
        [created.id],
      )
    ).rows[0]
    await steward.query(
      `select api.mutate_sheet_instance_calculations($1,$2,$3::uuid,$4::jsonb)`,
      [
        created.id,
        current.revision,
        crypto.randomUUID(),
        JSON.stringify([
          {
            operation: 'add',
            calculation: {
              id: DEF_CALC_ID,
              key: 'yield_copy',
              label: 'Yield copy',
              lifecycle: 'active',
              outputField: {
                fieldId: DEF_CALC_ID,
                key: 'yield_copy',
                label: 'Yield copy',
                description: null,
                logicalType: 'decimal',
                nullable: true,
                defaultValue: null,
                cardinality: 'one',
                quantity: null,
                validation: {},
                category: null,
                relationship: null,
                computation: { mode: 'computed', expressionId: DEF_CALC_ID },
                lifecycle: 'active',
              },
              dependencies: [{ kind: 'column', id: column.id }],
              expression: { language: 'sheetbase-formula-v1', source: '=A1' },
            },
          },
        ]),
      ],
    )
    const definitionPreview = (
      await steward.query(
        `select api.preview_calculation_promotion($1,$2,'sheet_definition') result`,
        [created.id, DEF_CALC_ID],
      )
    ).rows[0].result
    expect(definitionPreview.ok).toBe(true)
    const promotedCalc = (
      await steward.query(
        `select api.promote_calculation($1,$2,'sheet_definition',null,'calc-1') result`,
        [created.id, DEF_CALC_ID],
      )
    ).rows[0].result
    expect(promotedCalc.ok).toBe(true)
    expect(promotedCalc.targetKind).toBe('sheet_definition_version')
    const datasetPreview = (
      await steward.query(
        `select api.preview_calculation_promotion($1,$2,'dataset_schema') result`,
        [created.id, DEF_CALC_ID],
      )
    ).rows[0].result
    expect(datasetPreview.ok).toBe(true)
    const derived = (
      await steward.query(
        `select api.promote_calculation($1,$2,'dataset_schema',$3,'calc-ds-1',$4,$5) result`,
        [
          created.id,
          DEF_CALC_ID,
          schema.schema_definition_id,
          promoted.schemaVersionId,
          promoDraft.revision,
        ],
      )
    ).rows[0].result
    expect(derived.ok).toBe(true)
    expect(derived.storesFormula).toBe(false)
  })
})
