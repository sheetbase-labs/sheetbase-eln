import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000c097'
const OWNER = 'core-05-fix-owner'
const STEWARD_A = 'core-05-fix-steward-a'
const STEWARD_B = 'core-05-fix-steward-b'
const LOCAL_ROW = '00000000-0000-4000-8000-00000000c197'
const SAMPLE_FIELD = '00000000-0000-4000-8000-00000000c198'
const REAGENT_FIELD = '00000000-0000-4000-8000-00000000c199'

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

function titreFields(extra?: Record<string, unknown>) {
  const fields: Array<Record<string, unknown>> = [
    {
      field_id: '00000000-0000-4000-8000-00000000c391',
      key: 'titre',
      label: 'Titre',
      logical_type: 'decimal',
      nullable: true,
    },
  ]
  if (extra) fields.push(extra)
  return JSON.stringify(fields)
}

async function publishedSchema(steward: Client, key: string) {
  const created = (
    await steward.query(
      `select api.create_dataset_schema_definition($1,$2,$3,null,$4::jsonb) result`,
      [WS, key, key, titreFields()],
    )
  ).rows[0].result
  await steward.query(`select api.publish_dataset_schema_version($1)`, [
    created.schema_version_id,
  ])
  return created as {
    schema_definition_id: string
    schema_version_id: string
  }
}

async function localInstance(
  steward: Client,
  key: string,
  fieldId: string,
  fieldKey: string,
) {
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
      `select api.create_sheet_definition($1,$2,$2,'',$3::jsonb) result`,
      [WS, key, JSON.stringify(configuration)],
    )
  ).rows[0].result
  await steward.query(`select api.publish_sheet_definition_version($1,1)`, [
    definition.version.id,
  ])
  const state = {
    bindings: [],
    localFields: [
      {
        fieldId,
        key: fieldKey,
        label: fieldKey,
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
    localValues: { [LOCAL_ROW]: { [fieldId]: 'kept-local' } },
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
      `select to_jsonb(api.create_sheet_instance_from_definition($1,$2,null,$3,null,null,$4::jsonb,'[]'::jsonb)) result`,
      [WS, key, definition.version.id, JSON.stringify(state)],
    )
  ).rows[0].result
  return created as { id: string }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','fix-owner@test.invalid',true),
      ('${STEWARD_A}','Steward A','fix-a@test.invalid',true),
      ('${STEWARD_B}','Steward B','fix-b@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','core-05-fix','CORE-05 corrections');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),
      ('${WS}','${STEWARD_A}','steward'),
      ('${WS}','${STEWARD_B}','steward')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('CORE-05 configuration idempotency', () => {
  it('replays the same actor and key, conflicts on a changed payload, and isolates actors', async () => {
    const stewardA = await actor(STEWARD_A)
    const stewardB = await actor(STEWARD_B)
    const created = await publishedSchema(stewardA, 'idem_schema')
    const comment = {
      key: 'comment',
      label: 'Comment',
      logical_type: 'text',
      nullable: true,
    }
    const first = (
      await stewardA.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-key') result`,
        [created.schema_version_id, titreFields(comment)],
      )
    ).rows[0].result
    expect(first.idempotent).toBe(false)
    const retry = (
      await stewardA.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-key') result`,
        [created.schema_version_id, titreFields(comment)],
      )
    ).rows[0].result
    expect(retry.idempotent).toBe(true)
    expect(retry.schemaVersionId).toBe(first.schemaVersionId)
    const versions = (
      await stewardA.query(
        `select count(*)::int as n from api.dataset_schema_versions where schema_id=$1`,
        [created.schema_definition_id],
      )
    ).rows[0]
    expect(versions.n).toBe(2)
    await expectDenied(
      stewardA.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-key')`,
        [
          created.schema_version_id,
          titreFields({
            key: 'batch',
            label: 'Batch',
            logical_type: 'text',
            nullable: true,
          }),
        ],
      ),
      '23505',
    )
    const otherActor = (
      await stewardB.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'evo-key') result`,
        [created.schema_version_id, titreFields(comment)],
      )
    ).rows[0].result
    expect(otherActor.idempotent).toBe(false)
    expect(otherActor.schemaVersionId).not.toBe(first.schemaVersionId)
  })
})

describe('CORE-05 Dataset Schema draft concurrency', () => {
  it('does not clobber an unrelated draft and requires a matching revision to edit one', async () => {
    const stewardA = await actor(STEWARD_A)
    const stewardB = await actor(STEWARD_B)
    const created = await publishedSchema(stewardA, 'draft_schema')
    const draft = (
      await stewardA.query(
        `select api.create_next_dataset_schema_version($1) result`,
        [created.schema_definition_id],
      )
    ).rows[0].result
    await expectDenied(
      stewardA.query(
        `select api.create_next_dataset_schema_version($1)`,
        [created.schema_definition_id],
      ),
      'SB072',
    )
    await expectDenied(
      stewardB.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'clobber')`,
        [created.schema_version_id, titreFields()],
      ),
      'SB072',
    )
    await expectDenied(
      stewardB.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'draft-edit')`,
        [draft.schema_version_id, titreFields()],
      ),
      'SB001',
    )
    const revision = (
      await stewardA.query(
        `select revision from api.dataset_schema_versions where id=$1`,
        [draft.schema_version_id],
      )
    ).rows[0].revision
    await expectDenied(
      stewardB.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'stale', $3)`,
        [draft.schema_version_id, titreFields(), Number(revision) + 1],
      ),
      'SB001',
    )
    const applied = (
      await stewardB.query(
        `select api.apply_dataset_schema_evolution($1,$2::jsonb,'draft-ok',$3) result`,
        [
          draft.schema_version_id,
          titreFields({
            key: 'comment',
            label: 'Comment',
            logical_type: 'text',
            nullable: true,
          }),
          revision,
        ],
      )
    ).rows[0].result
    expect(applied.schemaVersionId).toBe(draft.schema_version_id)
    expect(applied.ok).toBe(true)
  })
})

