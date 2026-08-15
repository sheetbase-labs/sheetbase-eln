import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '18000000-0000-4000-8000-000000000001'
const OTHER_WS = '18000000-0000-4000-8000-000000000002'
const OWNER = 'composition-owner'
const OUTSIDER = 'composition-outsider'
const SAMPLE_FIELD = '18000000-0000-4000-8000-000000000010'
const RESULT_FIELD = '18000000-0000-4000-8000-000000000011'
const ROOT_BINDING = '18000000-0000-4000-8000-000000000020'
const FIRST_BINDING = '18000000-0000-4000-8000-000000000021'
const SECOND_BINDING = '18000000-0000-4000-8000-000000000022'
const RECORD_BINDING = '18000000-0000-4000-8000-000000000023'
const ROOT_COLUMN = '18000000-0000-4000-8000-000000000030'
const FIRST_COLUMN = '18000000-0000-4000-8000-000000000031'
const SECOND_COLUMN = '18000000-0000-4000-8000-000000000032'
const RECORD_COLUMN = '18000000-0000-4000-8000-000000000033'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(user: string, workspace: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
  return client
}

async function dataset(name: string) {
  const schema = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,$2,$2) returning id`,
      [WS, `composition_${crypto.randomUUID().replaceAll('-', '')}`],
    )
  ).rows[0].id as string
  const version = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version) values($1,1) returning id`,
      [schema],
    )
  ).rows[0].id as string
  const field = name === 'sample' ? SAMPLE_FIELD : RESULT_FIELD
  await migrator.query(
    `insert into api.dataset_schema_version_fields(schema_version_id,field_id,key,label,logical_type,cardinality,relationship,lifecycle,display_order)
     values($1,$2,'sample','Sample','reference','one',$3::jsonb,'active',0)`,
    [
      version,
      field,
      JSON.stringify({
        target: { kind: 'model', modelKey: 'sample' },
        cardinality: 'one',
      }),
    ],
  )
  await migrator.query(
    `update api.dataset_schema_versions set lifecycle='active',published_at=now() where id=$1`,
    [version],
  )
  const datasetId = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,$3) returning id`,
      [WS, version, name],
    )
  ).rows[0].id as string
  return { datasetId, version }
}

async function row(datasetId: string, field: string, sample: string) {
  const created = (
    await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS],
    )
  ).rows[0].id as string
  await migrator.query(
    `insert into api.dataset_row_values(row_id,field_id,reference_id) values($1,$2,$3)`,
    [created, field, sample],
  )
  return created
}

async function sampleRecord() {
  return (
    await migrator.query(
      `insert into api.records(workspace_id,kind,identifier,title,created_by_user_id,deleted_at)
       values($1,'sample',$2,'Sample',$3,null) returning id`,
      [WS, `S-${crypto.randomUUID()}`, OWNER],
    )
  ).rows[0].id as string
}

async function blankRow(datasetId: string) {
  return (
    await migrator.query(
      `insert into api.dataset_rows(dataset_id,workspace_id) values($1,$2) returning id`,
      [datasetId, WS],
    )
  ).rows[0].id as string
}

function configuration(
  versions: string[],
  joinType: 'inner' | 'left',
  cardinality: 'one-to-one' | 'many-to-one',
  chained = false,
  recordFieldId?: string,
) {
  const bindings = [ROOT_BINDING, FIRST_BINDING, SECOND_BINDING].map(
    (id, index) => ({
      id,
      key: `source_${index}`,
      parameterId: crypto.randomUUID(),
    }),
  )
  const fields = [ROOT_COLUMN, FIRST_COLUMN, SECOND_COLUMN]
  if (recordFieldId)
    bindings.push({
      id: RECORD_BINDING,
      key: 'record_source',
      parameterId: crypto.randomUUID(),
    })
  return {
    formatVersion: 1,
    parameters: [
      ...versions.map((version, index) => ({
        id: bindings[index].parameterId,
        key: `source_${index}`,
        label: `Source ${index}`,
        required: true,
        type: {
          kind: 'dataset',
          contract: { mode: 'exact', schemaVersionId: version },
        },
        constraints: {},
      })),
      ...(recordFieldId
        ? [
            {
              id: bindings[3].parameterId,
              key: 'record_source',
              label: 'Record source',
              required: true,
              type: { kind: 'record', modelKey: 'sample' },
              constraints: {},
            },
          ]
        : []),
    ],
    bindings,
    rowIdentity: { kind: 'source', columnIds: [ROOT_COLUMN] },
    joins: [
      {
        id: crypto.randomUUID(),
        leftBindingId: ROOT_BINDING,
        rightBindingId: FIRST_BINDING,
        leftColumnId: ROOT_COLUMN,
        rightColumnId: FIRST_COLUMN,
        joinType,
        cardinality,
      },
      {
        id: crypto.randomUUID(),
        leftBindingId: chained ? FIRST_BINDING : ROOT_BINDING,
        rightBindingId: SECOND_BINDING,
        leftColumnId: chained ? FIRST_COLUMN : ROOT_COLUMN,
        rightColumnId: SECOND_COLUMN,
        joinType: 'left',
        cardinality: 'many-to-one',
      },
    ],
    columns: [
      ...fields.map((id, index) => ({
        id,
        field: {
          fieldId: id,
          key: `sample_${index}`,
          label: 'Sample',
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
        source: {
          kind: 'bound',
          bindingId: bindings[index].id,
          sourceFieldId: index === 0 ? SAMPLE_FIELD : RESULT_FIELD,
        },
      })),
      ...(recordFieldId
        ? [
            {
              id: RECORD_COLUMN,
              field: {
                fieldId: RECORD_COLUMN,
                key: 'record_note',
                label: 'Record note',
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
              source: {
                kind: 'bound',
                bindingId: RECORD_BINDING,
                sourceFieldId: recordFieldId,
              },
            },
          ]
        : []),
    ],
    calculations: [],
    writeBackRules: [],
    actions: [],
    presentation: {
      columnOrder: recordFieldId ? [...fields, RECORD_COLUMN] : fields,
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
  }
}

async function instance(
  owner: Client,
  joinType: 'inner' | 'left' = 'left',
  cardinality: 'one-to-one' | 'many-to-one' = 'many-to-one',
  chained = false,
  record?: { id: string; fieldId: string },
) {
  const sources: Array<{ datasetId: string; version: string }> = []
  for (const name of ['sample', 'first', 'second'])
    sources.push(await dataset(name))
  const datasetIds = sources.map((source) => source.datasetId)
  const versions = sources.map((source) => source.version)
  const definition = (
    await owner.query(
      `select api.create_sheet_definition($1,$2,'Composition',null,$3::jsonb) result`,
      [
        WS,
        `composition_${crypto.randomUUID().replaceAll('-', '')}`,
        JSON.stringify(
          configuration(
            versions,
            joinType,
            cardinality,
            chained,
            record?.fieldId,
          ),
        ),
      ],
    )
  ).rows[0].result
  await owner.query(`select api.publish_sheet_definition_version($1,1)`, [
    definition.version.id,
  ])
  const inputs = datasetIds.map((datasetId, index) => ({
    parameterId: definition.version.configuration.parameters[index].id,
    kind: 'dataset',
    datasetId,
  }))
  if (record)
    inputs.push({
      parameterId: definition.version.configuration.parameters[3].id,
      kind: 'record',
      recordId: record.id,
    })
  const state = {
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
  }
  const created = (
    await owner.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,'Composition',null,$2,null,null,$3::jsonb,$4::jsonb)) result`,
      [
        WS,
        definition.version.id,
        JSON.stringify(state),
        JSON.stringify(inputs),
      ],
    )
  ).rows[0].result
  const resolved = (
    await owner.query(
      `select to_jsonb(api.resolve_sheet_instance_row_identity($1,1)) result`,
      [created.id],
    )
  ).rows[0].result
  return { sources: datasetIds, instance: resolved }
}

