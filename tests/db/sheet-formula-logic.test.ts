import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DataClient } from '../../src/lib/data-client'
import { calculateSheetSnapshot } from '../../src/lib/sheet-calculation.server'
import { fetchComposedSheetRows } from '../../src/lib/sheet-composition-data'
import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '06700000-0000-4000-8000-000000000001'
const PROJECT = '06700000-0000-4000-8000-000000000003'
const OWNER = 'formula-logic-owner'
const PLACEMENT = '06700000-0000-4000-8000-000000000011'
const TEMPLATE_PARAMETER = '06700000-0000-4000-8000-000000000012'
const DEFINITION_PARAMETER = '06700000-0000-4000-8000-000000000013'
const TITRE_OUT = '06700000-0000-4000-8000-0000000000a1'
const TITRE_IN = '06700000-0000-4000-8000-0000000000a2'
const STEP_YIELD = '06700000-0000-4000-8000-0000000000a3'
const MEETS = '06700000-0000-4000-8000-0000000000a4'
const YIELD_CALCULATION = '06700000-0000-4000-8000-0000000000b1'
const MEETS_CALCULATION = '06700000-0000-4000-8000-0000000000b2'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])

  return client
}

const titreQuantity = {
  kind: 'measurement' as const,
  dimension: 'cp/mL',
  storageUnit: 'cp/mL',
}

