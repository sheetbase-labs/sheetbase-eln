import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '32000000-0000-4000-8000-000000000001'
const OTHER_WS = '32000000-0000-4000-8000-000000000002'
const OWNER = 'sheet-upgrade-owner'
const MEMBER = 'sheet-upgrade-member'
const OUTSIDER = 'sheet-upgrade-outsider'
const IDENTITY = '32000000-0000-4000-8000-000000000003'
const REMOVED = '32000000-0000-4000-8000-000000000004'
const REPLACEMENT = '32000000-0000-4000-8000-000000000005'
const MEASURE = '32000000-0000-4000-8000-000000000006'
const SOURCE_FIELD = '32000000-0000-4000-8000-000000000007'
const TARGET_FIELD = '32000000-0000-4000-8000-000000000008'
const PARAMETER = '32000000-0000-4000-8000-000000000009'
const BINDING = '32000000-0000-4000-8000-00000000000a'
const WRITE_BACK = '32000000-0000-4000-8000-00000000000b'
const INSTANCE_CALCULATION = '32000000-0000-4000-8000-00000000000c'
const ROW = '32000000-0000-4000-8000-00000000000d'
const MAPPED_OLD = '32000000-0000-4000-8000-00000000000e'
const MAPPED_NEW = '32000000-0000-4000-8000-00000000000f'
let migrator: Client
let owner: Client
let member: Client
let outsider: Client
let schemaVersionId: string
let datasetId: string
let definitionId: string
let sourceVersionId: string
let targetVersionId: string
let changedRequirementVersionId: string
let incompatibleVersionId: string
let retained: any
let mapped: any

const field = (
  fieldId: string,
  key: string,
  logicalType: 'reference' | 'decimal',
) => ({
  fieldId,
  key,
  label: key,
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
      ? { target: { kind: 'model', modelKey: 'sample' }, cardinality: 'one' }
      : null,
  computation: { mode: 'stored' },
  lifecycle: 'active',
})

function configuration(version: 1 | 2 | 3 | 4) {
  const identity = field(IDENTITY, 'row_identity', 'reference')
  if (version >= 2) identity.label = 'Stable row identity'
  const parameter = {
    id: PARAMETER,
    key: 'measurements',
    label: 'Measurements',
    required: true,
    type: {
      kind: 'dataset',
      contract:
        version === 3
          ? { mode: 'lineage', baselineSchemaVersionId: schemaVersionId }
          : { mode: 'exact', schemaVersionId },
    },
    constraints: {},
  }
  const measure = {
    id: MEASURE,
    field: field(MEASURE, 'measure', 'decimal'),
    source: {
      kind: 'bound',
      bindingId: BINDING,
      sourceFieldId: version === 4 ? TARGET_FIELD : SOURCE_FIELD,
    },
  }
  const columns = [
    { id: IDENTITY, field: identity, source: { kind: 'declared' } },
    ...(version === 1
      ? [
          {
            id: REMOVED,
            field: field(REMOVED, 'local_observation', 'decimal'),
            source: { kind: 'declared' },
          },
        ]
      : [
          {
            id: REPLACEMENT,
            field: field(REPLACEMENT, 'replacement_observation', 'decimal'),
            source: { kind: 'declared' },
          },
        ]),
    {
      id: version === 1 ? MAPPED_OLD : MAPPED_NEW,
      field: {
        ...field(
          version === 1 ? MAPPED_OLD : MAPPED_NEW,
          version === 1 ? 'mapped_old' : 'mapped_new',
          'decimal',
        ),
        validation: { min: 0 },
      },
      source: { kind: 'declared' },
    },
    measure,
  ]
  return {
    formatVersion: 1,
    parameters: [parameter],
    bindings: [{ id: BINDING, key: 'measurements', parameterId: PARAMETER }],
    rowIdentity: { kind: 'local', columnIds: [IDENTITY] },
    joins: [],
    columns,
    calculations: [],
    writeBackRules: [
      {
        id: WRITE_BACK,
        bindingId: BINDING,
        mode: 'update',
        mappings: [
          {
            columnId: MEASURE,
            targetFieldId: version === 4 ? TARGET_FIELD : SOURCE_FIELD,
          },
        ],
      },
    ],
    actions: [],
    presentation: {
      columnOrder: columns.map((column) => column.id),
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 1,
      density: 'standard',
      filters: [],
      sorts: [],
    },
  }
}

