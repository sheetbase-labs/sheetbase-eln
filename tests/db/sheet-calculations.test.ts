import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DataClient } from '../../src/lib/data-client'
import { calculateSheetSnapshot } from '../../src/lib/sheet-calculation.server'
import { fetchComposedSheetRows } from '../../src/lib/sheet-composition-data'
import { prepareTestDatabase } from './helpers'

const WS = '22000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-calculation-owner'
const OUTSIDER = 'sheet-calculation-outsider'
const ROW = '22000000-0000-4000-8000-000000000002'
const INPUT = '22000000-0000-4000-8000-000000000003'
const CALCULATION = '22000000-0000-4000-8000-000000000004'
const PARAMETER = '22000000-0000-4000-8000-000000000010'
const BINDING = '22000000-0000-4000-8000-000000000011'
const COLUMN = '22000000-0000-4000-8000-000000000012'
const SOURCE_FIELD = '22000000-0000-4000-8000-000000000013'
const DEFINITION_CALCULATION = '22000000-0000-4000-8000-000000000014'
const DEFINITION_OUTPUT = '22000000-0000-4000-8000-000000000015'
const CROSS_SCOPE_CALCULATION = '22000000-0000-4000-8000-000000000016'
let migrator: Client
let owner: Client
let outsider: Client
let calculatedInstanceId: string

const numericField = (id: string, computed = false) => ({
  fieldId: id,
  key: computed ? 'recovery' : 'recovered',
  label: computed ? 'Recovery' : 'Recovered',
  description: null,
  logicalType: 'decimal',
  nullable: true,
  defaultValue: null,
  cardinality: 'one',
  quantity: null,
  validation: {},
  category: null,
  relationship: null,
  computation: computed
    ? { mode: 'computed', expressionId: id }
    : { mode: 'stored' },
  lifecycle: 'active',
})

const state = () => ({
  bindings: [],
  localFields: [numericField(INPUT)],
  localValues: { [ROW]: { [INPUT]: 5 } },
  calculationOverrides: {},
  presentation: {
    columnOrder: [],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  },
  provenance: { createdFrom: 'ad_hoc' },
})

const calculation = (label = 'Recovery') => ({
  id: CALCULATION,
  key: 'recovery',
  label,
  lifecycle: 'active',
  outputField: { ...numericField(CALCULATION, true), label },
  dependencies: [{ kind: 'local-field', id: INPUT }],
  expression: { language: 'sheetbase-formula-v1', source: '=A1' },
})

function configuredCalculation(schemaVersionId: string) {
  return {
    formatVersion: 1,
    parameters: [
      {
        id: PARAMETER,
        key: 'measurements',
        label: 'Measurements',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId },
        },
        constraints: {},
      },
    ],
    bindings: [{ id: BINDING, key: 'measurements', parameterId: PARAMETER }],
    rowIdentity: { kind: 'source', columnIds: [COLUMN] },
    joins: [],
    columns: [
      {
        id: COLUMN,
        field: {
          ...numericField(COLUMN),
          key: 'measurement',
          label: 'Measurement',
        },
        source: {
          kind: 'bound',
          bindingId: BINDING,
          sourceFieldId: SOURCE_FIELD,
        },
      },
      {
        id: DEFINITION_OUTPUT,
        field: {
          ...numericField(DEFINITION_OUTPUT),
          key: 'doubled',
          label: 'Doubled',
          computation: {
            mode: 'computed',
            expressionId: DEFINITION_CALCULATION,
          },
        },
        source: {
          kind: 'calculated',
          calculationId: DEFINITION_CALCULATION,
        },
      },
    ],
    calculations: [
      {
        id: DEFINITION_CALCULATION,
        key: 'doubled',
        label: 'Doubled',
        outputColumnId: DEFINITION_OUTPUT,
        inputColumnIds: [COLUMN],
        expression: { language: 'sheetbase-formula-v1', source: '=A1*2' },
      },
    ],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: [COLUMN, DEFINITION_OUTPUT],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
  }
}

const definitionState = () => ({
  bindings: [],
  localFields: [],
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
})

const crossScopeCalculation = () => ({
  id: CROSS_SCOPE_CALCULATION,
  key: 'adjusted',
  label: 'Adjusted',
  lifecycle: 'active',
  outputField: {
    ...numericField(CROSS_SCOPE_CALCULATION, true),
    key: 'adjusted',
    label: 'Adjusted',
  },
  dependencies: [{ kind: 'calculation', id: DEFINITION_CALCULATION }],
  expression: { language: 'sheetbase-formula-v1', source: '=A1+1' },
})

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  outsider = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
       ($1,'Owner','sheet-calculation@test.invalid',true),
       ($2,'Outsider','sheet-calculation-outsider@test.invalid',true)`,
    [OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-calculation','Sheet calculation')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')`,
    [WS, OWNER],
  )
  for (const [client, user] of [
    [owner, OWNER],
    [outsider, OUTSIDER],
  ] as const) {
    await client.query('set role authenticated')
    await client.query(`select set_config('request.jwt.claims',$1,false)`, [
      JSON.stringify({ sub: user, workspace_id: WS }),
    ])
  }
})