/** The Clarification sheet of the depth-filter template, as v5 has it. */
function clarificationConfiguration() {
  const base = validSheetDefinitionConfiguration()
  const [first] = base.columns

  const column = (
    id: string,
    key: string,
    label: string,
    logicalType: 'decimal' | 'text',
    options: {
      calculation?: string
      quantity?: typeof titreQuantity | null
    } = {},
  ) => ({
    id,
    source: options.calculation
      ? { kind: 'calculated' as const, calculationId: options.calculation }
      : { kind: 'declared' as const },
    field: {
      ...first.field,
      fieldId: id,
      key,
      label,
      logicalType,
      relationship: null,
      quantity: options.quantity ?? null,
      computation: options.calculation
        ? { mode: 'computed' as const, expressionId: options.calculation }
        : { mode: 'stored' as const },
    },
  })

  const identity = {
    ...first,
    source: { kind: 'declared' as const },
    field: {
      ...first.field,
      logicalType: 'reference' as const,
      relationship: {
        target: { kind: 'model' as const, modelKey: 'sample' },
        cardinality: 'one' as const,
      },
    },
  }

  return {
    ...base,
    parameters: [
      {
        id: DEFINITION_PARAMETER,
        key: 'yield_threshold',
        label: 'Yield threshold (%)',
        required: false,
        type: { kind: 'scalar' as const, valueType: 'decimal' as const },
        defaultValue: 75,
        constraints: { min: 0, max: 100 },
      },
    ],
    bindings: [],
    joins: [],
    columns: [
      identity,
      column(TITRE_OUT, 'titre_out', 'Titre out', 'decimal', {
        quantity: titreQuantity,
      }),
      column(TITRE_IN, 'titre_in', 'Titre in', 'decimal', {
        quantity: titreQuantity,
      }),
      column(STEP_YIELD, 'step_yield', 'Step yield (%)', 'decimal', {
        calculation: YIELD_CALCULATION,
      }),
      column(MEETS, 'meets_criteria', 'Meets criteria', 'text', {
        calculation: MEETS_CALCULATION,
      }),
    ],
    calculations: [
      {
        id: YIELD_CALCULATION,
        key: 'step_yield',
        label: 'Step yield (%)',
        outputColumnId: STEP_YIELD,
        inputColumnIds: [TITRE_OUT, TITRE_IN],
        inputParameterIds: [],
        expression: {
          language: 'sheetbase-formula-v1' as const,
          source: '=A1/B1*100',
        },
      },
      {
        id: MEETS_CALCULATION,
        key: 'meets_criteria',
        label: 'Meets criteria',
        outputColumnId: MEETS,
        inputColumnIds: [STEP_YIELD],
        inputParameterIds: [DEFINITION_PARAMETER],
        expression: {
          language: 'sheetbase-formula-v1' as const,
          source: '=IF(A1>=B1,"Pass","Fail")',
        },
      },
    ],
    writeBackRules: [],
    actions: [],
    rowIdentity: { kind: 'local' as const, columnIds: [identity.id] },
    presentation: {
      columnOrder: [identity.id, TITRE_OUT, TITRE_IN, STEP_YIELD, MEETS],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard' as const,
      filters: [],
      sorts: [],
    },
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','formula-logic-owner@test.invalid',true)`,
    [OWNER],
  )

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'formula-logic','Formula logic')`,
    [WS],
  )

  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )

  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'FLG','Formula logic',$3)`,
    [PROJECT, WS, OWNER],
  )

  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: OWNER,
    canView: true,
    canEdit: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('sheet formulas that compare and decide', () => {
  it('rejects a calculation that reads a parameter the definition does not have', async () => {
    const owner = await actor(OWNER)
    const configuration = clarificationConfiguration()
    configuration.calculations[1].inputParameterIds = [crypto.randomUUID()]

    await expect(
      owner.query(
        `select api.create_sheet_definition($1,'bad_parameter','Bad parameter',null,$2::jsonb)`,
        [WS, JSON.stringify(configuration)],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('feeds the template setting to the sheet and calculates Pass or Fail', async () => {
    const owner = await actor(OWNER)

    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'clarification_logic','Clarification',null,$2::jsonb) result`,
        [WS, JSON.stringify(clarificationConfiguration())],
      )
    ).rows[0].result

    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])

    const template = (
      await owner.query(
        `select api.create_notebook_template($1,'logic_tpl','Clarification logic',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify({
            formatVersion: 1,
            parameters: [
              {
                id: TEMPLATE_PARAMETER,
                key: 'yield_threshold',
                label: 'Yield threshold (%)',
                required: false,
                type: { kind: 'scalar', valueType: 'decimal' },
                defaultValue: 80,
                constraints: { min: 0, max: 100 },
              },
            ],
            placements: [
              {
                id: PLACEMENT,
                kind: 'sheet',
                order: 1,
                definitionVersionId: definition.version.id,
                parameterMappings: [
                  {
                    templateParameterId: TEMPLATE_PARAMETER,
                    definitionParameterId: DEFINITION_PARAMETER,
                  },
                ],
              },
            ],
          }),
        ],
      )
    ).rows[0].result

    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'Published')) result`,
        [template.version.id, template.version.revision],
      )
    ).rows[0].result

    const instanceOf = async (inputs: unknown[], key: string) => {
      const created = (
        await owner.query(
          `select api.instantiate_notebook_template_version($1,$2,'Run',$3::jsonb,$4) result`,
          [published.id, PROJECT, JSON.stringify(inputs), key],
        )
      ).rows[0].result

      return (
        await owner.query(
          `select i.id, i.revision, i.state from api.sheet_instances i
            where i.notebook_record_id = $1`,
          [created.record.id],
        )
      ).rows[0]
    }

    // Left alone, the template's own default (80) reaches the sheet, not the
    // definition's (75).
    const instance = await instanceOf([], 'logic-default')

    expect(
      instance.state.parameterValues.map(
        (item: { value: number; source: string }) => [item.value, item.source],
      ),
    ).toEqual([[80, 'supplied']])

    // A value typed when the notebook is made wins over the default.
    const changed = await instanceOf(
      [{ parameterId: TEMPLATE_PARAMETER, kind: 'scalar', value: 95 }],
      'logic-supplied',
    )

    expect(changed.state.parameterValues[0].value).toBe(95)

    const strictRow = crypto.randomUUID()
    const looseRow = crypto.randomUUID()
    const emptyRow = crypto.randomUUID()

    const typed = (
      await owner.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,gen_random_uuid(),'[]'::jsonb,$3::jsonb,$4::jsonb)) result`,
        [
          instance.id,
          Number(instance.revision),
          JSON.stringify(
            [strictRow, looseRow, emptyRow].map((rowKey) => ({
              kind: 'local',
              rowKey,
            })),
          ),
          JSON.stringify([
            { rowKey: strictRow, fieldId: TITRE_OUT, value: 410 },
            { rowKey: strictRow, fieldId: TITRE_IN, value: 500 },
            { rowKey: looseRow, fieldId: TITRE_OUT, value: 450 },
            { rowKey: looseRow, fieldId: TITRE_IN, value: 500 },
            { rowKey: emptyRow, fieldId: TITRE_OUT, value: 300 },
          ]),
        ],
      )
    ).rows[0].result

    const raw = (
      await owner.query(
        `select api.query_sheet_instance_rows($1,200,0) result`,
        [instance.id],
      )
    ).rows[0].result

    const dataClient: DataClient = {
      // SAFETY: the one call through this adapter is the composed-sheet read,
      // whose answer is the JSON that call decodes.
      rpc: async <T>() => raw as T,
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
      definitionVersionId: definition.version.id,
      revision: typed.revision,
      state: typed.state,
      composition,
    })

    const valueAt = (rowKey: string, calculationId: string) =>
      results.find(
        (item) =>
          item.rowKey === rowKey && item.calculationId === calculationId,
      )

    // 410 / 500 = 82 %, which reaches 80; 450 / 500 = 90 %.
    expect(valueAt(strictRow, YIELD_CALCULATION)?.value).toBe(82)
    expect(valueAt(strictRow, MEETS_CALCULATION)?.value).toBe('Pass')
    expect(valueAt(looseRow, MEETS_CALCULATION)?.value).toBe('Pass')

    // A row still missing its titre in has nothing to decide on yet.
    expect(valueAt(emptyRow, MEETS_CALCULATION)).toMatchObject({
      resultKind: 'error',
      errorCode: 'MISSING',
    })

    // The result names the setting it read, so the decision can be traced.
    expect(valueAt(strictRow, MEETS_CALCULATION)?.dependencies).toEqual([
      { kind: 'column', id: STEP_YIELD },
      { kind: 'parameter', id: DEFINITION_PARAMETER },
    ])
    expect(valueAt(strictRow, MEETS_CALCULATION)?.dependencyProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'parameter',
          parameterId: DEFINITION_PARAMETER,
          valueSource: 'supplied',
        }),
      ]),
    )

    // The trusted writer keeps a text result and reads it back.
    const batch = results.filter((item) => item.rowKey === strictRow)

    await migrator.query('begin')
    await migrator.query('set local role formula_writer')

    await migrator.query(
      `select internal.apply_trusted_sheet_calculation($1,$2,$3,$4,$5::jsonb)`,
      [
        OWNER,
        instance.id,
        typed.revision,
        crypto.randomUUID(),
        JSON.stringify(batch),
      ],
    )
    await migrator.query('commit')

    const stored = (
      await owner.query(
        `select api.read_sheet_instance_calculation_results($1,$2::jsonb) result`,
        [instance.id, JSON.stringify([strictRow])],
      )
    ).rows[0].result

    expect(
      stored.results.find(
        (item: { calculationId: string }) =>
          item.calculationId === MEETS_CALCULATION,
      ),
    ).toMatchObject({ calculatedValue: 'Pass', resultKind: 'value' })

    // A result whose dependencies leave out the setting is refused.
    const forged = batch.map((item) =>
      item.calculationId === MEETS_CALCULATION
        ? { ...item, dependencies: [{ kind: 'column', id: STEP_YIELD }] }
        : item,
    )

    await migrator.query('begin')
    await migrator.query('set local role formula_writer')
    await expect(
      migrator.query(
        `select internal.apply_trusted_sheet_calculation($1,$2,$3,$4,$5::jsonb)`,
        [
          OWNER,
          instance.id,
          typed.revision,
          crypto.randomUUID(),
          JSON.stringify(forged),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB083' })
    await migrator.query('rollback')
  })
})