function state() {
  return {
    bindings: [],
    localFields: [field(REMOVED, 'local_observation', 'decimal')],
    localValues: { [ROW]: { [REMOVED]: 42.5 } },
    calculationOverrides: {},
    presentation: {
      columnOrder: [IDENTITY, REMOVED, MAPPED_OLD, MEASURE],
      hiddenColumnIds: [REMOVED, MAPPED_OLD],
      columnWidths: { [REMOVED]: 180, [MAPPED_OLD]: 140 },
      frozenColumnCount: 1,
      density: 'compact',
      filters: [
        { columnId: REMOVED, operator: 'is-not-empty' },
        { columnId: MAPPED_OLD, operator: 'is-not-empty' },
      ],
      sorts: [
        { columnId: REMOVED, direction: 'desc' },
        { columnId: MAPPED_OLD, direction: 'asc' },
      ],
    },
    provenance: { createdFrom: 'definition_version' },
  }
}

async function actor(client: Client, user: string, workspace = WS) {
  await client.query('set role authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: user, workspace_id: workspace }),
  ])
}

async function createInstance(name: string) {
  let instance = (
    await member.query(
      `select to_jsonb(api.create_sheet_instance_from_definition($1,$2,null,$3,null,null,$4::jsonb,$5::jsonb)) result`,
      [
        WS,
        name,
        sourceVersionId,
        JSON.stringify(state()),
        JSON.stringify([
          { parameterId: PARAMETER, kind: 'dataset', datasetId },
        ]),
      ],
    )
  ).rows[0].result
  const calculation = {
    id: INSTANCE_CALCULATION,
    key: 'local_double',
    label: 'Local double',
    lifecycle: 'active',
    outputField: {
      ...field(INSTANCE_CALCULATION, 'local_double', 'decimal'),
      computation: { mode: 'computed', expressionId: INSTANCE_CALCULATION },
    },
    dependencies: [
      { kind: 'column', id: REMOVED },
      { kind: 'column', id: MAPPED_OLD },
    ],
    expression: { language: 'sheetbase-formula-v1', source: '=A1*2' },
  }
  instance = (
    await member.query(
      `select to_jsonb(api.mutate_sheet_instance_calculations($1,$2,$3,$4::jsonb)) result`,
      [
        instance.id,
        instance.revision,
        crypto.randomUUID(),
        JSON.stringify([{ operation: 'add', calculation }]),
      ],
    )
  ).rows[0].result
  return instance
}

