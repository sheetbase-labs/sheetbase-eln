import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000e104'
const PROJECT = '00000000-0000-4000-8000-00000000e114'
const OWNER = 'model-04-owner'
const MEMBER = 'model-04-member'
const OUTSIDER = 'model-04-outsider'

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

async function field(client: Client, model: string, key: string, type: string) {
  const { rows } = await client.query(
    `select * from api.create_model_field($1,$2,$3,$3,$4,true,null,'{}'::jsonb)`,
    [WS, model, key, type],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','m04-owner@test.invalid',true),
      ('${MEMBER}','Member','m04-member@test.invalid',true),
      ('${OUTSIDER}','Outsider','m04-outsider@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','model-04-evolution','MODEL-04 evolution');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${MEMBER}','member');
    insert into api.projects(id,workspace_id,key,title,lead_user_id)
      values('${PROJECT}','${WS}','m04','M04','${MEMBER}')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

/**
 * MODEL-04 — dependency-aware model evolution. Seeds one carried field on
 * the sample model plus a consumer of every class (record, MODEL-03 rule,
 * sheet definition parameter, sheet instance record binding, template
 * record parameter), then proves discovery depth, confirm-gated retire
 * with migration guidance, pinned historical interpretation, untouched
 * local working state, and fail-closed scope handling. The tag keeps each
 * test's stable keys unique inside the shared workspace.
 */
async function seedConsumers(owner: Client, tag: string) {
  const fieldKey = `titre_note_${tag}`
  const keeperKey = `arm_${tag}`
  const identifier = `SMP-2026-000${tag}`
  const definition = await field(owner, 'sample', fieldKey, 'text')
  await owner.query(`select api.activate_model_field($1)`, [definition.id])
  const keeper = await field(owner, 'sample', keeperKey, 'text')
  await owner.query(`select api.activate_model_field($1)`, [keeper.id])

  const { rows: records } = await migrator.query(
    `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
     values($1,$2,'sample',$3,'Seed sample',$4) returning id`,
    [WS, PROJECT, identifier, OWNER],
  )
  const recordId = records[0].id as string
  await owner.query(`select api.update_record_custom_fields($1,1,$2)`, [
    recordId,
    JSON.stringify({ [fieldKey]: '7.2', [keeperKey]: 'control' }),
  ])

  await owner.query(
    `select api.configure_model_relationship_rule($1,'sample','sample','experiment',1,null,'consumes')`,
    [WS],
  )

  // Sheet definition whose record parameter names the sample model. The
  // dataset parameter keeps its exact contract honest with a real version.
  const created = (
    await owner.query(
      `select api.create_dataset_schema_definition($1,$2,'M04 result',null,$3::jsonb) result`,
      [
        WS,
        `m04_result_${tag}`,
        JSON.stringify([
          {
            key: 'titre',
            label: 'Titre',
            logical_type: 'decimal',
            nullable: true,
          },
        ]),
      ],
    )
  ).rows[0].result
  await owner.query(`select api.publish_dataset_schema_version($1)`, [
    created.schema_version_id,
  ])
  const configuration = validSheetDefinitionConfiguration() as {
    parameters: Array<{ type: { contract?: { schemaVersionId?: string } } }>
  }
  configuration.parameters[0].type.contract!.schemaVersionId =
    created.schema_version_id
  configuration.parameters.push({
    id: 'c0000000-0000-4000-8000-000000000001',
    key: 'subject',
    label: 'Subject',
    required: false,
    type: { kind: 'record', modelKey: 'sample' },
    constraints: {},
  } as never)
  const sheet = (
    await owner.query(
      `select api.create_sheet_definition($1,$2,'M04 sheet','',$3::jsonb) result`,
      [WS, `m04_sheet_${tag}`, JSON.stringify(configuration)],
    )
  ).rows[0].result as {
    definition: { id: string }
    version: { id: string }
  }
  const template = (
    await owner.query(
      `select api.create_notebook_template($1,$2,'M04 study','',$3::jsonb) result`,
      [
        WS,
        `m04_study_${tag}`,
        JSON.stringify({
          formatVersion: 1,
          parameters: [
            {
              id: 'c0000000-0000-4000-8000-000000000002',
              key: 'subject',
              label: 'Subject',
              required: false,
              type: { kind: 'record', modelKey: 'sample' },
              constraints: {},
            },
          ],
          placements: [],
        }),
      ],
    )
  ).rows[0].result as { template: { id: string }; version: { id: string } }
  const instanceName = `M04 assay ${tag}`
  await owner.query(
    `select api.create_sheet_instance($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      WS,
      instanceName,
      null,
      null,
      PROJECT,
      null,
      JSON.stringify({
        bindings: [
          {
            bindingId: 'c0000000-0000-4000-8000-000000000011',
            parameterId: 'c0000000-0000-4000-8000-000000000012',
            kind: 'record',
            recordId,
            policy: 'live',
          },
        ],
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
      }),
    ],
  )
  const { rows: instanceRows } = await migrator.query(
    `select id from api.sheet_instances where workspace_id=$1 and name=$2`,
    [WS, instanceName],
  )
  const instanceId = instanceRows[0].id as string

  return {
    definition,
    keeper,
    fieldKey,
    keeperKey,
    identifier,
    recordId,
    instanceName,
    sheetVersionId: sheet.version.id as string,
    templateVersionId: template.version.id as string,
    instanceId,
  }
}

describe('MODEL-04 model evolution and impact analysis', () => {
  it('discovers model consumers across fields, records, rules, sheets and templates', async () => {
    const owner = await actor(OWNER)
    const seed = await seedConsumers(owner, 'a')

    const { rows } = await owner.query(
      `select api.discover_model_dependencies('sample') result`,
    )
    const report = rows[0].result
    expect(report.kind).toBe('model')
    expect(report.truncated).toBe(false)
    expect(report.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'model_field',
          id: seed.definition.id,
          relation: 'defines_field',
          effect: 'informational',
        }),
        expect.objectContaining({
          kind: 'record',
          id: seed.recordId,
          relation: 'carries_custom_values',
          liveness: 'active',
          effect: 'requires_migration',
          label: seed.identifier,
        }),
        expect.objectContaining({
          kind: 'model_relationship_rule',
          relation: 'constrains_source_links',
          liveness: 'active',
          effect: 'requires_migration',
        }),
        expect.objectContaining({
          kind: 'sheet_instance',
          id: seed.instanceId,
          relation: 'binds_model_record',
          liveness: 'active',
          effect: 'requires_migration',
          label: seed.instanceName,
        }),
        expect.objectContaining({
          kind: 'notebook_template_version',
          id: seed.templateVersionId,
          relation: 'parameter_model_contract',
          effect: 'requires_migration',
        }),
      ]),
    )
    const fieldItem = report.dependencies.find(
      (item: { kind: string; id: string }) =>
        item.kind === 'model_field' && item.id === seed.definition.id,
    )
    expect(fieldItem.label).toMatch(/1 records/)
  })

  it('deepens model_field discovery beyond the usage count', async () => {
    const owner = await actor(OWNER)
    const seed = await seedConsumers(owner, 'b')

    const { rows } = await owner.query(
      `select api.discover_object_dependencies('model_field',$1) result`,
      [seed.definition.id],
    )
    const discovered = rows[0].result
    expect(discovered.truncated).toBe(false)
    const usage = discovered.dependencies.find(
      (item: { kind: string }) => item.kind === 'model_field_usage',
    )
    // A stored value needs steward handling on retire: the count item no
    // longer understates the gate as informational.
    expect(usage.effect).toBe('requires_migration')
    expect(usage.label).toBe('1 records')
    expect(discovered.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'record',
          relation: 'carries_field_value',
          liveness: 'active',
          effect: 'requires_migration',
          label: seed.identifier,
        }),
      ]),
    )

    const unused = await field(owner, 'sample', 'never_carried', 'text')
    await owner.query(`select api.activate_model_field($1)`, [unused.id])
    const { rows: unusedRows } = await owner.query(
      `select api.discover_object_dependencies('model_field',$1) result`,
      [unused.id],
    )
    const unusedUsage = unusedRows[0].result.dependencies.find(
      (item: { kind: string }) => item.kind === 'model_field_usage',
    )
    expect(unusedUsage.effect).toBe('informational')
    expect(unusedUsage.label).toBe('0 records')
  })

  it('previews retire with migration guidance and requires explicit confirmation', async () => {
    const owner = await actor(OWNER)
    const seed = await seedConsumers(owner, 'c')

    const { rows } = await owner.query(
      `select api.preview_model_field_evolution($1,'retire','{}'::jsonb) preview`,
      [seed.definition.id],
    )
    const preview = rows[0].preview
    expect(preview.classification).toBe('migration-requiring')
    expect(preview.blocked).toBe(false)
    expect(preview.guidance).toHaveLength(2)
    expect(preview.guidance[0]).toContain('1 record(s)')
    expect(preview.guidance[0]).toContain(seed.fieldKey)
    expect(preview.guidance[1]).toMatch(/never auto-migrated/)

    const { rows: updateRows } = await owner.query(
      `select api.preview_model_field_evolution($1,'update','{"label":"Renamed"}'::jsonb) preview`,
      [seed.definition.id],
    )
    expect(updateRows[0].preview.classification).toBe('compatible')
    expect(updateRows[0].preview.guidance[0]).toMatch(/Metadata-only/)

    // Never silent: a consequential retire without confirmation is rejected.
    await expect(
      owner.query(
        `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,false)`,
        [seed.definition.id],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    const { rows: applied } = await owner.query(
      `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,true) result`,
      [seed.definition.id],
    )
    expect(applied[0].result.ok).toBe(true)
  })

  it('keeps historical and pinned interpretations stable across retire', async () => {
    const owner = await actor(OWNER)
    const seed = await seedConsumers(owner, 'd')

    const { rows: before } = await migrator.query(
      `select internal.build_revision_envelope($1) envelope`,
      [seed.recordId],
    )
    const pinnedCustomFields = before[0].envelope.record.customFields
    expect(pinnedCustomFields[seed.fieldKey]).toBe('7.2')

    await owner.query(
      `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,true)`,
      [seed.definition.id],
    )

    // Stored values survive; the retired definition stays visible to
    // readers so frozen evidence reconstructs with its pinned meaning.
    const { rows: after } = await migrator.query(
      `select internal.build_revision_envelope($1) envelope`,
      [seed.recordId],
    )
    expect(after[0].envelope.record.customFields).toEqual(pinnedCustomFields)
    const manifest = after[0].envelope.modelFields.definitions.find(
      (definition: { fieldName: string }) =>
        definition.fieldName === seed.fieldKey,
    )
    expect(manifest.lifecycle).toBe('retired')

    // Version-gated reads and writes: the retired value still reads, new
    // writes to it are rejected, and live fields keep working.
    const { rows: reread } = await owner.query(
      `select custom_fields from api.records where id=$1`,
      [seed.recordId],
    )
    expect(reread[0].custom_fields[seed.fieldKey]).toBe('7.2')
    const { rows: current } = await migrator.query(
      `select metadata_version from api.records where id=$1`,
      [seed.recordId],
    )
    await expect(
      owner.query(`select api.update_record_custom_fields($1,$2,$3)`, [
        seed.recordId,
        current[0].metadata_version,
        JSON.stringify({ [seed.fieldKey]: '8.0' }),
      ]),
    ).rejects.toMatchObject({ code: 'SB070' })
    const { rows: edited } = await owner.query(
      `select * from api.update_record_custom_fields($1,$2,$3)`,
      [
        seed.recordId,
        current[0].metadata_version,
        JSON.stringify({ [seed.keeperKey]: 'treated' }),
      ],
    )
    expect(edited[0].custom_fields[seed.fieldKey]).toBe('7.2')
    expect(edited[0].custom_fields[seed.keeperKey]).toBe('treated')
  })

  it('never auto-migrates local working state on retire', async () => {
    const owner = await actor(OWNER)
    const seed = await seedConsumers(owner, 'e')

    const { rows: instanceBefore } = await migrator.query(
      `select state from api.sheet_instances where id=$1`,
      [seed.instanceId],
    )
    const { rows: templateBefore } = await migrator.query(
      `select configuration from api.notebook_template_versions where id=$1`,
      [seed.templateVersionId],
    )

    await owner.query(
      `select api.apply_model_field_evolution($1,'retire','{}'::jsonb,true)`,
      [seed.definition.id],
    )

    const { rows: instanceAfter } = await migrator.query(
      `select state from api.sheet_instances where id=$1`,
      [seed.instanceId],
    )
    const { rows: templateAfter } = await migrator.query(
      `select configuration from api.notebook_template_versions where id=$1`,
      [seed.templateVersionId],
    )
    expect(instanceAfter[0].state).toEqual(instanceBefore[0].state)
    expect(templateAfter[0].configuration).toEqual(
      templateBefore[0].configuration,
    )
  })

  it('fails closed on ambiguous model scope', async () => {
    const owner = await actor(OWNER)
    const outsider = await actor(OUTSIDER)
    await expect(
      owner.query(`select api.discover_model_dependencies('')`),
    ).rejects.toMatchObject({ code: '22023' })
    await expect(
      owner.query(`select api.discover_model_dependencies('no_such_model')`),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      outsider.query(`select api.discover_model_dependencies('sample')`),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