async function query(client: Client, id: string, limit = 50, offset = 0) {
  return (
    await client.query(
      `select api.query_sheet_instance_rows($1,$2,$3) result`,
      [id, limit, offset],
    )
  ).rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values($1,'Owner','composition-owner@test.invalid',true),($2,'Outsider','composition-outsider@test.invalid',true)`,
    [OWNER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'composition','Composition'),($2,'composition-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$3,'owner'),($2,$4,'owner')`,
    [WS, OTHER_WS, OWNER, OUTSIDER],
  )
})
afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('bounded Sheet Instance composition RPC', () => {
  it('composes Sample plus two result Datasets, preserving source provenance and stable root paging', async () => {
    const owner = await actor(OWNER, WS)
    const fixture = await instance(owner)
    const sampleA = await sampleRecord()
    const sampleB = await sampleRecord()
    const rootA = await row(fixture.sources[0], SAMPLE_FIELD, sampleA)
    await row(fixture.sources[0], SAMPLE_FIELD, sampleA)
    await row(fixture.sources[0], SAMPLE_FIELD, sampleB)
    await row(fixture.sources[1], RESULT_FIELD, sampleA)
    await row(fixture.sources[2], RESULT_FIELD, sampleA)
    const first = await query(owner, fixture.instance.id, 1, 0)
    const second = await query(owner, fixture.instance.id, 1, 1)
    const reload = await query(owner, fixture.instance.id, 1, 0)
    const all = await query(owner, fixture.instance.id)
    expect(first).toMatchObject({
      hasMore: true,
      definitionVersionId: fixture.instance.source_definition_version_id,
      definitionConfiguration: {
        columns: expect.arrayContaining([
          expect.objectContaining({
            id: ROOT_COLUMN,
            source: expect.objectContaining({
              bindingId: ROOT_BINDING,
              sourceFieldId: SAMPLE_FIELD,
            }),
          }),
        ]),
      },
      rows: [expect.anything()],
    })
    expect(
      all.rows.find((item: { sources: Array<{ rowId: string }> }) =>
        item.sources.some((source) => source.rowId === rootA),
      )?.sources,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowId: rootA, matched: true }),
        expect.objectContaining({ matched: true }),
      ]),
    )
    expect(second.rows).toHaveLength(1)
    expect(reload.rows).toEqual(first.rows)
    expect(
      (await query(owner, fixture.instance.id)).rows.filter(
        (item: { identityValues: string[] }) =>
          item.identityValues[0] === sampleA,
      ),
    ).toHaveLength(2)
  })

  it('implements inner exclusion, left unmatched state, and rejects all cardinality/topology/state failures', async () => {
    const owner = await actor(OWNER, WS)
    const left = await instance(owner, 'left')
    const sample = await sampleRecord()
    await row(left.sources[0], SAMPLE_FIELD, sample)
    expect((await query(owner, left.instance.id)).rows[0].sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingId: FIRST_BINDING,
          matched: false,
          rowId: null,
        }),
      ]),
    )
    const inner = await instance(owner, 'inner')
    await row(inner.sources[0], SAMPLE_FIELD, await sampleRecord())
    expect((await query(owner, inner.instance.id)).rows).toEqual([])
    const duplicate = await instance(owner)
    const duplicateSample = await sampleRecord()
    await row(duplicate.sources[0], SAMPLE_FIELD, duplicateSample)
    await row(duplicate.sources[1], RESULT_FIELD, duplicateSample)
    await row(duplicate.sources[1], RESULT_FIELD, duplicateSample)
    await expect(query(owner, duplicate.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    const one = await instance(owner, 'left', 'one-to-one')
    const oneSample = await sampleRecord()
    await row(one.sources[0], SAMPLE_FIELD, oneSample)
    await row(one.sources[0], SAMPLE_FIELD, oneSample)
    await expect(query(owner, one.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    const chained = await instance(owner, 'left', 'many-to-one', true)
    await expect(query(owner, chained.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    const missing = await instance(owner)
    await blankRow(missing.sources[0])
    await expect(query(owner, missing.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    await expect(query(owner, left.instance.id, 0)).rejects.toMatchObject({
      code: '22023',
    })
    await owner.query(`select api.archive_sheet_instance($1,$2)`, [
      left.instance.id,
      left.instance.revision,
    ])
    await expect(query(owner, left.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    const stale = await instance(owner)
    await migrator.query('begin')
    try {
      await migrator.query(
        `select set_config('sheetbase.sheet_instance_write','rpc-v1',true)`,
      )
      await migrator.query(
        `update api.sheet_instances set state=jsonb_set(state,'{resolutionProvenance,sourceDefinitionVersionId}',to_jsonb($2::text)) where id=$1`,
        [stale.instance.id, crypto.randomUUID()],
      )
      await migrator.query('commit')
    } catch (error) {
      await migrator.query('rollback')
      throw error
    }
    await expect(query(owner, stale.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
    const adHocState = {
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
    }
    const adHoc = (
      await owner.query(
        `select to_jsonb(api.create_sheet_instance($1,'Ad hoc',null,null,null,null,$2::jsonb)) result`,
        [WS, JSON.stringify(adHocState)],
      )
    ).rows[0].result
    await expect(query(owner, adHoc.id)).rejects.toMatchObject({
      code: 'SB076',
    })
  })

  it('projects an active resolved Record custom field as a constant governed source and rejects deleted Records', async () => {
    const owner = await actor(OWNER, WS)
    const field = (
      await owner.query(
        `select to_jsonb(api.create_model_field($1,'sample','composition_note','Composition note','text',true,null,'{}')) result`,
        [WS],
      )
    ).rows[0].result
    await owner.query(`select api.activate_model_field($1)`, [field.id])
    const record = (
      await migrator.query(
        `insert into api.records(workspace_id,kind,identifier,title,custom_fields,created_by_user_id)
         values($1,'sample',$2,'Bound Sample',$3::jsonb,$4) returning id`,
        [
          WS,
          `bound-${crypto.randomUUID()}`,
          JSON.stringify({ composition_note: null }),
          OWNER,
        ],
      )
    ).rows[0].id as string
    const fixture = await instance(owner, 'left', 'many-to-one', false, {
      id: record,
      fieldId: field.id,
    })
    await row(fixture.sources[0], SAMPLE_FIELD, await sampleRecord())
    const result = await query(owner, fixture.instance.id)
    expect(result.rows[0].sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: 'record',
          bindingId: RECORD_BINDING,
          recordId: record,
          values: { [field.id]: null },
        }),
      ]),
    )
    await migrator.query(
      `update api.records set deleted_at=now() where id=$1`,
      [record],
    )
    await expect(query(owner, fixture.instance.id)).rejects.toMatchObject({
      code: 'SB076',
    })
  })

  it('enforces workspace and execution ACLs', async () => {
    const owner = await actor(OWNER, WS)
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const fixture = await instance(owner)
    await expect(query(outsider, fixture.instance.id)).rejects.toMatchObject({
      code: '42501',
    })
    expect(
      (
        await migrator.query(
          `select has_function_privilege('authenticated','api.query_sheet_instance_rows(uuid,integer,integer)','EXECUTE') allowed,has_function_privilege('public','api.query_sheet_instance_rows(uuid,integer,integer)','EXECUTE') public,has_function_privilege('authenticated','api.query_sheet_instance_rows_core036(uuid,integer,integer)','EXECUTE') core036,has_function_privilege('authenticated','internal.sheet_composition_source_values(uuid,uuid)','EXECUTE') helper`,
        )
      ).rows[0],
    ).toEqual({ allowed: true, public: false, core036: false, helper: false })
  })
})