beforeAll(async () => {
  const database = await prepareTestDatabase()
  migrator = database.migrator
  owner = await database.asRole('authenticator')
  member = await database.asRole('authenticator')
  outsider = await database.asRole('authenticator')
  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values
      ($1,'Owner','sheet-upgrade-owner@test.invalid',true),
      ($2,'Member','sheet-upgrade-member@test.invalid',true),
      ($3,'Outsider','sheet-upgrade-outsider@test.invalid',true)`,
    [OWNER, MEMBER, OUTSIDER],
  )
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values
      ($1,'sheet-upgrade','Sheet upgrade'),($2,'sheet-upgrade-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'member')`,
    [WS, OWNER, MEMBER],
  )
  await actor(owner, OWNER)
  await actor(member, MEMBER)
  await actor(outsider, OUTSIDER, OTHER_WS)
  const schemaId = (
    await migrator.query(
      `insert into api.dataset_schema_definitions(workspace_id,key,name) values($1,'upgrade_source','Upgrade source') returning id`,
      [WS],
    )
  ).rows[0].id
  schemaVersionId = (
    await migrator.query(
      `insert into api.dataset_schema_versions(schema_id,version,lifecycle,published_at) values($1,1,'active',now()) returning id`,
      [schemaId],
    )
  ).rows[0].id
  datasetId = (
    await migrator.query(
      `insert into api.datasets(workspace_id,schema_version_id,name) values($1,$2,'Upgrade Dataset') returning id`,
      [WS, schemaVersionId],
    )
  ).rows[0].id
  const created = (
    await owner.query(
      `select api.create_sheet_definition($1,'upgrade_definition','Upgrade Definition',null,$2::jsonb) result`,
      [WS, JSON.stringify(configuration(1))],
    )
  ).rows[0].result
  definitionId = created.definition.id
  sourceVersionId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [created.version.id],
    )
  ).rows[0].result.id
  targetVersionId = (
    await owner.query(
      `select to_jsonb(api.create_sheet_definition_version($1,1,$2::jsonb)) result`,
      [definitionId, JSON.stringify(configuration(2))],
    )
  ).rows[0].result.id
  targetVersionId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [targetVersionId],
    )
  ).rows[0].result.id
  changedRequirementVersionId = (
    await owner.query(
      `select to_jsonb(api.create_sheet_definition_version($1,2,$2::jsonb)) result`,
      [definitionId, JSON.stringify(configuration(3))],
    )
  ).rows[0].result.id
  changedRequirementVersionId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [changedRequirementVersionId],
    )
  ).rows[0].result.id
  incompatibleVersionId = (
    await owner.query(
      `select to_jsonb(api.create_sheet_definition_version($1,3,$2::jsonb)) result`,
      [definitionId, JSON.stringify(configuration(4))],
    )
  ).rows[0].result.id
  incompatibleVersionId = (
    await owner.query(
      `select to_jsonb(api.publish_sheet_definition_version($1,1)) result`,
      [incompatibleVersionId],
    )
  ).rows[0].result.id
  retained = await createInstance('Retain local')
  mapped = await createInstance('Map compatible structure and parameter')
})

afterAll(async () => {
  await Promise.all([owner?.end(), member?.end(), outsider?.end()])
  await migrator?.end()
})