afterAll(async () => {
  await owner?.end()
  await outsider?.end()
  await migrator?.end()
})

describe('controlled composed Sheet calculations', () => {
  it('persists bounded Instance definitions and revision-bound results with exact retries', async () => {
    const instance = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Calculated',null,null,null,null,$2::jsonb)) result`,
        [WS, JSON.stringify(state())],
      )
    ).rows[0].result
    calculatedInstanceId = instance.id
    const token = crypto.randomUUID()
    const changes = [{ operation: 'add', calculation: calculation() }]
    const added = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_calculations($1,1,$2,$3::jsonb)) result`,
        [instance.id, token, JSON.stringify(changes)],
      )
    ).rows[0].result
    expect(added.revision).toBe(2)
    expect(added.state.instanceCalculations[0].dependencies).toEqual([
      { kind: 'local-field', id: INPUT },
    ])
    const retry = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_calculations($1,1,$2,$3::jsonb)) result`,
        [instance.id, token, JSON.stringify(changes)],
      )
    ).rows[0].result
    expect(retry.revision).toBe(2)
    await expect(
      owner.query(
        `select api.mutate_sheet_instance_calculations($1,2,$2,$3::jsonb)`,
        [instance.id, token, JSON.stringify(changes)],
      ),
    ).rejects.toMatchObject({ code: '23505' })

    const result = {
      calculationId: CALCULATION,
      rowKey: ROW,
      scope: 'instance',
      definitionVersionId: null,
      expression: calculation().expression,
      dependencies: calculation().dependencies,
      outputField: calculation().outputField,
      sourceRevisions: [],
      dependencyProvenance: [
        {
          kind: 'instance-local',
          instanceId: instance.id,
          rowKey: ROW,
          fieldId: INPUT,
          instanceRevision: 2,
        },
      ],
      resultKind: 'value',
      value: 5,
      errorCode: null,
      diagnostic: null,
    }
    const recalculateToken = crypto.randomUUID()
    await migrator.query('begin')
    await migrator.query('set local role formula_writer')
    const finalized = (
      await migrator.query(
        `select internal.apply_trusted_sheet_calculation($1,$2,2,$3,$4::jsonb) result`,
        [OWNER, instance.id, recalculateToken, JSON.stringify([result])],
      )
    ).rows[0].result
    await migrator.query('commit')
    expect(finalized).toMatchObject({
      revision: 2,
      rowCount: 1,
      calculationCount: 1,
      status: 'completed',
    })
    const read = (
      await owner.query(
        `select api.read_sheet_instance_calculation_results($1,$2::jsonb) result`,
        [instance.id, JSON.stringify([ROW])],
      )
    ).rows[0].result
    expect(read.results[0]).toMatchObject({
      calculationId: CALCULATION,
      rowKey: ROW,
      calculationStatus: 'current',
      calculatedValue: 5,
      resultKind: 'value',
      permission: { editability: 'read-only' },
    })
    expect(read.results[0].dependencyProvenance[0]).toMatchObject({
      fieldId: INPUT,
      instanceRevision: 2,
    })

    const edited = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_calculations($1,2,$2,$3::jsonb)) result`,
        [
          instance.id,
          crypto.randomUUID(),
          JSON.stringify([
            { operation: 'edit', calculation: calculation('Recovery renamed') },
          ]),
        ],
      )
    ).rows[0].result
    expect(edited.revision).toBe(3)
    const stale = (
      await owner.query(
        `select api.read_sheet_instance_calculation_results($1,$2::jsonb) result`,
        [instance.id, JSON.stringify([ROW])],
      )
    ).rows[0].result
    expect(stale.results[0]).toMatchObject({
      calculationStatus: 'stale',
      calculatedValue: null,
    })
  })

  it('rejects duplicate, unresolved and creation-bypass dependencies', async () => {
    await expect(
      owner.query(
        `select api.create_sheet_instance($1,'Bypass',null,null,null,null,$2::jsonb)`,
        [
          WS,
          JSON.stringify({
            ...state(),
            instanceCalculations: [calculation()],
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB083' })

    const candidate = (dependencies: unknown[]) => {
      const id = crypto.randomUUID()
      return {
        id,
        key: `calculation_${id.replaceAll('-', '')}`,
        label: 'Candidate',
        lifecycle: 'active',
        outputField: {
          ...numericField(id, true),
          key: `calculation_${id.replaceAll('-', '')}`,
        },
        dependencies,
        expression: { language: 'sheetbase-formula-v1', source: '=A1' },
      }
    }
    for (const definition of [
      candidate([
        { kind: 'local-field', id: INPUT },
        { kind: 'column', id: INPUT },
      ]),
      candidate([{ kind: 'column', id: crypto.randomUUID() }]),
      candidate([{ kind: 'calculation', id: crypto.randomUUID() }]),
    ]) {
      await expect(
        owner.query(
          `select api.mutate_sheet_instance_calculations($1,3,$2,$3::jsonb)`,
          [
            calculatedInstanceId,
            crypto.randomUUID(),
            JSON.stringify([{ operation: 'add', calculation: definition }]),
          ],
        ),
      ).rejects.toMatchObject({ code: 'SB083' })
    }
  })

  it('calculates a governed composed source and an Instance dependency on its Definition calculation', async () => {
    const schema = (
      await migrator.query(
        `insert into api.dataset_schema_definitions(workspace_id,key,name)
         values($1,$2,'Calculation measurements') returning id`,
        [WS, `calculation_${crypto.randomUUID().replaceAll('-', '')}`],
      )
    ).rows[0].id
    const schemaVersion = (
      await migrator.query(
        `insert into api.dataset_schema_versions(schema_id,version)
         values($1,1) returning id`,
        [schema],
      )
    ).rows[0].id
    await migrator.query(
      `insert into api.dataset_schema_version_fields(
         schema_version_id,field_id,key,label,logical_type,nullable,
         cardinality,quantity,validation,category,relationship,lifecycle,display_order
       ) values($1,$2,'measurement','Measurement','decimal',true,'one',null,
         '{}'::jsonb,null,null,'active',0)`,
      [schemaVersion, SOURCE_FIELD],
    )
    await migrator.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now()
       where id=$1`,
      [schemaVersion],
    )
    const dataset = (
      await migrator.query(
        `insert into api.datasets(workspace_id,schema_version_id,name)
         values($1,$2,'Measurements') returning id`,
        [WS, schemaVersion],
      )
    ).rows[0].id
    const datasetRow = (
      await migrator.query(
        `insert into api.dataset_rows(dataset_id,workspace_id)
         values($1,$2) returning id,revision`,
        [dataset, WS],
      )
    ).rows[0]
    await migrator.query(
      `insert into api.dataset_row_values(row_id,field_id,numeric_value)
       values($1,$2,4)`,
      [datasetRow.id, SOURCE_FIELD],
    )

    const createdDefinition = (
      await owner.query(
        `select api.create_sheet_definition($1,$2,'Governed calculation',null,$3::jsonb) result`,
        [
          WS,
          `governed_${crypto.randomUUID().replaceAll('-', '')}`,
          JSON.stringify(configuredCalculation(schemaVersion)),
        ],
      )
    ).rows[0].result
    await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
      createdDefinition.version.id,
    ])

    await expect(
      owner.query(
        `select api.create_sheet_instance_from_definition(
           $1,'Definition bypass',null,$2,null,null,$3::jsonb,$4::jsonb
         )`,
        [
          WS,
          createdDefinition.version.id,
          JSON.stringify({
            ...definitionState(),
            instanceCalculations: [crossScopeCalculation()],
          }),
          JSON.stringify([
            { parameterId: PARAMETER, kind: 'dataset', datasetId: dataset },
          ]),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB083' })

    const instance = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance_from_definition(
           $1,'Governed',null,$2,null,null,$3::jsonb,$4::jsonb
         )) result`,
        [
          WS,
          createdDefinition.version.id,
          JSON.stringify(definitionState()),
          JSON.stringify([
            { parameterId: PARAMETER, kind: 'dataset', datasetId: dataset },
          ]),
        ],
      )
    ).rows[0].result
    const resolved = (
      await owner.query(
        `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
        [instance.id],
      )
    ).rows[0].result
    for (const dependencies of [
      [{ kind: 'column', id: crypto.randomUUID() }],
      [{ kind: 'calculation', id: crypto.randomUUID() }],
    ]) {
      await expect(
        owner.query(
          `select api.mutate_sheet_instance_calculations($1,2,$2,$3::jsonb)`,
          [
            instance.id,
            crypto.randomUUID(),
            JSON.stringify([
              {
                operation: 'add',
                calculation: { ...crossScopeCalculation(), dependencies },
              },
            ]),
          ],
        ),
      ).rejects.toMatchObject({ code: 'SB083' })
    }
    const configured = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_calculations($1,2,$2,$3::jsonb)) result`,
        [
          instance.id,
          crypto.randomUUID(),
          JSON.stringify([
            { operation: 'add', calculation: crossScopeCalculation() },
          ]),
        ],
      )
    ).rows[0].result
    expect(configured.state.instanceCalculations[0].dependencies).toEqual([
      { kind: 'calculation', id: DEFINITION_CALCULATION },
    ])

    const rawComposition = (
      await owner.query(
        `select api.query_sheet_instance_rows($1,200,0) result`,
        [instance.id],
      )
    ).rows[0].result
    const dataClient: DataClient = {
      rpc: async <T>() => rawComposition as T,
      list: async () => [],
      count: async () => 0,
      insert: async () => {
        throw new Error('unsupported')
      },
      patch: async () => [],
      remove: async () => [],
    }
    const composition = await fetchComposedSheetRows(
      instance.id,
      { limit: 200, offset: 0 },
      dataClient,
    )
    const results = calculateSheetSnapshot({
      instanceId: instance.id,
      workspaceId: WS,
      definitionVersionId: createdDefinition.version.id,
      revision: configured.revision,
      state: configured.state,
      composition,
    })
    expect(results).toHaveLength(2)
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calculationId: DEFINITION_CALCULATION,
          scope: 'definition',
          resultKind: 'value',
          value: 8,
        }),
        expect.objectContaining({
          calculationId: CROSS_SCOPE_CALCULATION,
          scope: 'instance',
          resultKind: 'value',
          value: 9,
        }),
      ]),
    )
    expect(results[0].sourceRevisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dataset-row',
          datasetId: dataset,
          rowId: datasetRow.id,
          revision: Number(datasetRow.revision),
        }),
      ]),
    )
    await migrator.query('begin')
    await migrator.query('set local role formula_writer')
    await migrator.query(
      `select internal.apply_trusted_sheet_calculation($1,$2,$3,$4,$5::jsonb)`,
      [
        OWNER,
        instance.id,
        configured.revision,
        crypto.randomUUID(),
        JSON.stringify(results),
      ],
    )
    await migrator.query('commit')
    const persisted = (
      await owner.query(
        `select api.read_sheet_instance_calculation_results($1,$2::jsonb) result`,
        [instance.id, JSON.stringify([composition.rows[0].rowKey])],
      )
    ).rows[0].result
    expect(persisted.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calculationId: DEFINITION_CALCULATION,
          calculationStatus: 'current',
          calculatedValue: 8,
        }),
        expect.objectContaining({
          calculationId: CROSS_SCOPE_CALCULATION,
          calculationStatus: 'current',
          calculatedValue: 9,
        }),
      ]),
    )
    expect(resolved.revision).toBe(2)
  })

  it('enforces direct/helper ACLs, bounds, RLS and the frozen-evidence limitation', async () => {
    const privileges = (
      await migrator.query(
        `select
          has_function_privilege('authenticated','api.mutate_sheet_instance_calculations(uuid,bigint,uuid,jsonb)','EXECUTE') mutation,
          has_function_privilege('api_client','api.mutate_sheet_instance_calculations(uuid,bigint,uuid,jsonb)','EXECUTE') mutation_api_client,
          has_function_privilege('authenticated','internal.validate_sheet_instance_calculation_dependencies(uuid,jsonb)','EXECUTE') dependency_validator_authenticated,
          has_function_privilege('authenticated','internal.apply_trusted_sheet_calculation(text,uuid,bigint,uuid,jsonb)','EXECUTE') trusted_authenticated,
          has_function_privilege('formula_writer','internal.apply_trusted_sheet_calculation(text,uuid,bigint,uuid,jsonb)','EXECUTE') trusted_worker,
          has_table_privilege('authenticated','internal.sheet_instance_calculation_results','SELECT') direct_result_read,
          has_table_privilege('authenticated','api.sheet_instance_calculation_mutations','INSERT') direct_audit_write,
          (select relrowsecurity from pg_class where oid='api.sheet_instance_calculation_mutations'::regclass) audit_rls,
          (select count(*)::integer from information_schema.columns where table_schema='api' and table_name='revisions' and column_name like '%sheet_instance%') frozen_columns,
          (select count(*)::integer from pg_constraint where contype='f' and confrelid='api.sheet_instances'::regclass and conrelid='api.revisions'::regclass) frozen_foreign_keys`,
      )
    ).rows[0]
    expect(privileges).toEqual({
      mutation: true,
      mutation_api_client: true,
      dependency_validator_authenticated: false,
      trusted_authenticated: false,
      trusted_worker: true,
      direct_result_read: false,
      direct_audit_write: false,
      audit_rls: true,
      frozen_columns: 0,
      frozen_foreign_keys: 0,
    })
    await expect(
      outsider.query(
        `select api.read_sheet_instance_calculation_results($1,'[]'::jsonb)`,
        [calculatedInstanceId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `select api.read_sheet_instance_calculation_results($1,$2::jsonb)`,
        [
          calculatedInstanceId,
          JSON.stringify(
            Array.from({ length: 201 }, () => crypto.randomUUID()),
          ),
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
