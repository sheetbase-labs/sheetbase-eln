import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '26000000-0000-4000-8000-000000000001'
const OWNER = 'sheet-extraction-owner'
const MEMBER = 'sheet-extraction-member'
const OUTSIDER = 'sheet-extraction-outsider'
const ROW = '26000000-0000-4000-8000-000000000002'
const IDENTITY = '26000000-0000-4000-8000-000000000003'
const INPUT = '26000000-0000-4000-8000-000000000004'
const CALCULATION = '26000000-0000-4000-8000-000000000005'
const PARAMETER = '26000000-0000-4000-8000-000000000006'
const BINDING = '26000000-0000-4000-8000-000000000007'
const OVERRIDE = '26000000-0000-4000-8000-000000000008'
const SECRET_VALUE = 987654.321
const SECRET_FILTER = 'experiment-only-filter'
let migrator: Client
let owner: Client
let member: Client
let outsider: Client
let source: any
let schemaVersionId: string
let sourceDatasetId: string
let independentDatasetId: string
let selection: any

const field = (
  fieldId: string,
  key: string,
  logicalType: 'reference' | 'decimal',
) => ({
  fieldId,
  key,
  label: key === 'row_identity' ? 'Row identity' : 'Recovered amount',
  description: null,
  logicalType,
  nullable: true,
  defaultValue: null,
  cardinality: 'one',
  quantity: null,
  validation: {},
  category: null,
  relationship:
    logicalType === 'reference'
      ? {
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        }
      : null,
  computation: { mode: 'stored' },
  lifecycle: 'active',
})

const calculation = () => ({
  id: CALCULATION,
  key: 'recovery',
  label: 'Recovery',
  lifecycle: 'active',
  outputField: {
    ...field(CALCULATION, 'recovery', 'decimal'),
    computation: { mode: 'computed', expressionId: CALCULATION },
  },
  dependencies: [{ kind: 'local-field', id: INPUT }],
  expression: { language: 'sheetbase-formula-v1', source: '=A1*2' },
})

function state() {
  return {
    bindings: [
      {
        bindingId: BINDING,
        parameterId: PARAMETER,
        kind: 'dataset',
        datasetId: sourceDatasetId,
        policy: { mode: 'live' },
      },
    ],
    localFields: [
      field(IDENTITY, 'row_identity', 'reference'),
      field(INPUT, 'recovered_amount', 'decimal'),
    ],
    localValues: { [ROW]: { [INPUT]: SECRET_VALUE } },
    calculationOverrides: {
      [OVERRIDE]: {
        enabled: true,
        expression: {
          language: 'sheetbase-formula-v1',
          source: '=A1+1',
        },
      },
    },
    presentation: {
      columnOrder: [IDENTITY, INPUT, CALCULATION],
      hiddenColumnIds: [INPUT],
      columnWidths: { [IDENTITY]: 1200, [INPUT]: 180 },
      frozenColumnCount: 1,
      density: 'compact',
      filters: [
        { columnId: INPUT, operator: 'equals', value: SECRET_FILTER },
        { columnId: IDENTITY, operator: 'is-not-empty' },
      ],
      sorts: [{ columnId: INPUT, direction: 'desc' }],
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

async function actor(client: Client, user: string, workspace = WS) {
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: user,
      workspace_id: workspace,
      role: 'authenticated',
    }),
  ])
}

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  member = await database.asRole('authenticator')
  outsider = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','sheet-extract-owner@test.invalid',true),
      ($2,'Member','sheet-extract-member@test.invalid',true),
      ($3,'Outsider','sheet-extract-outsider@test.invalid',true)`,
    [OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'sheet-extract','Sheet extraction')`,
    [WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, MEMBER],
  )
  await actor(owner, OWNER)
  await actor(member, MEMBER)
  await actor(outsider, OUTSIDER)

  const schemaId = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,'extraction_source','Extraction source') returning id`,
      [WS],
    )
  ).rows[0].id
  schemaVersionId = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version,lifecycle,published_at) values($1,1,'active',now()) returning id`,
      [schemaId],
    )
  ).rows[0].id
  await migrator.query(
    `insert into api.datasets(workspace_id,schema_version_id,name) values
      ($1,$2,'Source concrete Dataset'),($1,$2,'Independent compatible Dataset')`,
    [WS, schemaVersionId],
  )
  const datasets = await migrator.query(
    `select id,name from api.datasets where workspace_id=$1 and schema_version_id=$2`,
    [WS, schemaVersionId],
  )
  sourceDatasetId = datasets.rows.find(
    (row) => row.name === 'Source concrete Dataset',
  ).id
  independentDatasetId = datasets.rows.find(
    (row) => row.name === 'Independent compatible Dataset',
  ).id

  source = (
    await owner.query(
      `select to_jsonb(api.create_sheet_instance($1,'Ad hoc recovery work',null,null,null,null,$2::jsonb)) result`,
      [WS, JSON.stringify(state())],
    )
  ).rows[0].result
  source = (
    await owner.query(
      `select to_jsonb(api.mutate_sheet_instance_calculations($1,$2,$3,$4::jsonb)) result`,
      [
        source.id,
        source.revision,
        crypto.randomUUID(),
        JSON.stringify([{ operation: 'add', calculation: calculation() }]),
      ],
    )
  ).rows[0].result
  selection = {
    bindings: [
      {
        bindingId: BINDING,
        key: 'measurements',
        parameter: {
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
      },
    ],
    columnIds: [],
    joinIds: [],
    localFieldIds: [IDENTITY, INPUT],
    calculationIds: [CALCULATION],
    rowIdentity: { kind: 'local', columnIds: [IDENTITY] },
    includePresentation: true,
  }
})