describe('Sheet Instance Definition upgrade', () => {
  it('previews three-way automatic changes and exact owned-state conflicts', async () => {
    const preview = (
      await member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
        [retained.id, retained.revision, targetVersionId],
      )
    ).rows[0].result
    expect(preview.source.versionId).toBe(sourceVersionId)
    expect(preview.target.versionId).toBe(targetVersionId)
    expect(preview.automaticChanges).toEqual(
      expect.arrayContaining([
        { kind: 'column-added', objectId: REPLACEMENT },
        { kind: 'column-added', objectId: MAPPED_NEW },
        { kind: 'column-label-renamed', objectId: IDENTITY },
      ]),
    )
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `column-removed:${REMOVED}`,
          targetCandidates: [],
          allowedOutcomes: ['retain-local', 'defer'],
          instanceReferences: expect.objectContaining({
            localField: true,
            localValueCount: 1,
            calculationIds: [INSTANCE_CALCULATION],
            presentation: true,
          }),
        }),
        expect.objectContaining({
          id: `column-removed:${MAPPED_OLD}`,
          targetCandidates: expect.arrayContaining([MAPPED_NEW]),
          allowedOutcomes: ['retain-local', 'map', 'defer'],
        }),
      ]),
    )
    const changed = (
      await member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
        [retained.id, retained.revision, changedRequirementVersionId],
      )
    ).rows[0].result
    expect(changed.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `parameter-changed:${PARAMETER}`,
          targetCandidates: [PARAMETER],
          allowedOutcomes: ['map', 'defer'],
        }),
      ]),
    )
    const incompatible = (
      await member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
        [retained.id, retained.revision, incompatibleVersionId],
      )
    ).rows[0].result
    expect(incompatible.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `column-incompatible:${MEASURE}`,
          targetCandidates: [],
          allowedOutcomes: ['defer'],
        }),
        expect.objectContaining({
          id: `write-back-changed:${WRITE_BACK}`,
          targetCandidates: [],
          allowedOutcomes: ['defer'],
        }),
      ]),
    )
  })

  it('leaves the exact Instance unchanged for defer, stale, denied and invalid lifecycle/lineage', async () => {
    const before = (
      await member.query(
        `select to_jsonb(i) result from api.sheet_instances i where id=$1`,
        [retained.id],
      )
    ).rows[0].result
    const preview = (
      await member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
        [retained.id, retained.revision, targetVersionId],
      )
    ).rows[0].result
    const decisions = preview.conflicts.map((conflict: any) => ({
      conflictId: conflict.id,
      outcome: 'defer',
    }))
    const incompatibleMap = decisions.map((decision: any) =>
      decision.conflictId === `column-removed:${REMOVED}`
        ? { ...decision, outcome: 'map', targetId: REPLACEMENT }
        : decision,
    )
    await expect(
      member.query(
        `select api.apply_sheet_instance_definition_upgrade($1,$2,$3,$4::jsonb,'[]'::jsonb)`,
        [
          retained.id,
          retained.revision,
          targetVersionId,
          JSON.stringify(incompatibleMap),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB088' })
    const incompatiblePreview = (
      await member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
        [retained.id, retained.revision, incompatibleVersionId],
      )
    ).rows[0].result
    const arbitraryWriteBackMap = incompatiblePreview.conflicts.map(
      (conflict: any) =>
        conflict.id === `write-back-changed:${WRITE_BACK}`
          ? {
              conflictId: conflict.id,
              outcome: 'map',
              targetId: WRITE_BACK,
            }
          : { conflictId: conflict.id, outcome: 'defer' },
    )
    await expect(
      member.query(
        `select api.apply_sheet_instance_definition_upgrade($1,$2,$3,$4::jsonb,'[]'::jsonb)`,
        [
          retained.id,
          retained.revision,
          incompatibleVersionId,
          JSON.stringify(arbitraryWriteBackMap),
        ],
      ),
    ).rejects.toMatchObject({ code: 'SB088' })
    const deferred = (
      await member.query(
        `select api.apply_sheet_instance_definition_upgrade($1,$2,$3,$4::jsonb,'[]'::jsonb) result`,
        [
          retained.id,
          retained.revision,
          targetVersionId,
          JSON.stringify(decisions),
        ],
      )
    ).rows[0].result
    expect(deferred.status).toBe('deferred')
    await expect(
      member.query(
        `select api.apply_sheet_instance_definition_upgrade($1,$2,$3,'[]'::jsonb,'[]'::jsonb)`,
        [retained.id, retained.revision - 1, targetVersionId],
      ),
    ).rejects.toMatchObject({ code: 'SB073' })
    await expect(
      outsider.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3)`,
        [retained.id, retained.revision, targetVersionId],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      member.query(
        `select api.preview_sheet_instance_definition_upgrade($1,$2,$3)`,
        [retained.id, retained.revision, sourceVersionId],
      ),
    ).rejects.toMatchObject({ code: 'SB088' })
    const after = (
      await member.query(
        `select to_jsonb(i) result from api.sheet_instances i where id=$1`,
        [retained.id],
      )
    ).rows[0].result
    expect(after).toEqual(before)
  })

  it('retains populated local ownership and maps only compatible structure/parameters', async () => {
    const apply = async (instance: any, targetId: string) => {
      const preview = (
        await member.query(
          `select api.preview_sheet_instance_definition_upgrade($1,$2,$3) result`,
          [instance.id, instance.revision, targetId],
        )
      ).rows[0].result
      const decisions = preview.conflicts.map((conflict: any) => ({
        conflictId: conflict.id,
        outcome:
          conflict.id === `column-removed:${REMOVED}` ? 'retain-local' : 'map',
        ...(conflict.id === `column-removed:${REMOVED}`
          ? {}
          : { targetId: conflict.targetCandidates[0] }),
      }))
      return (
        await member.query(
          `select api.apply_sheet_instance_definition_upgrade($1,$2,$3,$4::jsonb,'[]'::jsonb) result`,
          [instance.id, instance.revision, targetId, JSON.stringify(decisions)],
        )
      ).rows[0].result
    }
    const retainResult = await apply(retained, targetVersionId)
    const mapResult = await apply(mapped, changedRequirementVersionId)
    for (const [result, expectedTarget] of [
      [retainResult, targetVersionId],
      [mapResult, changedRequirementVersionId],
    ] as const) {
      expect(result.status).toBe('applied')
      expect(result.instance.source_definition_version_id).toBe(expectedTarget)
      expect(
        result.instance.state.localFields.map((item: any) => item.fieldId),
      ).toEqual([REMOVED])
      expect(result.instance.state.localValues).toEqual({
        [ROW]: { [REMOVED]: 42.5 },
      })
      expect(result.instance.state.bindings[0]).toMatchObject({
        bindingId: BINDING,
        parameterId: PARAMETER,
        datasetId,
      })
      expect(
        result.instance.state.resolutionProvenance.sourceDefinitionVersionId,
      ).toBe(expectedTarget)
      expect(result.provenance).toMatchObject({
        sourceDefinitionVersionId: sourceVersionId,
        targetDefinitionVersionId: expectedTarget,
        sourceInstanceRevision: result.instance.revision - 1,
        resultingInstanceRevision: result.instance.revision,
        actorUserId: MEMBER,
      })
      expect(
        result.instance.state.instanceCalculations[0].dependencies,
      ).toEqual([
        { kind: 'local-field', id: REMOVED },
        { kind: 'column', id: MAPPED_NEW },
      ])
      expect(result.instance.state.presentation).toMatchObject({
        hiddenColumnIds: [REMOVED, MAPPED_NEW],
        columnWidths: { [REMOVED]: 180, [MAPPED_NEW]: 140 },
        filters: [
          { columnId: REMOVED, operator: 'is-not-empty' },
          { columnId: MAPPED_NEW, operator: 'is-not-empty' },
        ],
        sorts: [
          { columnId: REMOVED, direction: 'desc' },
          { columnId: MAPPED_NEW, direction: 'asc' },
        ],
      })
      expect(result.instance.state.presentation.columnOrder).toContain(REMOVED)
      expect(result.instance.state.presentation.columnOrder).toContain(
        MAPPED_NEW,
      )
      expect(result.instance.state.presentation.columnOrder).not.toContain(
        MAPPED_OLD,
      )
      const reload = (
        await member.query(
          `select to_jsonb(i) result from api.sheet_instances i where id=$1`,
          [result.instance.id],
        )
      ).rows[0].result
      expect(reload).toEqual(result.instance)
    }
    expect(
      mapResult.instance.state.bindings[0].resolution.compatibilityMode,
    ).toBe('lineage')
    const audit = await member.query(
      `select source_definition_version_id,target_definition_version_id,decision_manifest,resulting_instance_revision from api.sheet_instance_definition_upgrades where instance_id=$1`,
      [retained.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].decision_manifest).toEqual(
      retainResult.provenance.decisions,
    )
    await expect(
      outsider.query(`select * from api.sheet_instance_definition_upgrades`),
    ).resolves.toMatchObject({ rows: [] })
    await expect(
      member.query(
        `update api.sheet_instances set source_definition_version_id=$1 where id=$2`,
        [sourceVersionId, retained.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
