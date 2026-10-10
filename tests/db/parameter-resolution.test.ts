import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseSheetDefinitionConfiguration } from '../../src/lib/sheet-definition'
import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS_A = '16000000-0000-4000-8000-000000000001'
const WS_B = '16000000-0000-4000-8000-000000000002'
const OWNER_A = 'parameter-resolution-owner-a'
const OWNER_B = 'parameter-resolution-owner-b'
const PARAMETER_ID = '16000000-0000-4000-8000-000000000010'
const BINDING_ID = '16000000-0000-4000-8000-000000000011'
const COLUMN_ID = '16000000-0000-4000-8000-000000000012'
const QUANTITY_FIELD = '16000000-0000-4000-8000-000000000020'
const CATEGORY_FIELD = '16000000-0000-4000-8000-000000000021'
const REFERENCE_FIELD = '16000000-0000-4000-8000-000000000022'
const OPTION_ID = '16000000-0000-4000-8000-000000000023'
const OTHER_OPTION_ID = '16000000-0000-4000-8000-000000000024'
const VOCABULARY_ID = '16000000-0000-4000-8000-000000000025'
const PROJECT_A = '16000000-0000-4000-8000-000000000030'
const PROJECT_B = '16000000-0000-4000-8000-000000000031'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

type Field = {
  fieldId: string
  key: string
  logicalType: string
  cardinality?: 'one' | 'many'
  quantity?: Record<string, unknown> | null
  category?: Record<string, unknown> | null
  relationship?: Record<string, unknown> | null
  lifecycle?: 'active' | 'retired'
}

const baselineFields = (): Field[] => [
  {
    fieldId: QUANTITY_FIELD,
    key: 'mass',
    logicalType: 'decimal',
    quantity: { kind: 'mass', dimension: 'mass', storageUnit: 'mg' },
  },
  {
    fieldId: CATEGORY_FIELD,
    key: 'outcome',
    logicalType: 'category',
    category: {
      kind: 'embedded',
      options: [
        {
          id: OPTION_ID,
          key: 'pass',
          label: 'Pass',
          displayOrder: 0,
          lifecycle: 'active',
        },
      ],
    },
  },
  {
    fieldId: REFERENCE_FIELD,
    key: 'sample',
    logicalType: 'reference',
    relationship: {
      target: { kind: 'model', modelKey: 'sample' },
      cardinality: 'one',
    },
  },
]

async function actor(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

async function schema(workspaceId: string, fieldsByVersion: Field[][]) {
  const schemaId = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name,lifecycle)
       values($1,$2,'Parameter schema','active') returning id`,
      [workspaceId, `parameter_${crypto.randomUUID().replaceAll('-', '')}`],
    )
  ).rows[0].id as string
  const versions: string[] = []
  for (const [index, fields] of fieldsByVersion.entries()) {
    const versionId = (
      await migrator.query(
        `insert into api.dataset_schema_versions(schema_id,version) values($1,$2) returning id`,
        [schemaId, index + 1],
      )
    ).rows[0].id as string
    for (const [displayOrder, field] of fields.entries()) {
      await migrator.query(
        `insert into api.dataset_schema_version_fields
          (schema_version_id,field_id,key,label,logical_type,cardinality,quantity,category,relationship,lifecycle,display_order)
         values($1,$2,$3,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
        [
          versionId,
          field.fieldId,
          field.key,
          field.logicalType,
          field.cardinality ?? 'one',
          field.quantity ? JSON.stringify(field.quantity) : null,
          field.category ? JSON.stringify(field.category) : null,
          field.relationship ? JSON.stringify(field.relationship) : null,
          field.lifecycle ?? 'active',
          displayOrder,
        ],
      )
    }
    await migrator.query(
      `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
      [versionId],
    )
    versions.push(versionId)
  }
  return { schemaId, versions }
}

async function dataset(workspaceId: string, schemaVersionId: string) {
  return (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Candidate') returning id`,
      [workspaceId, schemaVersionId],
    )
  ).rows[0].id as string
}

