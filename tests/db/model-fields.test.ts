import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000005700'
const PROJECT = '00000000-0000-4000-8000-000000005701'
const OWNER = 'model-fields-owner'
const ADMIN = 'model-fields-admin'
const MEMBER = 'model-fields-member'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(id: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: id, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

async function field(
  client: Client,
  model: string,
  key: string,
  type: string,
  nullable = true,
  defaultValue: unknown = null,
  validation: Record<string, unknown> = {},
) {
  const { rows } = await client.query(
    `select * from api.create_model_field($1,$2,$3,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      WS,
      model,
      key,
      type,
      nullable,
      defaultValue === null ? null : JSON.stringify(defaultValue),
      JSON.stringify(validation),
    ],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','mf-owner@test.invalid',true),
      ('${ADMIN}','Admin','mf-admin@test.invalid',true),
      ('${MEMBER}','Member','mf-member@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','model-fields','Model fields');
    insert into api.workspace_memberships(workspace_id,user_id,role) values
      ('${WS}','${OWNER}','owner'),('${WS}','${ADMIN}','admin'),('${WS}','${MEMBER}','member');
    insert into api.projects(id,workspace_id,key,title,lead_user_id) values('${PROJECT}','${WS}','mf','MF','${MEMBER}')`)
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('model field registry and controlled writes', () => {
  it('separates schema capabilities from ordinary workspace membership', async () => {
    const owner = await actor(OWNER)
    const admin = await actor(ADMIN)
    const member = await actor(MEMBER)

    await expect(
      owner.query(
        `select api.has_schema_capability($1,'model_field.manage') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: true }] })
    await expect(
      admin.query(
        `select api.has_schema_capability($1,'model_field.manage') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: true }] })
    await expect(
      member.query(
        `select api.has_schema_capability($1,'model_field.manage') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: false }] })
    await expect(
      owner.query(
        `select api.has_schema_capability($1,'dataset_schema.publish') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: true }] })
    await expect(
      admin.query(
        `select api.has_schema_capability($1,'dataset_schema.publish') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: true }] })
    await expect(
      owner.query(
        `select api.has_schema_capability($1,'unrecognised.capability') allowed`,
        [WS],
      ),
    ).resolves.toMatchObject({ rows: [{ allowed: false }] })
  })

  it('seeds the exact canonical registry and protects snake/camel aliases', async () => {
    const { rows } = await migrator.query(
      `select key from api.model_kinds order by key`,
    )
    expect(rows.map((row) => row.key)).toEqual([
      'dataset_schema',
      'experiment',
      'file',
      'instrument',
      'instrument_run',
      'notebook_template',
      'plate_design',
      'project',
      'protocol_template',
      'reagent',
      'report',
      'sample',
      'scientific_table',
      'study',
    ])
    expect(
      Number(
        (
          await migrator.query(
            `select count(*) n from api.model_base_fields where model_key='study' and field_key in ('workspace_id','workspaceId')`,
          )
        ).rows[0].n,
      ),
    ).toBe(2)
    const { rows: visibleBaseFields } = await migrator.query(`
      select m.key,count(b.*)::integer as count
      from api.model_kinds m
      left join api.model_base_fields b on b.model_key=m.key
        and coalesce((b.presentation->>'editor')::boolean,false)
      group by m.key
      order by m.key`)
    expect(visibleBaseFields.every((model) => Number(model.count) > 0)).toBe(
      true,
    )
  })

  it('allows owner/admin RPC writes, denies members and collisions', async () => {
    const owner = await actor(OWNER)
    const admin = await actor(ADMIN)
    const member = await actor(MEMBER)
    await field(owner, 'project', 'owner_note', 'text')
    await field(admin, 'project', 'admin_note', 'text')
    await expect(
      field(member, 'project', 'member_note', 'text'),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      field(owner, 'project', 'workspace_id', 'text'),
    ).rejects.toMatchObject({ code: 'SB070' })
  })

  it('stores field descriptions and units without changing positional call compatibility', async () => {
    const owner = await actor(OWNER)
    const { rows } = await owner.query(
      `select * from api.create_model_field(
        $1,'project','dose_concentration','Dose concentration','decimal',true,null,'{}','{"symbol":"mg/mL"}','Normalised dose concentration'
      )`,
      [WS],
    )
    expect(rows[0]).toMatchObject({
      description: 'Normalised dose concentration',
      unit: { symbol: 'mg/mL' },
    })
    await expect(
      owner.query(`select api.activate_model_field($1)`, [rows[0].id]),
    ).resolves.toBeDefined()
  })

  it('persists canonical quantity and relationship projections without inferring legacy units', async () => {
    const owner = await actor(OWNER)
    const quantity = await field(
      owner,
      'project',
      'configured_amount',
      'decimal',
    )
    await owner.query(
      `select api.configure_model_field_semantics(
        $1,
        '{"kind":"assay_amount","dimension":"legacy-unspecified","storageUnit":"TU/mL"}',
        'one', null, null
      )`,
      [quantity.id],
    )
    const reference = await field(
      owner,
      'experiment',
      'canonical_source',
      'reference',
    )
    await owner.query(
      `select api.configure_model_field_semantics(
        $1, null, 'one', null,
        '{"target":{"kind":"model","modelKey":"sample"},"cardinality":"one"}'
      )`,
      [reference.id],
    )
    const { rows } = await migrator.query(
      `select quantity, cardinality, relationship, validation
       from api.record_field_definitions where id in ($1,$2) order by id`,
      [quantity.id, reference.id],
    )
    expect(rows).toContainEqual(
      expect.objectContaining({
        quantity: {
          kind: 'assay_amount',
          dimension: 'legacy-unspecified',
          storageUnit: 'TU/mL',
        },
        cardinality: 'one',
      }),
    )
    expect(rows).toContainEqual(
      expect.objectContaining({
        relationship: {
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        },
        validation: { targetModelKey: 'sample' },
      }),
    )
    await expect(
      owner.query(
        `select api.configure_model_field_semantics($1,null,'many',null,null)`,
        [quantity.id],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('validates all scalar types, category options, required defaults and unknown keys', async () => {
    const owner = await actor(OWNER)
    for (const [key, type] of [
      ['text_value', 'text'],
      ['integer_value', 'integer'],
      ['decimal_value', 'decimal'],
      ['boolean_value', 'boolean'],
      ['date_value', 'date'],
      ['timestamp_value', 'timestamp'],
    ]) {
      const d = await field(owner, 'project', key, type)
      await owner.query(`select api.activate_model_field($1)`, [d.id])
    }
    const category = await field(owner, 'project', 'phase', 'category')
    await owner.query(
      `select api.create_model_field_option($1,'stable','Stable',1)`,
      [category.id],
    )
    await owner.query(`select api.activate_model_field($1)`, [category.id])
    const required = await field(
      owner,
      'project',
      'required_code',
      'text',
      false,
      'AUTO',
    )
    await owner.query(`select api.activate_model_field($1)`, [required.id])
    const values = {
      text_value: 'x',
      integer_value: 2,
      decimal_value: 1.5,
      boolean_value: true,
      date_value: '2026-08-11',
      timestamp_value: '2026-08-11T12:00:00Z',
      phase: 'stable',
    }
    const { rows } = await owner.query(
      `update api.projects set custom_fields=$2 where id=$1 returning custom_fields`,
      [PROJECT, values],
    )
    expect(rows[0].custom_fields.required_code).toBe('AUTO')
    await expect(
      owner.query(
        `update api.projects set custom_fields='{"unknown":1}' where id=$1`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB070' })
  })

  it('keeps legacy properties limited to protected system keys', async () => {
    await expect(
      migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,properties,created_by_user_id)
         values($1,$2,'sample','SMP-2026-5798','Invalid properties','{"invented":"value"}',$3)`,
        [WS, PROJECT, OWNER],
      ),
    ).rejects.toMatchObject({ code: 'SB070' })
    await expect(
      migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,properties,created_by_user_id)
         values($1,$2,'sample','SMP-2026-5799','System properties','{"sampleType":"Control"}',$3)`,
        [WS, PROJECT, OWNER],
      ),
    ).resolves.toBeDefined()
  })

  it('preserves retired values and snapshots a deterministic manifest', async () => {
    const owner = await actor(OWNER)
    const d = await field(owner, 'experiment', 'legacy_value', 'text')
    await owner.query(`select api.activate_model_field($1)`, [d.id])
    const { rows: records } = await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,custom_fields,created_by_user_id)
       values($1,$2,'experiment','EXP-2026-0001','Experiment','{"legacy_value":"keep"}',$3) returning id`,
      [WS, PROJECT, OWNER],
    )
    await owner.query(`select api.retire_model_field($1)`, [d.id])
    await owner.query(
      `update api.records set custom_fields=custom_fields where id=$1`,
      [records[0].id],
    )
    const { rows } = await migrator.query(
      `select internal.build_revision_envelope($1) envelope`,
      [records[0].id],
    )
    expect(rows[0].envelope.record.customFields.legacy_value).toBe('keep')
    expect(rows[0].envelope.modelFields.definitions[0].lifecycle).toBe(
      'retired',
    )
    await expect(
      owner.query(
        `update api.records set custom_fields=custom_fields-'legacy_value' where id=$1`,
        [records[0].id],
      ),
    ).rejects.toMatchObject({ code: 'SB070' })
    await expect(
      owner.query(
        `update api.records set custom_fields=jsonb_set(custom_fields,'{legacy_value}','"changed"') where id=$1`,
        [records[0].id],
      ),
    ).rejects.toMatchObject({ code: 'SB070' })
  })

  it('enforces validation rules and immutable active contracts', async () => {
    const owner = await actor(OWNER)
    const text = await field(
      owner,
      'project',
      'validated_text',
      'text',
      true,
      null,
      {
        minLength: 2,
        maxLength: 4,
        regex: '^[A-Z]+$',
      },
    )
    await owner.query(`select api.activate_model_field($1)`, [text.id])
    const number = await field(
      owner,
      'project',
      'validated_number',
      'decimal',
      true,
      null,
      {
        min: 1,
        max: 2,
      },
    )
    await owner.query(`select api.activate_model_field($1)`, [number.id])

    await expect(
      owner.query(
        `update api.projects set custom_fields=custom_fields||'{"validated_text":"a"}' where id=$1`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    await expect(
      owner.query(
        `update api.projects set custom_fields=custom_fields||'{"validated_number":3}' where id=$1`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
    await owner.query(
      `update api.projects set custom_fields=custom_fields||'{"validated_text":"AB","validated_number":1.5}' where id=$1`,
      [PROJECT],
    )
    await expect(
      owner.query(`select api.update_model_field($1,'{"nullable":false}')`, [
        text.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB072' })
    await expect(
      owner.query(`select api.update_model_field($1,'{"unexpected":true}')`, [
        text.id,
      ]),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('maintains strict reference edges and rejects unavailable targets', async () => {
    const owner = await actor(OWNER)
    const reference = await field(
      owner,
      'experiment',
      'source_sample',
      'reference',
      true,
      null,
      { targetModelKey: 'sample' },
    )
    await owner.query(`select api.activate_model_field($1)`, [reference.id])
    const { rows: targets } = await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,'sample','SMP-2026-0001','Target sample',$3) returning id`,
      [WS, PROJECT, OWNER],
    )
    const { rows: sources } = await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,custom_fields,created_by_user_id)
       values($1,$2,'experiment','EXP-2026-0002','Reference experiment',jsonb_build_object('source_sample',$3::text),$4) returning id`,
      [WS, PROJECT, targets[0].id, OWNER],
    )
    expect(
      Number(
        (
          await migrator.query(
            `select count(*) n from internal.model_field_reference_edges where source_record_id=$1 and target_record_id=$2`,
            [sources[0].id, targets[0].id],
          )
        ).rows[0].n,
      ),
    ).toBe(1)
    await expect(
      migrator.query(`delete from api.records where id=$1`, [targets[0].id]),
    ).rejects.toMatchObject({ code: '23001' })
    await migrator.query(
      `update api.records set deleted_at=now() where id=$1`,
      [targets[0].id],
    )
    await owner.query(
      `update api.records set custom_fields=custom_fields where id=$1`,
      [sources[0].id],
    )
    await expect(
      migrator.query(
        `insert into api.records(workspace_id,project_id,kind,identifier,title,custom_fields,created_by_user_id)
         values($1,$2,'experiment','EXP-2026-0003','Invalid reference',jsonb_build_object('source_sample',$3::text),$4)`,
        [WS, PROJECT, targets[0].id, OWNER],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('supports file and Study definitions in the canonical registry', async () => {
    const owner = await actor(OWNER)
    const file = await field(owner, 'file', 'document_class', 'text')
    await expect(
      owner.query(`select api.activate_model_field($1)`, [file.id]),
    ).resolves.toBeDefined()
    const study = await field(owner, 'study', 'therapeutic_area', 'text')
    await expect(
      owner.query(`select api.activate_model_field($1)`, [study.id]),
    ).resolves.toBeDefined()
  })

  it('creates and edits a Sample with required model fields atomically', async () => {
    const owner = await actor(OWNER)
    const { rows: definitions } = await owner.query(
      `select * from api.create_and_activate_model_field(
        $1,'sample','study_arm','Study arm','category',false,'"control"'::jsonb,'{}'::jsonb,
        '[{"key":"control","label":"Control"},{"key":"treated","label":"Treated"}]'::jsonb
      )`,
      [WS],
    )
    expect(definitions[0].lifecycle).toBe('active')
    const retained = await field(owner, 'sample', 'legacy_note', 'text')
    await owner.query(`select api.activate_model_field($1)`, [retained.id])
    const { rows: created } = await owner.query(
      `select * from api.create_model_record(
        $1,'sample','Vertical slice','available','{}','{}','{"study_arm":"treated","legacy_note":"keep"}'
      )`,
      [PROJECT],
    )
    expect(created[0].custom_fields).toEqual({
      legacy_note: 'keep',
      study_arm: 'treated',
    })
    await owner.query(`select api.retire_model_field($1)`, [retained.id])
    const { rows: edited } = await owner.query(
      `select * from api.edit_sample($1,$2,'Vertical slice edited',null,null,null,'{"study_arm":"control"}')`,
      [created[0].id, created[0].metadata_version],
    )
    expect(edited[0]).toMatchObject({
      title: 'Vertical slice edited',
      custom_fields: { legacy_note: 'keep', study_arm: 'control' },
    })
  })

  it('updates record-backed model fields with concurrency and lock guards', async () => {
    const owner = await actor(OWNER)
    const definition = await field(owner, 'report', 'programme', 'text')
    await owner.query(`select api.activate_model_field($1)`, [definition.id])
    const { rows: records } = await migrator.query(
      `insert into api.records(workspace_id,project_id,kind,identifier,title,created_by_user_id)
       values($1,$2,'report','RPT-2026-5799','Model field report',$3) returning id`,
      [WS, PROJECT, OWNER],
    )
    const { rows } = await owner.query(
      `select * from api.update_record_custom_fields($1,1,'{"programme":"Oncology"}')`,
      [records[0].id],
    )
    expect(rows[0]).toMatchObject({
      custom_fields: { programme: 'Oncology' },
      metadata_version: 2,
    })
    await expect(
      owner.query(
        `select api.update_record_custom_fields($1,1,'{"programme":"Stale"}')`,
        [records[0].id],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
  })
})
