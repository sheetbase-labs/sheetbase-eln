/**
 * OPS-007 integration proof for report definitions, ordered sections, frozen
 * evidence binding, validation, deterministic generation, locked revisions
 * and RLS isolation.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000607a'
const WS_B = '00000000-0000-4000-8000-00000000607b'
const PROJ_A = '00000000-0000-4000-8000-000000007a07'
const OWNER_A = 'ops007-owner-a'
const OWNER_B = 'ops007-owner-b'
const BLOCK_ID = 'blk-ops007-0001'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let revAId: string
let lockedRevId: string

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

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'OPS007 Owner A', 'ops007-owner-a@sheetbase.test', true),
      ('${OWNER_B}', 'OPS007 Owner B', 'ops007-owner-b@sheetbase.test', true);
     INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ops007-a', 'OPS007 A'),
      ('${WS_B}', 'ops007-b', 'OPS007 B');
     INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'ops007-proj-a', 'OPS007 Project A');`,
  )
  // Seed a record + frozen revision in workspace A with a block the section can
  // bind to. The revision insert trigger derives canonical_snapshot and digest.
  await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${WS_A}', '${PROJ_A}', 'experiment', 'EXP-2025-OPS7', 'Stability Experiment', '${OWNER_A}');`,
  )
  const { rows: recRows } = await migrator.query(
    `SELECT id::text FROM api.records WHERE workspace_id='${WS_A}'`,
  )
  const recordId = recRows[0].id
  const blockSnapshot = JSON.stringify([
    { id: BLOCK_ID, type: 'rich_text', payload: { text: 'Frozen methods' } },
  ])
  const { rows: revRows } = await migrator.query(
    `INSERT INTO api.revisions (record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id) VALUES
      ($1, 1, 1, '{"title":"Stability Experiment"}'::jsonb, $2::jsonb, 'submit', '${OWNER_A}') RETURNING id::text`,
    [recordId, blockSnapshot],
  )
  revAId = revRows[0].id

  // A second record + revision whose record will be locked, to test locked
  // revision binding and deterministic generation.
  await migrator.query(
    `INSERT INTO api.records (workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      ('${WS_A}', '${PROJ_A}', 'experiment', 'EXP-2025-OPS7L', 'Locked Experiment', '${OWNER_A}');`,
  )
  const { rows: lockedRecRows } = await migrator.query(
    `SELECT id::text FROM api.records WHERE identifier='EXP-2025-OPS7L'`,
  )
  const lockedRecordId = lockedRecRows[0].id
  const { rows: lockedRevRows } = await migrator.query(
    `INSERT INTO api.revisions (record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id) VALUES
      ($1, 1, 1, '{"title":"Locked Experiment"}'::jsonb, '[]'::jsonb, 'submit', '${OWNER_A}') RETURNING id::text`,
    [lockedRecordId],
  )
  lockedRevId = lockedRevRows[0].id
  await migrator.query(
    `UPDATE api.records SET locked_at=now(), locked_by_revision_id='${lockedRevId}' WHERE id='${lockedRecordId}'`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function createReport(
  client: Client,
  title: string,
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.create_report_definition($1, $2)`,
    [WS_A, title],
  )
  return rows[0]
}

async function addSection(
  client: Client,
  reportId: string,
  title: string,
  sourceType = 'free_text',
): Promise<Record<string, any>> {
  const { rows } = await client.query(
    `SELECT * FROM api.add_report_section($1, $2, $3, NULL, 'text', $4)`,
    [WS_A, reportId, title, sourceType],
  )
  return rows[0]
}

describe('OPS-007 create_report_definition', () => {
  it('creates a draft report with a workspace-scoped identifier', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Stability Report')
    expect(report).toMatchObject({
      workspace_id: WS_A,
      title: 'Stability Report',
      status: 'draft',
      version: 1,
    })
    expect(report.document_identifier).toMatch(/^RPT-\d{4}-\d{4}$/)
  })

  it('rejects empty titles', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(`SELECT * FROM api.create_report_definition($1, $2)`, [
        WS_A,
        '   ',
      ]),
      'SB044',
    )
  })

  it('rejects cross-workspace creation', async () => {
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.create_report_definition($1, $2)`, [
        WS_A,
        'Forbidden report',
      ]),
      'SB033',
    )
  })
})

describe('OPS-007 report sections and ordering', () => {
  it('appends sections with increasing positions', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Ordered report')
    const s1 = await addSection(owner, report.id, 'Summary')
    const s2 = await addSection(owner, report.id, 'Methods')
    expect(s1.position).toBe(0)
    expect(s2.position).toBe(1)
    const { rows: reordered } = await owner.query(
      `SELECT api.reorder_report_sections($1, $2, $3::jsonb)`,
      [WS_A, report.id, JSON.stringify([s2.id, s1.id])],
    )
    expect(reordered).toBeDefined()
    const { rows: after } = await owner.query(
      `SELECT id, position FROM api.report_sections WHERE report_id=$1 ORDER BY position`,
      [report.id],
    )
    expect(after.map((r: any) => r.id)).toEqual([s2.id, s1.id])
    expect(after.map((r: any) => r.position)).toEqual([0, 1])
  })
})

describe('OPS-007 bind_report_section_source (frozen evidence)', () => {
  it('freezes the referenced block from the revision snapshot', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Frozen report')
    const section = await addSection(
      owner,
      report.id,
      'Methods',
      'revision_block',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, $4::jsonb)`,
      [WS_A, section.id, revAId, JSON.stringify({ blockId: BLOCK_ID })],
    )
    const bound = rows[0]
    expect(bound.source_revision_id).toBe(revAId)
    expect(bound.validation_status).toBe('valid')
    expect(bound.frozen_payload.block.id).toBe(BLOCK_ID)
    expect(bound.frozen_payload.revisionDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('flags a missing block as missing_source', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Missing source report')
    const section = await addSection(
      owner,
      report.id,
      'Missing',
      'revision_block',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, $4::jsonb)`,
      [WS_A, section.id, revAId, JSON.stringify({ blockId: 'does-not-exist' })],
    )
    expect(rows[0].validation_status).toBe('missing_source')
    expect(rows[0].validation_detail.blockId).toBe('does-not-exist')
  })

  it('flags a locked source record as locked but still freezes evidence', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Locked source report')
    const section = await addSection(
      owner,
      report.id,
      'Locked',
      'revision_block',
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, '{}'::jsonb)`,
      [WS_A, section.id, lockedRevId],
    )
    expect(rows[0].validation_status).toBe('locked')
    expect(rows[0].frozen_payload.revisionDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects cross-workspace binding', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Cross bind report')
    const section = await addSection(owner, report.id, 'X')
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(
        `SELECT * FROM api.bind_report_section_source($1, $2, $3, '{}'::jsonb)`,
        [WS_A, section.id, revAId],
      ),
      'SB033',
    )
  })
})

describe('OPS-007 validate_report', () => {
  it('reports stale live references and missing sources', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Validation report')
    // Stale: non-free-text section with no frozen revision.
    await addSection(owner, report.id, 'Stale section', 'revision_block')
    // Valid: bound frozen block.
    const validSec = await addSection(
      owner,
      report.id,
      'Valid section',
      'revision_block',
    )
    await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, $4::jsonb)`,
      [WS_A, validSec.id, revAId, JSON.stringify({ blockId: BLOCK_ID })],
    )
    const { rows } = await owner.query(
      `SELECT * FROM api.validate_report($1, $2)`,
      [WS_A, report.id],
    )
    const summary = rows[0].validate_report
    expect(summary.sections).toBe(2)
    expect(summary.valid).toBe(1)
    expect(summary.stale).toBe(1)
    expect(summary.ready).toBe(false)
  })
})

describe('OPS-007 generate_report (deterministic)', () => {
  it('produces an HTML document, records a checksum, and is deterministic', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Deterministic report')
    const section = await addSection(
      owner,
      report.id,
      'Methods',
      'revision_block',
    )
    await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, $4::jsonb)`,
      [WS_A, section.id, revAId, JSON.stringify({ blockId: BLOCK_ID })],
    )

    const { rows: gen1Rows } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    const gen1 = gen1Rows[0]
    expect(gen1.output_format).toBe('html')
    expect(gen1.output_checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(Number(gen1.output_size_bytes)).toBeGreaterThan(0)
    expect(gen1.actor_user_id).toBe(OWNER_A)
    expect(gen1.output_html).toContain('Deterministic report')
    expect(gen1.output_html).toContain('<!DOCTYPE html>')
    expect(gen1.report_version).toBe(1)

    // Regenerate: identical inputs must produce an identical checksum.
    const { rows: gen2Rows } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    expect(gen2Rows[0].output_checksum).toBe(gen1.output_checksum)
  })

  it('changes the checksum when the section order changes', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Reorder checksum report')
    const s1 = await addSection(owner, report.id, 'Alpha', 'free_text')
    const s2 = await addSection(owner, report.id, 'Beta', 'free_text')
    const { rows: genA } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    await owner.query(
      `SELECT api.reorder_report_sections($1, $2, $3::jsonb)`,
      [WS_A, report.id, JSON.stringify([s2.id, s1.id])],
    )
    const { rows: genB } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    expect(genA[0].output_checksum).not.toBe(genB[0].output_checksum)
  })

  it('deterministically regenerates from a locked source revision', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Locked regenerate report')
    const section = await addSection(
      owner,
      report.id,
      'Locked methods',
      'revision_block',
    )
    await owner.query(
      `SELECT * FROM api.bind_report_section_source($1, $2, $3, '{}'::jsonb)`,
      [WS_A, section.id, lockedRevId],
    )
    const { rows: g1 } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    const { rows: g2 } = await owner.query(
      `SELECT * FROM api.generate_report($1, $2, 'html')`,
      [WS_A, report.id],
    )
    expect(g2[0].output_checksum).toBe(g1[0].output_checksum)
  })

  it('rejects cross-workspace generation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Cross gen report')
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    await expectDenied(
      ownerB.query(`SELECT * FROM api.generate_report($1, $2, 'html')`, [
        WS_A,
        report.id,
      ]),
      'SB033',
    )
  })
})

describe('OPS-007 report_generations audit + RLS', () => {
  it('records the generation row and enforces read isolation', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    const report = await createReport(owner, 'Audit report')
    await owner.query(`SELECT * FROM api.generate_report($1, $2, 'html')`, [
      WS_A,
      report.id,
    ])
    const { rows: ownGens } = await owner.query(
      `SELECT count(*)::int AS n FROM api.report_generations WHERE report_id=$1`,
      [report.id],
    )
    expect(ownGens[0].n).toBeGreaterThanOrEqual(1)
    // A member of workspace B cannot see workspace A generations.
    const ownerB = await asAuthenticated(OWNER_B, WS_B)
    const { rows: crossGens } = await ownerB.query(
      `SELECT count(*)::int AS n FROM api.report_generations WHERE report_id=$1`,
      [report.id],
    )
    expect(crossGens[0].n).toBe(0)
  })
})