function canonicalField(field: Field) {
  return {
    fieldId: COLUMN_ID,
    key: 'source',
    label: 'Source',
    description: null,
    logicalType: field.logicalType,
    nullable: true,
    defaultValue: null,
    cardinality: field.cardinality ?? 'one',
    quantity: field.quantity ?? null,
    validation: {},
    category: field.category ?? null,
    relationship: field.relationship ?? null,
    computation: { mode: 'stored' as const },
    lifecycle: 'active' as const,
  }
}

function configuration(
  parameter: Record<string, unknown>,
  field = baselineFields()[0],
) {
  const value: any = structuredClone(validSheetDefinitionConfiguration())
  value.parameters = [{ id: PARAMETER_ID, ...parameter }]
  const objectParameter = (parameter.type as { kind: string }).kind !== 'scalar'
  value.bindings = objectParameter
    ? [{ id: BINDING_ID, key: 'source', parameterId: PARAMETER_ID }]
    : []
  value.columns = [
    {
      id: COLUMN_ID,
      field: canonicalField(
        objectParameter
          ? field
          : {
              fieldId: COLUMN_ID,
              key: 'row',
              logicalType: 'reference',
              relationship: {
                target: { kind: 'model', modelKey: 'sample' },
                cardinality: 'one',
              },
            },
      ),
      source: objectParameter
        ? {
            kind: 'bound',
            bindingId: BINDING_ID,
            sourceFieldId: field.fieldId,
          }
        : { kind: 'declared' },
    },
  ]
  value.rowIdentity = {
    kind: objectParameter ? 'source' : 'local',
    columnIds: [COLUMN_ID],
  }
  value.joins = []
  value.calculations = []
  value.writeBackRules = []
  value.actions = []
  value.presentation = {
    columnOrder: [COLUMN_ID],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  }
  return parseSheetDefinitionConfiguration(value)
}

async function publish(owner: Client, config: unknown) {
  const created = (
    await owner.query(
      `select api.create_sheet_definition($1,$2,'Parameters',null,$3::jsonb) result`,
      [
        WS_A,
        `parameters_${crypto.randomUUID().replaceAll('-', '')}`,
        JSON.stringify(config),
      ],
    )
  ).rows[0].result
  await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
    created.version.id,
  ])
  return created.version.id as string
}

const emptyState = () => ({
  bindings: [],
  parameterValues: [],
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
  resolutionProvenance: {
    sourceDefinitionVersionId: crypto.randomUUID(),
    resolvedAt: new Date(0).toISOString(),
    resolvedByUserId: 'forged',
    parameters: [],
  },
})

