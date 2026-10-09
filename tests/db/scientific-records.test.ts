/**
 * SCI-001 integration proof: scientific record kinds, configurable property
 * validation, lifecycle transitions, workspace isolation, links and events.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000110a'
const WS_B = '00000000-0000-4000-8000-00000000110b'
const PROJ_A = '00000000-0000-4000-8000-00000000111a'
const PROJ_A2 = '00000000-0000-4000-8000-00000000112a'
const PROJ_B = '00000000-0000-4000-8000-00000000111b'
const OWNER_A = 'sci-record-owner-a'
const MEMBER_A = 'sci-record-member-a'
const OWNER_B = 'sci-record-owner-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function createRecord(
  client: Client,
  project: string,
  kind: string,
  title: string,
  status = 'draft',
  customFields: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_model_record(
       $1::uuid, $2, $3, $4, ARRAY[]::text[], '{}'::jsonb, $5::jsonb
     )`,
    [project, kind, title, status, JSON.stringify(customFields)],
  )
  return rows[0]
}

async function addDefinition(
  client: Client,
  fieldName: string,
  logicalType: string,
  nullable = true,
  validation: Record<string, unknown> = {},
  kind = 'sample',
): Promise<Record<string, any>> {
  const options =
    logicalType === 'category' && Array.isArray(validation.enum)
      ? validation.enum.map((key) => ({ key, label: key }))
      : []
  const canonicalValidation = logicalType === 'category' ? {} : validation
  const { rows } = await client.query(
    `SELECT * FROM api.create_and_activate_model_field(
       $1,$2,$3,$3,$4,$5,null,$6::jsonb,$7::jsonb
     )`,
    [
      WS_A,
      kind,
      fieldName,
      logicalType,
      nullable,
      JSON.stringify(canonicalValidation),
      JSON.stringify(options),
    ],
  )
  return rows[0]
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'SCI Owner A', 'sci-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'SCI Member A', 'sci-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'SCI Owner B', 'sci-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'sci-record-a', 'SCI Record A'),
      ('${WS_B}', 'sci-record-b', 'SCI Record B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'), ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'sci-a', 'SCI A', '${OWNER_A}'),
      ('${PROJ_A2}', '${WS_A}', 'sci-a2', 'SCI A2', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'sci-b', 'SCI B', '${OWNER_B}')`,
  )
  const owner = await asAuthenticated(OWNER_A, WS_A)
  await addDefinition(owner, 'required_text', 'text', false)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('scientific record creation and properties', () => {
  it('creates project-scoped sequential identifiers and stores canonical custom fields', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await addDefinition(owner, 'note', 'text')
    const sample1 = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Sample 1',
      'available',
      { required_text: 'tube', note: 'cold' },
    )
    const sample2 = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Sample 2',
      'available',
      { required_text: 'tube' },
    )
    const reagent = await createRecord(
      owner,
      PROJ_A,
      'reagent',
      'Reagent',
      'available',
    )
    const otherProject = await createRecord(
      owner,
      PROJ_A2,
      'sample',
      'Other project',
      'available',
      { required_text: 'tube' },
    )
    expect(sample1.identifier).toMatch(/^SMP-\d{4}$/)
    expect(sample2.identifier).toMatch(/^SMP-\d{4}$/)
    expect(reagent.identifier).toMatch(/^MAT-\d{4}$/)
    expect(otherProject.identifier).toMatch(/^SMP-\d{4}$/)
    expect(sample1.custom_fields).toEqual({
      note: 'cold',
      required_text: 'tube',
    })
  })

  it('rejects unsupported kinds and projects in another workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expect(
      createRecord(owner, PROJ_A, 'assay', 'Bad'),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      createRecord(owner, PROJ_B, 'sample', 'Cross', 'available'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('authoritatively validates missing, typed, category, date, and direct-update values', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await addDefinition(owner, 'count', 'integer')
    await addDefinition(owner, 'mass', 'decimal')
    await addDefinition(owner, 'approved', 'boolean')
    await addDefinition(owner, 'state', 'category', true, {
      enum: ['fresh', 'old'],
    })
    await addDefinition(owner, 'made_on', 'date')

    await expect(
      createRecord(owner, PROJ_A, 'sample', 'Missing', 'available'),
    ).rejects.toMatchObject({ code: 'SB071' })
    for (const invalid of [
      { required_text: 'x', count: '1' },
      { required_text: 'x', mass: 'heavy' },
      { required_text: 'x', approved: 1 },
      { required_text: 'x', state: 'unknown' },
      { required_text: 'x', made_on: '21 July' },
    ]) {
      await expect(
        createRecord(owner, PROJ_A, 'sample', 'Invalid', 'available', invalid),
      ).rejects.toMatchObject({ code: 'SB071' })
    }
    const valid = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Valid',
      'available',
      {
        required_text: 'tube',
        count: 2,
        mass: 1.5,
        approved: true,
        state: 'fresh',
        made_on: '2026-07-21',
      },
    )
    await expect(
      owner.query(
        `UPDATE api.records SET custom_fields='{"required_text":"x","count":"bad"}' WHERE id=$1`,
        [valid.id],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })

  it('validates configured experiment/report fields and preserves retired-field values', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await addDefinition(owner, 'note', 'text', true, {}, 'experiment')
    await addDefinition(owner, 'count', 'integer', true, {}, 'report')
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Configured experiment',
      'draft',
      { note: 'observed' },
    )
    const report = await createRecord(
      owner,
      PROJ_A,
      'report',
      'Configured report',
      'draft',
      { count: 3 },
    )
    const retired = await addDefinition(owner, 'legacy', 'integer')
    const sample = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Legacy',
      'available',
      { required_text: 'x', legacy: 7 },
    )
    await owner.query(`SELECT api.retire_model_field($1)`, [retired.id])
    const preserved = await owner.query(
      `UPDATE api.records SET title='Legacy retained' WHERE id=$1 RETURNING custom_fields`,
      [sample.id],
    )
    expect(experiment.custom_fields).toEqual({ note: 'observed' })
    expect(report.custom_fields.count).toBe(3)
    expect(preserved.rows[0].custom_fields.legacy).toBe(7)
  })
})

describe('record field definitions', () => {
  it('lets owners write, members only read, and isolates other workspaces', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const member = await asAuthenticated(MEMBER_A, WS_A)
    const other = await asAuthenticated(OWNER_B, WS_B)
    const def = await addDefinition(owner, 'owner_field', 'text')
    await owner.query(
      `SELECT api.update_model_field($1,'{"label":"Owner label"}')`,
      [def.id],
    )
    expect(
      (
        await member.query(
          `SELECT id FROM api.record_field_definitions WHERE id=$1`,
          [def.id],
        )
      ).rows,
    ).toHaveLength(1)
    await expect(
      addDefinition(member, 'member_field', 'text'),
    ).rejects.toMatchObject({ code: '42501' })
    expect(
      (
        await other.query(
          `SELECT id FROM api.record_field_definitions WHERE id=$1`,
          [def.id],
        )
      ).rows,
    ).toHaveLength(0)
    await expect(
      other.query(`SELECT api.update_model_field($1,'{"label":"cross"}')`, [
        def.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(addDefinition(other, 'cross', 'text')).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('keeps definition identity stable through supported presentation updates', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const def = await addDefinition(owner, 'immutable_field', 'text')
    const { rows } = await owner.query(
      `SELECT * FROM api.update_model_field($1,'{"label":"Allowed","displayOrder":9}')`,
      [def.id],
    )
    expect(rows[0]).toMatchObject({
      id: def.id,
      field_name: 'immutable_field',
      label: 'Allowed',
      display_order: 9,
    })
    await expect(
      owner.query(
        `SELECT api.update_model_field($1,'{"fieldName":"renamed"}')`,
        [def.id],
      ),
    ).rejects.toMatchObject({ code: 'SB071' })
  })
})

describe('scientific lifecycle, isolation, links, and events', () => {
  it('enforces transitions, optimistic concurrency, actor attribution, and emits events', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Transition',
      'available',
      { required_text: 'x' },
    )
    expect(sample.created_by_user_id).toBe(OWNER_A)
    const { rows: transitioned } = await owner.query(
      `SELECT * FROM api.transition_record_status($1,'reserved',$2)`,
      [sample.id, sample.metadata_version],
    )
    expect(transitioned[0]).toMatchObject({
      status: 'reserved',
      metadata_version: sample.metadata_version + 1,
      updated_by_user_id: OWNER_A,
    })
    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1,'expired',$2)`,
        [sample.id, transitioned[0].metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1,'available',$2)`,
        [sample.id, sample.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB001' })
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Unknown lifecycle',
    )
    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1,'active',$2)`,
        [experiment.id, experiment.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
    const { rows: events } = await owner.query(
      `SELECT entity_type, operation FROM api.change_events WHERE workspace_id=$1 AND entity_uuid=$2 ORDER BY sequence`,
      [WS_A, sample.id],
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity_type: 'record', operation: 'create' }),
        expect.objectContaining({ entity_type: 'record', operation: 'update' }),
      ]),
    )
  })

  it('attributes definition creation and emits its durable create event', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const def = await addDefinition(owner, 'event_field', 'text')
    expect(def.created_by_user_id).toBe(OWNER_A)
    const { rows } = await owner.query(
      `SELECT operation FROM api.change_events WHERE entity_type='record_field_definition' AND entity_uuid=$1`,
      [def.id],
    )
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'create' }),
      ]),
    )
  })

  it('hides sample, reagent, and protocol records from another workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const ids = [
      (
        await createRecord(
          owner,
          PROJ_A,
          'sample',
          'Hidden sample',
          'available',
          { required_text: 'x' },
        )
      ).id,
      (
        await createRecord(
          owner,
          PROJ_A,
          'reagent',
          'Hidden reagent',
          'available',
        )
      ).id,
      (
        await createRecord(
          owner,
          PROJ_A,
          'protocol_template',
          'Hidden protocol',
        )
      ).id,
    ]
    const other = await asAuthenticated(OWNER_B, WS_B)
    expect(
      (
        await other.query(
          `SELECT id FROM api.records WHERE id=ANY($1::uuid[])`,
          [ids],
        )
      ).rows,
    ).toHaveLength(0)
  })

  it('rejects cross-workspace targets and creates all supported same-workspace links', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const other = await asAuthenticated(OWNER_B, WS_B)
    const exp = await createRecord(owner, PROJ_A, 'experiment', 'Link source')
    const sample = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Link sample',
      'available',
      { required_text: 'x' },
    )
    const reagent = await createRecord(
      owner,
      PROJ_A,
      'reagent',
      'Link reagent',
      'available',
    )
    const protocol = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Link protocol',
    )
    const cross = await createRecord(
      other,
      PROJ_B,
      'reagent',
      'Cross target',
      'available',
    )
    for (const [target, kind, linkType] of [
      [sample, 'sample', 'sample'],
      [reagent, 'reagent', 'reagent'],
      [protocol, 'protocol_template', 'protocol'],
    ] as const) {
      const { rows } = await owner.query(
        `SELECT * FROM api.create_record_link($1,$2,$3,$4,$5,NULL)`,
        [exp.id, kind, target.identifier, linkType, target.id],
      )
      expect(rows[0].target_record_id).toBe(target.id)
    }
    await expect(
      owner.query(
        `SELECT * FROM api.create_record_link($1,'reagent',$2,'reagent',$3,NULL)`,
        [exp.id, cross.identifier, cross.id],
      ),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('keeps archived targets and link identifiers readable', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const exp = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Archive linker',
    )
    const sample = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Archived target',
      'available',
      { required_text: 'x' },
    )
    await owner.query(
      `SELECT * FROM api.create_record_link($1,'sample',$2,'sample',$3,NULL)`,
      [exp.id, sample.identifier, sample.id],
    )
    await owner.query(`SELECT * FROM api.archive_record($1,$2)`, [
      sample.id,
      sample.metadata_version,
    ])
    const { rows } = await owner.query(
      `SELECT l.target_identifier, r.archived_at FROM api.record_links l JOIN api.records r ON r.id=l.target_record_id WHERE l.source_record_id=$1`,
      [exp.id],
    )
    expect(rows[0].target_identifier).toBe(sample.identifier)
    expect(rows[0].archived_at).not.toBeNull()
  })

  it('rejects lifecycle transitions on archived records (frozen until restored)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const sample = await createRecord(
      owner,
      PROJ_A,
      'sample',
      'Archived mutation',
      'available',
      { required_text: 'x' },
    )
    const { rows: archived } = await owner.query(
      `SELECT * FROM api.archive_record($1,$2)`,
      [sample.id, sample.metadata_version],
    )
    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1,'reserved',$2)`,
        [sample.id, archived[0].metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })
})
