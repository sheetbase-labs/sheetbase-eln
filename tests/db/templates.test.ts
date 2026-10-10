/**
 * SCI-006 integration proof: template identity, lifecycle transitions,
 * instantiation deep-copy + revision + provenance link, archived-template
 * behaviour, later-edit independence, cross-workspace isolation, actor
 * attribution and durable change events.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000310a'
const WS_B = '00000000-0000-4000-8000-00000000310b'
const PROJ_A = '00000000-0000-4000-8000-00000000311a'
const PROJ_B = '00000000-0000-4000-8000-00000000311b'
const OWNER_A = 'sci-006-owner-a'
const MEMBER_A = 'sci-006-member-a'
const OWNER_B = 'sci-006-owner-b'

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
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, $2, $3, $4, ARRAY[]::text[], $5::jsonb)`,
    [project, kind, title, status, JSON.stringify(properties)],
  )
  return rows[0]
}

async function insertBlock(
  client: Client,
  recordId: string,
  type: string,
  payload: unknown,
  order: number,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `INSERT INTO api.blocks(record_id, type, payload, "order", created_by_user_id)
     VALUES($1, $2, $3::jsonb, $4, api.current_user_id()) RETURNING *`,
    [recordId, type, JSON.stringify(payload), order],
  )
  return rows[0]
}

async function instantiate(
  client: Client,
  templateId: string,
  projectId: string,
  targetKind: string,
  title?: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT api.instantiate_template($1, $2, $3, $4) AS result`,
    [templateId, projectId, targetKind, title ?? null],
  )
  return rows[0].result
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'SCI 006 Owner A', 'sci-006-a@sheetbase.test', true),
      ('${MEMBER_A}', 'SCI 006 Member A', 'sci-006-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'SCI 006 Owner B', 'sci-006-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'sci-006-a', 'SCI 006 A'),
      ('${WS_B}', 'sci-006-b', 'SCI 006 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'), ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'sci-006-a', 'SCI 006 A', '${OWNER_A}'),
      ('${PROJ_B}', '${WS_B}', 'sci-006-b', 'SCI 006 B', '${OWNER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('SCI-006 template identity, lifecycle and instantiation', () => {
  it('creates protocol templates with PRT identifiers and denies notebook_template records', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `SELECT * FROM api.create_record($1::uuid, 'notebook_template', 'Blocked', 'draft', ARRAY[]::text[], '{}'::jsonb)`,
        [PROJ_A],
      ),
      '42501',
    )
    const protocol = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Titration Assay',
      'draft',
      { version: '1.0' },
    )
    expect(protocol.identifier).toMatch(/^PRT-\d{3}$/)
    expect(protocol.kind).toBe('protocol_template')
    expect(protocol.status).toBe('draft')
    expect(protocol.created_by_user_id).toBe(OWNER_A)
  })

  it('activates a protocol template (draft → active) and rejects invalid transitions', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Activate me',
      'draft',
      { version: '1.0' },
    )
    const {
      rows: [active],
    } = await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    expect(active.status).toBe('active')
    expect(active.metadata_version).toBe(template.metadata_version + 1)
    expect(active.updated_by_user_id).toBe(OWNER_A)

    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1, 'validated', $2)`,
        [active.id, active.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('instantiates a protocol template into an experiment with deep-copied blocks, revision and provenance link', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Instantiate me',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'rich_text',
      {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Objective text' }],
            },
          ],
        },
      },
      1,
    )
    await insertBlock(
      owner,
      template.id,
      'checklist',
      {
        items: [
          { text: 'Step A', checked: false },
          { text: 'Step B', checked: false },
        ],
      },
      2,
    )
    await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )

    const result = await instantiate(
      owner,
      template.id,
      PROJ_A,
      'experiment',
      'My experiment',
    )
    expect(result.record.kind).toBe('experiment')
    expect(result.record.title).toBe('My experiment')
    expect(result.record.status).toBe('draft')
    expect(result.record.created_by_user_id).toBe(OWNER_A)
    expect(result.blocks).toHaveLength(2)
    expect(result.blocks[0].type).toBe('rich_text')
    expect(result.blocks[1].type).toBe('checklist')

    expect(result.revision.reason).toBe('validate')
    expect(result.revision.record_id).toBe(template.id)
    expect(result.revision.created_by_user_id).toBe(OWNER_A)

    expect(result.link.link_type).toBe('template')
    expect(result.link.target_record_id).toBe(template.id)
    expect(result.link.link_metadata.template_revision_id).toBe(
      result.revision.id,
    )
    expect(result.link.created_by_user_id).toBe(OWNER_A)

    expect(result.record.structure_version).toBeGreaterThanOrEqual(1)

    const { rows: templateBlocks } = await owner.query(
      `SELECT id FROM api.blocks WHERE record_id=$1 ORDER BY "order"`,
      [template.id],
    )
    const copiedIds = result.blocks.map((b: any) => b.id)
    expect(copiedIds).not.toEqual(templateBlocks.map((b: any) => b.id))
  })

  it('keeps instantiated records independent of later template edits', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Edit later',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'rich_text',
      {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Original' }],
            },
          ],
        },
      },
      1,
    )
    await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    const result = await instantiate(owner, template.id, PROJ_A, 'experiment')

    const {
      rows: [liveBlock],
    } = await owner.query(
      `SELECT id FROM api.blocks WHERE record_id=$1 AND type='rich_text' LIMIT 1`,
      [template.id],
    )
    await owner.query(`UPDATE api.blocks SET payload=$2::jsonb WHERE id=$1`, [
      liveBlock.id,
      JSON.stringify({
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Mutated' }] },
          ],
        },
      }),
    ])

    const {
      rows: [copied],
    } = await owner.query(`SELECT payload FROM api.blocks WHERE id=$1`, [
      result.blocks[0].id,
    ])
    expect(copied.payload.doc.content[0].content[0].text).toBe('Original')

    const {
      rows: [revBlock],
    } = await owner.query(
      `SELECT block_snapshot FROM api.revisions WHERE id=$1`,
      [result.revision.id],
    )
    expect(
      revBlock.block_snapshot[0].payload.doc.content[0].content[0].text,
    ).toBe('Original')
  })

  it('rejects instantiation from a draft protocol template (SB006)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Still draft',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'rich_text',
      {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      1,
    )
    await expect(
      instantiate(owner, template.id, PROJ_A, 'experiment'),
    ).rejects.toMatchObject({
      code: 'SB006',
    })
  })

  it('rejects instantiation from an archived template (SB006)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Will archive',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'rich_text',
      {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      1,
    )
    const {
      rows: [active],
    } = await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    await owner.query(`SELECT * FROM api.archive_record($1, $2)`, [
      active.id,
      active.metadata_version,
    ])

    const {
      rows: [visible],
    } = await owner.query(`SELECT archived_at FROM api.records WHERE id=$1`, [
      template.id,
    ])
    expect(visible.archived_at).not.toBeNull()

    await expect(
      instantiate(owner, template.id, PROJ_A, 'experiment'),
    ).rejects.toMatchObject({
      code: 'SB006',
    })
  })

  it('rejects lifecycle transitions on archived templates (frozen until restored)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Frozen',
      'draft',
      { version: '1.0' },
    )
    const {
      rows: [active],
    } = await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    const {
      rows: [archived],
    } = await owner.query(`SELECT * FROM api.archive_record($1, $2)`, [
      active.id,
      active.metadata_version,
    ])
    await expect(
      owner.query(
        `SELECT * FROM api.transition_record_status($1, 'draft', $2)`,
        [archived.id, archived.metadata_version],
      ),
    ).rejects.toMatchObject({ code: 'SB004' })
  })

  it('rejects cross-workspace instantiation at the database boundary (42501)', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const template = await createRecord(
      ownerA,
      PROJ_A,
      'protocol_template',
      'Cross ws',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      ownerA,
      template.id,
      'rich_text',
      {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      1,
    )
    await ownerA.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    const { rows: invisible } = await ownerB.query(
      `SELECT id FROM api.records WHERE id=$1`,
      [template.id],
    )
    expect(invisible).toHaveLength(0)
    await expect(
      instantiate(ownerB, template.id, PROJ_B, 'experiment'),
    ).rejects.toMatchObject({
      code: '42501',
    })
    await expect(
      instantiate(ownerA, template.id, PROJ_B, 'experiment'),
    ).rejects.toMatchObject({
      code: '42501',
    })
  })

  it('instantiates a protocol template into an experiment adding execution fields to procedure steps', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Protocol template',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'procedure_step',
      { text: 'Mix gently', stepNumber: 1 },
      1,
    )
    // Activate the protocol template.
    const {
      rows: [active],
    } = await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    expect(active.status).toBe('active')

    const result = await instantiate(
      owner,
      template.id,
      PROJ_A,
      'experiment',
      'Protocol run',
    )
    expect(result.record.kind).toBe('experiment')
    const step = result.blocks.find((b: any) => b.type === 'procedure_step')
    expect(step).toBeTruthy()
    expect(step.payload.sourceProtocolRevisionId).toBe(result.revision.id)
    expect(step.payload.sourceStepBlockId).toBeTruthy()
    expect(step.payload.completed).toBe(false)
  })

  it('enforces the template-link metadata CHECK at the DB boundary', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Link check',
      'draft',
      { version: '1.0' },
    )
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Link check run',
    )
    // A template link without template_revision_id must be rejected.
    await expect(
      owner.query(
        `INSERT INTO api.record_links
           (source_record_id, target_record_id, target_kind, target_identifier, link_type, link_metadata, created_by_user_id)
         VALUES ($1, $2, 'protocol_template', $3, 'template', '{}'::jsonb, api.current_user_id())`,
        [experiment.id, template.id, template.identifier],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('emits durable change events for template create, activate, archive and instantiation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const template = await createRecord(
      owner,
      PROJ_A,
      'protocol_template',
      'Event proof',
      'draft',
      { version: '1.0' },
    )
    await insertBlock(
      owner,
      template.id,
      'rich_text',
      {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      1,
    )
    const {
      rows: [active],
    } = await owner.query(
      `SELECT * FROM api.transition_record_status($1, 'active', $2)`,
      [template.id, template.metadata_version],
    )
    const result = await instantiate(owner, template.id, PROJ_A, 'experiment')
    await owner.query(`SELECT * FROM api.archive_record($1, $2)`, [
      active.id,
      active.metadata_version,
    ])

    const { rows: events } = await owner.query(
      `SELECT entity_type, operation, actor_user_id FROM api.change_events
       WHERE record_id = $1 ORDER BY sequence`,
      [template.id],
    )
    const create = events.find(
      (e: any) => e.entity_type === 'record' && e.operation === 'create',
    )
    expect(create).toBeTruthy()
    expect(create.actor_user_id).toBe(OWNER_A)

    // Instantiation emitted a record_link link event for the new record.
    const { rows: linkEvents } = await owner.query(
      `SELECT entity_type, operation, actor_user_id FROM api.change_events
       WHERE record_id = $1 AND entity_type = 'record_link'`,
      [result.record.id],
    )
    expect(linkEvents.length).toBeGreaterThanOrEqual(1)
    expect(linkEvents.every((e: any) => e.operation === 'link')).toBe(true)
    expect(linkEvents.every((e: any) => e.actor_user_id === OWNER_A)).toBe(true)

    // Archive emitted an archive event.
    const archive = events.find(
      (e: any) => e.entity_type === 'record' && e.operation === 'archive',
    )
    expect(archive).toBeTruthy()
  })

  it('isolates templates across workspaces (member of A cannot see workspace B templates)', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const memberA = await asAuthenticated(MEMBER_A, WS_A)
    await createRecord(
      ownerB,
      PROJ_B,
      'protocol_template',
      'Workspace B secret',
      'draft',
      { version: '1.0' },
    )
    const { rows: visible } = await memberA.query(
      `SELECT title FROM api.records WHERE kind = 'protocol_template' AND title = 'Workspace B secret'`,
    )
    expect(visible).toHaveLength(0)
    const { rows: aVisible } = await ownerA.query(
      `SELECT title FROM api.records WHERE kind = 'protocol_template' AND title = 'Workspace B secret'`,
    )
    expect(aVisible).toHaveLength(0)
  })

  it('rejects instantiating a non-template record kind (42501)', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const experiment = await createRecord(
      owner,
      PROJ_A,
      'experiment',
      'Not a template',
    )
    await expect(
      instantiate(owner, experiment.id, PROJ_A, 'experiment'),
    ).rejects.toMatchObject({
      code: '42501',
    })
  })
})
