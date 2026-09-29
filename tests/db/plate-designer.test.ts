/**
 * OPS-003 integration proof for plate designs, atomic well replacement,
 * optimistic concurrency, archiving, templates, RLS and change events.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000303a'
const WS_B = '00000000-0000-4000-8000-00000000303b'
const PROJ_A = '00000000-0000-4000-8000-00000000313a'
const PROJ_B = '00000000-0000-4000-8000-00000000313b'
const OWNER_A = 'ops003-owner-a'
const MEMBER_A = 'ops003-member-a'
const OWNER_B = 'ops003-owner-b'

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

async function createSample(
  client: Client,
  project: string,
  title: string,
  properties: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_record($1::uuid, 'sample', $2, 'available', ARRAY[]::text[], $3::jsonb)`,
    [project, title, JSON.stringify(properties)],
  )
  return rows[0]
}

async function createDesign(
  client: Client,
  name: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_plate_design($1, $2, $3)`,
    [WS_A, name, PROJ_A],
  )
  return rows[0]
}

function wells(...values: Record<string, unknown>[]): string {
  return JSON.stringify(values)
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS003 Owner A', 'ops003-owner-a@sheetbase.test', true),
      ('${MEMBER_A}', 'OPS003 Member A', 'ops003-member-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS003 Owner B', 'ops003-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops003-a', 'OPS003 A'),
      ('${WS_B}', 'ops003-b', 'OPS003 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'ops3-a', 'OPS003 A'),
      ('${PROJ_B}', '${WS_B}', 'ops3-b', 'OPS003 B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('OPS-003 create_plate_design', () => {
  it('creates a design with the default 96-well format', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const { rows } = await owner.query(
      `SELECT * FROM api.create_plate_design($1, $2, $3)`,
      [WS_A, 'Default plate', PROJ_A],
    )
    expect(rows[0]).toMatchObject({
      workspace_id: WS_A,
      project_id: PROJ_A,
      name: 'Default plate',
      format: '96_well',
      rows: 8,
      cols: 12,
      status: 'draft',
      metadata_version: 1,
    })
  })

  it('rejects an invalid format', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_plate_design($1, $2, $3, $4)`, [
        WS_A,
        'Invalid plate',
        PROJ_A,
        '384_well',
      ]),
      'SB005',
    )
  })

  it('rejects a user who is not a member of the target workspace', async () => {
    const nonMember = await asAuthenticated(MEMBER_A, WS_B)
    await expectDenied(
      nonMember.query(`SELECT * FROM api.create_plate_design($1, $2)`, [
        WS_B,
        'Forbidden plate',
      ]),
      '42501',
    )
  })
})

describe('OPS-003 save_plate_design', () => {
  it('atomically saves wells and their optional values', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Atomic save')
    const sample = await createSample(owner, PROJ_A, 'Linked sample', {
      identifier: 'S-1',
    })
    await owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
      design.id,
      wells(
        {
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRecordId: sample.id,
          sampleIdentifier: 'S-1',
          sampleTitle: 'Linked sample',
          replicate: 1,
          volumeValue: 20,
          volumeUnit: 'uL',
          concentrationValue: 2.5,
          concentrationUnit: 'ng/uL',
          notes: 'primary',
        },
        { wellCode: 'A2', row: 0, col: 1, role: 'positive_control' },
        { wellCode: 'B1', row: 1, col: 0, role: 'blank' },
      ),
    ])
    const { rows } = await owner.query(
      `SELECT well_code, role, sample_record_id, replicate, volume_value::text AS volume_value
       FROM api.plate_wells WHERE design_id = $1 ORDER BY well_code`,
      [design.id],
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      well_code: 'A1',
      role: 'sample',
      sample_record_id: sample.id,
      replicate: 1,
      volume_value: '20',
    })
  })

  it('replaces existing wells and bumps metadata_version on every save', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Replacement')
    const first = await owner.query(
      `SELECT * FROM api.save_plate_design($1, $2::jsonb, NULL, $3)`,
      [
        design.id,
        wells(
          { wellCode: 'A1', row: 0, col: 0, role: 'empty' },
          { wellCode: 'A2', row: 0, col: 1, role: 'empty' },
          { wellCode: 'A3', row: 0, col: 2, role: 'empty' },
        ),
        design.metadata_version,
      ],
    )
    const second = await owner.query(
      `SELECT * FROM api.save_plate_design($1, $2::jsonb, NULL, $3)`,
      [
        design.id,
        wells(
          { wellCode: 'B1', row: 1, col: 0, role: 'negative_control' },
          { wellCode: 'B2', row: 1, col: 1, role: 'blank' },
        ),
        first.rows[0].metadata_version,
      ],
    )
    expect(first.rows[0].metadata_version).toBe(design.metadata_version + 1)
    expect(second.rows[0].metadata_version).toBe(design.metadata_version + 2)
    const { rows } = await owner.query(
      `SELECT well_code FROM api.plate_wells WHERE design_id = $1 ORDER BY well_code`,
      [design.id],
    )
    expect(rows.map((row) => row.well_code)).toEqual(['B1', 'B2'])
  })

  it.each([
    [
      'out-of-bounds well',
      { wellCode: 'Z1', row: 8, col: 0, role: 'empty' },
      'SB017',
    ],
    [
      'invalid role',
      { wellCode: 'A1', row: 0, col: 0, role: 'unknown' },
      'SB019',
    ],
  ])('rejects an %s', async (_label, well, code) => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, `Validation ${code}`)
    await expectDenied(
      owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells(well),
      ]),
      code,
    )
  })

  it('rejects duplicate well codes', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Duplicates')
    await expectDenied(
      owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells(
          { wellCode: 'A1', row: 0, col: 0, role: 'empty' },
          { wellCode: 'A1', row: 0, col: 1, role: 'blank' },
        ),
      ]),
      'SB018',
    )
  })

  it('rejects a link to a non-sample record', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Bad record kind')
    const { rows } = await owner.query(
      `SELECT * FROM api.create_record($1::uuid, 'experiment', $2, 'draft', ARRAY[]::text[], '{}'::jsonb)`,
      [PROJ_A, 'Not a sample'],
    )
    await expectDenied(
      owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells({
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRecordId: rows[0].id,
        }),
      ]),
      'SB009',
    )
  })

  it('rejects a cross-workspace sample link', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const design = await createDesign(ownerA, 'Cross-workspace sample')
    const sampleB = await createSample(ownerB, PROJ_B, 'B sample')
    await expectDenied(
      ownerA.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells({
          wellCode: 'A1',
          row: 0,
          col: 0,
          role: 'sample',
          sampleRecordId: sampleB.id,
        }),
      ]),
      'SB016',
    )
  })
})

describe('OPS-003 concurrent edits', () => {
  it('rejects one same-version save and permits a retry at the new version', async () => {
    const creator = await asAuthenticated(OWNER_A, WS_A)
    const editorA = await asAuthenticated(OWNER_A, WS_A)
    const editorB = await asAuthenticated(MEMBER_A, WS_A)
    const design = await createDesign(creator, 'Concurrent design')
    const attempts = await Promise.allSettled([
      editorA.query(
        `SELECT * FROM api.save_plate_design($1, $2::jsonb, NULL, $3)`,
        [
          design.id,
          wells({ wellCode: 'A1', row: 0, col: 0, role: 'sample' }),
          design.metadata_version,
        ],
      ),
      editorB.query(
        `SELECT * FROM api.save_plate_design($1, $2::jsonb, NULL, $3)`,
        [
          design.id,
          wells({ wellCode: 'A2', row: 0, col: 1, role: 'blank' }),
          design.metadata_version,
        ],
      ),
    ])
    const winner = attempts.find((result) => result.status === 'fulfilled')
    const loser = attempts.find((result) => result.status === 'rejected')
    expect(winner?.status).toBe('fulfilled')
    expect(loser).toMatchObject({
      status: 'rejected',
      reason: { code: 'SB001' },
    })

    if (winner?.status !== 'fulfilled')
      throw new Error('concurrent save had no winner')
    const retryClient = attempts[0].status === 'rejected' ? editorA : editorB
    const { rows: retried } = await retryClient.query(
      `SELECT * FROM api.save_plate_design($1, $2::jsonb, NULL, $3)`,
      [
        design.id,
        wells({ wellCode: 'C1', row: 2, col: 0, role: 'empty' }),
        winner.value.rows[0].metadata_version,
      ],
    )
    expect(retried[0].metadata_version).toBe(
      winner.value.rows[0].metadata_version + 1,
    )
  })
})

describe('OPS-003 archive_plate_design', () => {
  it('archives a design and rejects subsequent saves', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Archive me')
    const { rows } = await owner.query(
      `SELECT * FROM api.archive_plate_design($1, $2)`,
      [design.id, design.metadata_version],
    )
    expect(rows[0]).toMatchObject({ status: 'archived', metadata_version: 2 })
    await expectDenied(
      owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells({ wellCode: 'A1', row: 0, col: 0, role: 'empty' }),
      ]),
      'SB004',
    )
  })
})

describe('OPS-003 RLS and workspace isolation', () => {
  it('cannot read or save a design from another workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const design = await createDesign(ownerA, 'A only design')
    const { rows } = await ownerB.query(
      `SELECT * FROM api.plate_designs WHERE id = $1`,
      [design.id],
    )
    expect(rows).toHaveLength(0)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
        design.id,
        wells({ wellCode: 'A1', row: 0, col: 0, role: 'empty' }),
      ]),
      'SB016',
    )
  })
})

describe('OPS-003 plate layout templates', () => {
  it('creates and updates a template by id', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const created = await owner.query(
      `SELECT * FROM api.save_plate_layout_template($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        WS_A,
        'Controls',
        'Initial',
        '96_well',
        8,
        12,
        JSON.stringify({ controls: ['A1'] }),
      ],
    )
    const updated = await owner.query(
      `SELECT * FROM api.save_plate_layout_template($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        WS_A,
        'Controls v2',
        'Updated',
        '96_well',
        8,
        12,
        JSON.stringify({ controls: ['A1', 'A2'] }),
        created.rows[0].id,
      ],
    )
    expect(updated.rows[0]).toMatchObject({
      id: created.rows[0].id,
      name: 'Controls v2',
      description: 'Updated',
      layout: { controls: ['A1', 'A2'] },
    })
  })

  it('isolates templates by workspace', async () => {
    const ownerA = await asAuthenticated(OWNER_A, WS_A)
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const created = await ownerA.query(
      `SELECT * FROM api.save_plate_layout_template($1, $2)`,
      [WS_A, 'Private template'],
    )
    const { rows } = await ownerB.query(
      `SELECT * FROM api.plate_layout_templates WHERE id = $1`,
      [created.rows[0].id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('OPS-003 change events', () => {
  it('emits plate_design and plate_well events', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const design = await createDesign(owner, 'Event source')
    await owner.query(`SELECT * FROM api.save_plate_design($1, $2::jsonb)`, [
      design.id,
      wells(
        { wellCode: 'A1', row: 0, col: 0, role: 'sample' },
        { wellCode: 'A2', row: 0, col: 1, role: 'blank' },
      ),
    ])
    const { rows } = await owner.query(
      `SELECT entity_type, operation FROM api.change_events
       WHERE workspace_id = $1
         AND ((entity_type = 'plate_design' AND entity_uuid = $2)
           OR (entity_type = 'plate_well' AND payload->>'design_id' = $2::text))
       ORDER BY created_at`,
      [WS_A, design.id],
    )
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'plate_design',
          operation: 'create',
        }),
        expect.objectContaining({
          entity_type: 'plate_well',
          operation: 'create',
        }),
      ]),
    )
  })
})