afterAll(async () => {
  await Promise.all([owner?.end(), member?.end(), outsider?.end()])
  await migrator?.end()
})

describe('Sheet Instance to Definition extraction', () => {
  it('previews exact reuse and exclusions without leaking values or concrete bindings', async () => {
    const preview = (
      await member.query(
        `select api.preview_sheet_definition_extraction($1,$2,$3::jsonb) result`,
        [source.id, source.revision, JSON.stringify(selection)],
      )
    ).rows[0].result
    expect(preview.manifest.reusable).toMatchObject({
      bindingIds: [BINDING],
      localFieldIds: [IDENTITY, INPUT],
      calculationIds: [CALCULATION],
      presentationDefaultsIncluded: true,
    })
    expect(preview.manifest.excluded).toMatchObject({
      concreteBindingValueBindingIds: [BINDING],
      localValues: { rowCount: 1, cellCount: 1 },
      calculationOverrideIds: [OVERRIDE],
      calculationResults: 'all',
      presentationValueFilterCount: 1,
      presentationOutOfRangeWidthColumnIds: [IDENTITY],
      rowIdentitiesDerivedFromValues: 'all',
    })
    expect(preview.configuration.calculations[0].inputColumnIds).toEqual([
      INPUT,
    ])
    expect(preview.configuration.presentation.filters).toEqual([
      { columnId: IDENTITY, operator: 'is-not-empty' },
    ])
    const serialized = JSON.stringify(preview.configuration)
    expect(serialized).not.toContain(String(SECRET_VALUE))
    expect(serialized).not.toContain(SECRET_FILTER)
    expect(serialized).not.toContain(sourceDatasetId)
    expect(serialized).not.toContain(ROW)
    expect(preview.configuration.presentation.columnWidths).toEqual({
      [INPUT]: 180,
    })
  })

  it('enforces membership, Definition authority, valid selection and Instance CAS', async () => {
    const callPreview = (client: Client, revision: number, value = selection) =>
      client.query(
        `select api.preview_sheet_definition_extraction($1,$2,$3::jsonb)`,
        [source.id, revision, JSON.stringify(value)],
      )
    await expect(callPreview(outsider, source.revision)).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      callPreview(member, source.revision - 1),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      callPreview(member, source.revision, {
        ...selection,
        localFieldIds: [IDENTITY],
      }),
    ).rejects.toMatchObject({ code: 'SB086' })
    await expect(
      member.query(
        `select api.extract_sheet_definition_draft($1,$2,'denied','Denied',null,$3::jsonb)`,
        [source.id, source.revision, JSON.stringify(selection)],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(
        `select api.extract_sheet_definition_draft($1,$2,'stale','Stale',null,$3::jsonb)`,
        [source.id, source.revision - 1, JSON.stringify(selection)],
      ),
    ).rejects.toMatchObject({ code: 'SB073' })
  })

  it('creates only a draft, then supports explicit publication and an independent value-free Instance', async () => {
    const before = (
      await owner.query(
        `select to_jsonb(i) result from api.sheet_instances i where id=$1`,
        [source.id],
      )
    ).rows[0].result
    const extracted = (
      await owner.query(
        `select api.extract_sheet_definition_draft($1,$2,'reusable_recovery','Reusable recovery',null,$3::jsonb) result`,
        [source.id, source.revision, JSON.stringify(selection)],
      )
    ).rows[0].result
    expect(extracted.version.lifecycle).toBe('draft')
    expect(extracted.version.published_at).toBeNull()
    expect(extracted.version.configuration.localValues).toBeUndefined()
    expect(
      extracted.version.configuration.columns.map((item: any) => item.id),
    ).toEqual([IDENTITY, INPUT, CALCULATION])
    const after = (
      await owner.query(
        `select to_jsonb(i) result from api.sheet_instances i where id=$1`,
        [source.id],
      )
    ).rows[0].result
    expect(after).toEqual(before)

    const published = (
      await owner.query(
        `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
        [extracted.version.id],
      )
    ).rows[0].result
    const independent = (
      await member.query(
        `select to_jsonb(api.create_sheet_instance_from_definition($1,'Independent recovery',null,$2,null,null,$3::jsonb,$4::jsonb)) result`,
        [
          WS,
          published.id,
          JSON.stringify({
            bindings: [],
            localFields: [],
            localValues: {},
            calculationOverrides: {},
            provenance: { createdFrom: 'definition_version' },
          }),
          JSON.stringify([
            {
              parameterId: PARAMETER,
              kind: 'dataset',
              datasetId: independentDatasetId,
            },
          ]),
        ],
      )
    ).rows[0].result
    expect(independent.id).not.toBe(source.id)
    expect(independent.source_definition_version_id).toBe(published.id)
    expect(independent.state.bindings[0].datasetId).toBe(independentDatasetId)
    expect(independent.state.localValues).toEqual({})
    expect(independent.state.instanceCalculations).toBeUndefined()
    expect(JSON.stringify(independent.state)).not.toContain(
      String(SECRET_VALUE),
    )
    expect(JSON.stringify(independent.state)).not.toContain(sourceDatasetId)

    await expect(
      member.query(
        `select internal.build_sheet_definition_extraction_preview(null::api.sheet_instances,'{}'::jsonb)`,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