describe('CORE-05 local-field Model promotion', () => {
  it('requires an explicit Model key and includes it in idempotency', async () => {
    const steward = await actor(STEWARD_A)
    const sampleInstance = await localInstance(
      steward,
      'promo_sample',
      SAMPLE_FIELD,
      'sample_note',
    )
    const reagentInstance = await localInstance(
      steward,
      'promo_reagent',
      REAGENT_FIELD,
      'reagent_note',
    )
    await expectDenied(
      steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'no-model')`,
        [sampleInstance.id, SAMPLE_FIELD],
      ),
      '22023',
    )
    await expectDenied(
      steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'bad-model','not_a_model')`,
        [sampleInstance.id, SAMPLE_FIELD],
      ),
      '22023',
    )
    const samplePreview = (
      await steward.query(
        `select api.preview_local_field_promotion($1,$2,'model_field',null,'sample') result`,
        [sampleInstance.id, SAMPLE_FIELD],
      )
    ).rows[0].result
    expect(samplePreview.modelKey).toBe('sample')
    const sample = (
      await steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'promo-sample','sample') result`,
        [sampleInstance.id, SAMPLE_FIELD],
      )
    ).rows[0].result
    expect(sample.modelKey).toBe('sample')
    expect(sample.targetKind).toBe('model_field')
    const sampleKind = (
      await steward.query(
        `select kind from api.record_field_definitions where id=$1`,
        [sample.targetId],
      )
    ).rows[0]
    expect(sampleKind.kind).toBe('sample')
    const retry = (
      await steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'promo-sample','sample') result`,
        [sampleInstance.id, SAMPLE_FIELD],
      )
    ).rows[0].result
    expect(retry.idempotent).toBe(true)
    expect(retry.targetId).toBe(sample.targetId)
    await expectDenied(
      steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'promo-sample','reagent')`,
        [sampleInstance.id, SAMPLE_FIELD],
      ),
      '23505',
    )
    const reagent = (
      await steward.query(
        `select api.promote_local_field($1,$2,'model_field',null,'promo-reagent','reagent') result`,
        [reagentInstance.id, REAGENT_FIELD],
      )
    ).rows[0].result
    expect(reagent.modelKey).toBe('reagent')
    const reagentKind = (
      await steward.query(
        `select kind from api.record_field_definitions where id=$1`,
        [reagent.targetId],
      )
    ).rows[0]
    expect(reagentKind.kind).toBe('reagent')
  })
})

describe('CORE-05 schema.edit cannot direct-publish', () => {
  it('blocks a schema.edit actor from publishing through a direct table write', async () => {
    const steward = await actor(STEWARD_A)
    const created = (
      await steward.query(
        `select api.create_dataset_schema_definition($1,'edit_only','Edit only',null,'[]'::jsonb) result`,
        [WS],
      )
    ).rows[0].result
    await steward.query(
      `select set_config('sheetbase.capability_mask','schema.edit',false)`,
    )
    expect(
      (
        await steward.query(`select api.has_capability($1,'schema.edit') edit`, [
          WS,
        ])
      ).rows[0].edit,
    ).toBe(true)
    expect(
      (
        await steward.query(
          `select api.has_capability($1,'schema.publish') publish`,
          [WS],
        )
      ).rows[0].publish,
    ).toBe(false)
    await expectDenied(
      steward.query(
        `update api.dataset_schema_versions set lifecycle='active', published_at=now() where id=$1`,
        [created.schema_version_id],
      ),
      '42501',
    )
    const stillDraft = (
      await steward.query(
        `select lifecycle from api.dataset_schema_versions where id=$1`,
        [created.schema_version_id],
      )
    ).rows[0]
    expect(stillDraft.lifecycle).toBe('draft')
    await steward.query(`select set_config('sheetbase.capability_mask','',false)`)
    const published = (
      await steward.query(
        `select lifecycle from api.publish_dataset_schema_version($1)`,
        [created.schema_version_id],
      )
    ).rows[0]
    expect(published.lifecycle).toBe('active')
  })
})