async function instantiate(
  owner: Client,
  definitionVersionId: string,
  inputs: unknown[],
) {
  return (
    await owner.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,'Resolved',null,$2,null,null,$3::jsonb,$4::jsonb)) result`,
      [
        WS_A,
        definitionVersionId,
        JSON.stringify(emptyState()),
        JSON.stringify(inputs),
      ],
    )
  ).rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner A','parameter-a@test.invalid',true),($2,'Owner B','parameter-b@test.invalid',true)`,
    [OWNER_A, OWNER_B],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'parameter-a','A'),($2,'parameter-b','B')`,
    [WS_A, WS_B],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$3,'owner'),($2,$4,'owner')`,
    [WS_A, WS_B, OWNER_A, OWNER_B],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values($1,$3,'parameter-a','A',$5),($2,$4,'parameter-b','B',$6)`,
    [PROJECT_A, PROJECT_B, WS_A, WS_B, OWNER_A, OWNER_B],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('server-authoritative Parameter resolution', () => {
  it('instantiates one exact Definition against two Datasets and rejects a different version', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await schema(WS_A, [baselineFields(), baselineFields()])
    const first = await dataset(WS_A, fixture.versions[0])
    const second = await dataset(WS_A, fixture.versions[0])
    const wrong = await dataset(WS_A, fixture.versions[1])
    const inactive = await dataset(WS_A, fixture.versions[0])
    await migrator.query(
      `update api.datasets set lifecycle='archived' where id=$1`,
      [inactive],
    )
    const otherWorkspaceSchema = await schema(WS_B, [baselineFields()])
    const otherWorkspace = await dataset(WS_B, otherWorkspaceSchema.versions[0])
    const definition = await publish(
      owner,
      configuration({
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId: fixture.versions[0] },
        },
        constraints: {},
      }),
    )
    const one = await instantiate(owner, definition, [
      { parameterId: PARAMETER_ID, kind: 'dataset', datasetId: first },
    ])
    const two = await instantiate(owner, definition, [
      { parameterId: PARAMETER_ID, kind: 'dataset', datasetId: second },
    ])
    expect(one.state.bindings[0].datasetId).toBe(first)
    expect(two.state.bindings[0].datasetId).toBe(second)
    expect(one.state.resolutionProvenance.resolvedByUserId).toBe(OWNER_A)
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'dataset', datasetId: wrong },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
    for (const datasetId of [inactive, otherWorkspace]) {
      await expect(
        instantiate(owner, definition, [
          { parameterId: PARAMETER_ID, kind: 'dataset', datasetId },
        ]),
      ).rejects.toMatchObject({ code: 'SB074' })
    }
  })

  it('accepts compatible lineage and rejects removed/type/cardinality/quantity/category/reference changes', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const good = baselineFields()
    const variants = [
      good.filter((field) => field.fieldId !== QUANTITY_FIELD),
      good.map((field) =>
        field.fieldId === QUANTITY_FIELD
          ? { ...field, logicalType: 'integer', quantity: null }
          : field,
      ),
      good.map((field) =>
        field.fieldId === QUANTITY_FIELD
          ? { ...field, cardinality: 'many' as const }
          : field,
      ),
      good.map((field) =>
        field.fieldId === QUANTITY_FIELD
          ? {
              ...field,
              quantity: {
                kind: 'concentration',
                dimension: 'mass/volume',
                storageUnit: 'mg/mL',
              },
            }
          : field,
      ),
      good.map((field) =>
        field.fieldId === CATEGORY_FIELD
          ? {
              ...field,
              category: {
                kind: 'embedded',
                options: [
                  {
                    id: OTHER_OPTION_ID,
                    key: 'pass',
                    label: 'Pass',
                    displayOrder: 0,
                    lifecycle: 'active',
                  },
                ],
              },
            }
          : field,
      ),
      good.map((field) =>
        field.fieldId === REFERENCE_FIELD
          ? {
              ...field,
              relationship: {
                target: { kind: 'model', modelKey: 'material' },
                cardinality: 'one',
              },
            }
          : field,
      ),
    ]
    const fixture = await schema(WS_A, [good, good, ...variants])
    const definition = await publish(
      owner,
      configuration({
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset',
          contract: {
            mode: 'lineage',
            baselineSchemaVersionId: fixture.versions[0],
          },
        },
        constraints: {},
      }),
    )
    const compatible = await dataset(WS_A, fixture.versions[1])
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'dataset', datasetId: compatible },
      ]),
    ).resolves.toBeDefined()
    for (const version of fixture.versions.slice(2)) {
      const incompatible = await dataset(WS_A, version)
      await expect(
        instantiate(owner, definition, [
          {
            parameterId: PARAMETER_ID,
            kind: 'dataset',
            datasetId: incompatible,
          },
        ]),
      ).rejects.toMatchObject({ code: 'SB074' })
    }
  })

  it('accepts stable-ID semantic compatibility across Schemas and rejects label-only and semantic mismatches', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const baseline = await schema(WS_A, [baselineFields()])
    const compatible = baselineFields().map((field) => ({
      ...field,
      key: `renamed_${field.key}`,
    }))
    const candidate = await schema(WS_A, [
      compatible,
      compatible.map((field) =>
        field.fieldId === QUANTITY_FIELD
          ? { ...field, fieldId: crypto.randomUUID(), key: 'mass' }
          : field,
      ),
    ])
    const definition = await publish(
      owner,
      configuration({
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset',
          contract: {
            mode: 'semantic',
            baselineSchemaVersionId: baseline.versions[0],
            requiredFieldIds: [QUANTITY_FIELD, CATEGORY_FIELD, REFERENCE_FIELD],
          },
        },
        constraints: {},
      }),
    )
    await expect(
      instantiate(owner, definition, [
        {
          parameterId: PARAMETER_ID,
          kind: 'dataset',
          datasetId: await dataset(WS_A, candidate.versions[0]),
        },
      ]),
    ).resolves.toBeDefined()
    await expect(
      instantiate(owner, definition, [
        {
          parameterId: PARAMETER_ID,
          kind: 'dataset',
          datasetId: await dataset(WS_A, candidate.versions[1]),
        },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
  })

  it('compares governed vocabulary identity without using labels', async () => {
    const baseline = {
      kind: 'vocabulary',
      vocabularyId: VOCABULARY_ID,
    }
    const renamed = { ...baseline, label: 'Renamed presentation label' }
    const other = { ...baseline, vocabularyId: crypto.randomUUID() }
    const result = await migrator.query(
      `select
        internal.category_semantics_compatible($1::jsonb,$2::jsonb) renamed,
        internal.category_semantics_compatible($1::jsonb,$3::jsonb) mismatched`,
      [
        JSON.stringify(baseline),
        JSON.stringify(renamed),
        JSON.stringify(other),
      ],
    )
    expect(result.rows[0]).toEqual({ renamed: true, mismatched: false })
  })

  it('preserves embedded category option IDs and machine keys while allowing labels and active supersets', async () => {
    const baseline = baselineFields()[1].category
    const baselineOption = (
      baseline?.options as Array<Record<string, unknown>>
    )[0]
    const renamed = {
      ...baseline,
      options: [{ ...baselineOption, label: 'Renamed label' }],
    }
    const changedKey = {
      ...baseline,
      options: [{ ...baselineOption, key: 'changed_key' }],
    }
    const superset = {
      ...renamed,
      options: [
        ...(renamed.options as Array<Record<string, unknown>>),
        {
          id: OTHER_OPTION_ID,
          key: 'review',
          label: 'Review',
          displayOrder: 1,
          lifecycle: 'active',
        },
      ],
    }
    const result = await migrator.query(
      `select
        internal.category_semantics_compatible($1::jsonb,$2::jsonb) renamed,
        internal.category_semantics_compatible($1::jsonb,$3::jsonb) changed_key,
        internal.category_semantics_compatible($1::jsonb,$4::jsonb) superset`,
      [
        JSON.stringify(baseline),
        JSON.stringify(renamed),
        JSON.stringify(changedKey),
        JSON.stringify(superset),
      ],
    )
    expect(result.rows[0]).toEqual({
      renamed: true,
      changed_key: false,
      superset: true,
    })
  })

  it('pins Dataset Version schema provenance and does not admit it to a live Dataset parameter', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await schema(WS_A, [baselineFields()])
    const datasetId = await dataset(WS_A, fixture.versions[0])
    const snapshot = (
      await owner.query(
        `select to_jsonb(api.snapshot_dataset($1,1,'Input')) result`,
        [datasetId],
      )
    ).rows[0].result
    const definition = await publish(
      owner,
      configuration({
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset-version',
          contract: { mode: 'exact', schemaVersionId: fixture.versions[0] },
        },
        constraints: {},
      }),
    )
    const instance = await instantiate(owner, definition, [
      {
        parameterId: PARAMETER_ID,
        kind: 'dataset-version',
        datasetVersionId: snapshot.id,
      },
    ])
    expect(instance.state.bindings[0]).toMatchObject({
      datasetId,
      policy: { mode: 'version', datasetVersionId: snapshot.id },
      resolution: { candidateSchemaVersionId: fixture.versions[0] },
    })
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'dataset', datasetId },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
  })

  it('applies scalar defaults/constraints and rejects missing, unknown and duplicate inputs', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const definition = await publish(
      owner,
      configuration({
        key: 'threshold',
        label: 'Threshold',
        required: true,
        type: { kind: 'scalar', valueType: 'integer' },
        defaultValue: 5,
        constraints: { min: 1, max: 10 },
      }),
    )
    const instance = await instantiate(owner, definition, [])
    expect(instance.state.parameterValues).toEqual([
      {
        parameterId: PARAMETER_ID,
        kind: 'scalar',
        valueType: 'integer',
        value: 5,
        source: 'default',
      },
    ])
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'scalar', value: 11 },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
    await expect(
      instantiate(owner, definition, [
        { parameterId: crypto.randomUUID(), kind: 'scalar', value: 5 },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'scalar', value: 5 },
        { parameterId: PARAMETER_ID, kind: 'scalar', value: 5 },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })

    const required = await publish(
      owner,
      configuration({
        key: 'threshold_required',
        label: 'Required',
        required: true,
        type: { kind: 'scalar', valueType: 'integer' },
        constraints: {},
      }),
    )
    await expect(instantiate(owner, required, [])).rejects.toMatchObject({
      code: 'SB074',
    })
  })

  it('proves Record<Model>, workspace and deletion contracts', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const definition = await publish(
      owner,
      configuration({
        key: 'sample',
        label: 'Sample',
        required: true,
        type: { kind: 'record', modelKey: 'sample' },
        constraints: {},
      }),
    )
    const sample = (
      await migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id) values($1,$2,'sample','S-1','Sample',$3) returning id`,
        [WS_A, PROJECT_A, OWNER_A],
      )
    ).rows[0].id
    const wrongKind = (
      await migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id) values($1,$2,'experiment','E-1','Experiment',$3) returning id`,
        [WS_A, PROJECT_A, OWNER_A],
      )
    ).rows[0].id
    const otherWorkspace = (
      await migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id) values($1,$2,'sample','S-2','Other',$3) returning id`,
        [WS_B, PROJECT_B, OWNER_B],
      )
    ).rows[0].id
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'record', recordId: sample },
      ]),
    ).resolves.toBeDefined()
    for (const recordId of [wrongKind, otherWorkspace]) {
      await expect(
        instantiate(owner, definition, [
          { parameterId: PARAMETER_ID, kind: 'record', recordId },
        ]),
      ).rejects.toMatchObject({ code: 'SB074' })
    }
    await migrator.query(
      `update api.records set deleted_at=now() where id=$1`,
      [sample],
    )
    await expect(
      instantiate(owner, definition, [
        { parameterId: PARAMETER_ID, kind: 'record', recordId: sample },
      ]),
    ).rejects.toMatchObject({ code: 'SB074' })
  })

  it('overwrites forged provenance, preserves resolution through reload/duplicate, and denies helper/direct access', async () => {
    const owner = await actor(OWNER_A, WS_A)
    const fixture = await schema(WS_A, [baselineFields()])
    const datasetId = await dataset(WS_A, fixture.versions[0])
    const definition = await publish(
      owner,
      configuration({
        key: 'source',
        label: 'Source',
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId: fixture.versions[0] },
        },
        constraints: {},
      }),
    )
    const instance = await instantiate(owner, definition, [
      { parameterId: PARAMETER_ID, kind: 'dataset', datasetId },
    ])
    expect(instance.state.resolutionProvenance.resolvedByUserId).not.toBe(
      'forged',
    )
    const updated = (
      await owner.query(
        `select to_jsonb(api.update_sheet_instance($1,1,$2::jsonb)) result`,
        [instance.id, JSON.stringify(emptyState())],
      )
    ).rows[0].result
    expect(updated.state.bindings).toEqual(instance.state.bindings)
    expect(updated.state.resolutionProvenance).toEqual(
      instance.state.resolutionProvenance,
    )
    const duplicate = (
      await owner.query(
        `select to_jsonb(api.duplicate_sheet_instance($1,2,'Copy')) result`,
        [updated.id],
      )
    ).rows[0].result
    expect(duplicate.state.resolutionProvenance).toEqual(
      instance.state.resolutionProvenance,
    )
    expect(
      (
        await owner.query(
          `select state->'resolutionProvenance' provenance from api.sheet_instances where id=$1`,
          [duplicate.id],
        )
      ).rows[0].provenance,
    ).toEqual(instance.state.resolutionProvenance)
    await migrator.query('begin')
    try {
      await migrator.query(
        `select set_config('sheetbase.sheet_instance_write','rpc-v1',true)`,
      )
      await expect(
        migrator.query(
          `update api.sheet_instances
           set state=jsonb_set(state,'{resolutionProvenance,parameters}','[{"parameterId":"not-a-uuid"}]'::jsonb)
           where id=$1`,
          [instance.id],
        ),
      ).rejects.toMatchObject({ code: 'SB073' })
    } finally {
      await migrator.query('rollback')
    }
    await expect(
      owner.query(
        `select internal.resolve_sheet_parameters($1,$2,'[]'::jsonb)`,
        [WS_A, definition],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`update api.sheet_instances set state='{}' where id=$1`, [
        instance.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
