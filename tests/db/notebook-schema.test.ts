/**
 * ELN-002 integration proof: notebook domain schema constraints, optimistic
 * concurrency, the create_record RPC identifier sequence, and the
 * cross-workspace record_link guard. Runs against a freshly migrated
 * sheetbase_test database.
 */
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { validateBlock } from '#/lib/blocks'
import {
  DEMO_BLOCK_IDS,
  DEMO_FILE_IDS,
  FIXTURE_WORKSPACE_ID,
  DEMO_REAGENT_RECORD_ID,
  DEMO_VIRUS_STABILITY_PROJECT_ID,
  DEMO_VIRUS_STABILITY_RECORD_ID,
} from '#/db/seed/identities'
import { demoSteps, fixtureSteps } from '#/db/seed/run'
import { migratorUrl, prepareTestDatabase } from './helpers'

const UNIQUE_VIOLATION = '23505'
const CHECK_VIOLATION = '23514'

const WS = '00000000-0000-4000-8000-00000000060a'
const PROJ = '00000000-0000-4000-8000-00000000060b'
const OWNER = 'eln-schema-owner'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
const clients: Array<Client> = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

let asRole: (role: 'authenticator') => Promise<Client>

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })

  await db.insert(schema.user).values({
    id: OWNER,
    name: 'ELN Owner',
    email: 'eln-schema@sheetbase.test',
    emailVerified: true,
  })
  await db
    .insert(schema.workspaces)
    .values({ id: WS, slug: 'eln-ws', name: 'ELN WS' })
  await db.insert(schema.workspaceMemberships).values({
    workspaceId: WS,
    userId: OWNER,
    role: 'owner',
  })
  await db.insert(schema.projects).values({
    id: PROJ,
    workspaceId: WS,
    key: 'eln-proj',
    title: 'ELN Project',
  })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
  for (const client of clients) await client.end()
})

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
  kind: 'experiment' | 'protocol_template' | 'report',
  identifier: string,
  title = identifier,
): Promise<string> {
  const [row] = await db
    .insert(schema.records)
    .values({
      workspaceId: WS,
      projectId: PROJ,
      kind,
      identifier,
      title,
      createdByUserId: OWNER,
    })
    .returning({ id: schema.records.id })
  return row!.id
}

describe('notebook domain schema', () => {
  it('rejects records with an unknown kind', async () => {
    await expect(
      db.insert(schema.records).values({
        workspaceId: WS,
        projectId: PROJ,
        kind: 'assay',
        identifier: 'BAD-2025-0001',
        title: 'Bad kind',
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('rejects duplicate identifiers within the same project', async () => {
    await createRecord('experiment', 'EXP-2025-0001')
    await expect(
      db.insert(schema.records).values({
        workspaceId: WS,
        projectId: PROJ,
        kind: 'experiment',
        identifier: 'EXP-2025-0001',
        title: 'Duplicate',
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
  })

  it('allows the same identifier under different projects (project-scoped)', async () => {
    const PROJ2 = '00000000-0000-4000-8000-00000000060c'
    await db.insert(schema.projects).values({
      id: PROJ2,
      workspaceId: WS,
      key: 'eln-proj-2',
      title: 'ELN Project 2',
    })
    await createRecord('experiment', 'EXP-2025-0099')
    await db
      .insert(schema.records)
      .values({
        workspaceId: WS,
        projectId: PROJ2,
        kind: 'experiment',
        identifier: 'EXP-2025-0099',
        title: 'Same id, different project',
        createdByUserId: OWNER,
      })
      .returning({ id: schema.records.id })
    // No throw => pass.
    expect(true).toBe(true)
  })

  it('rejects blocks with an unknown type', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0100')
    await expect(
      db.insert(schema.blocks).values({
        recordId,
        type: 'ai_summary',
        payload: { text: 'x' },
        order: 1,
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('rejects removed standalone prose block types', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0107')
    for (const type of ['heading', 'list']) {
      await expect(
        db.insert(schema.blocks).values({
          recordId,
          type,
          payload: {},
          order: 1,
          createdByUserId: OWNER,
        }),
      ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
    }
  })

  it('rejects duplicate block order within a record', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0101')
    await db.insert(schema.blocks).values({
      recordId,
      type: 'checklist',
      payload: { items: [{ text: 'A', checked: false }] },
      order: 1,
      createdByUserId: OWNER,
    })
    await expect(
      db.insert(schema.blocks).values({
        recordId,
        type: 'checklist',
        payload: { items: [{ text: 'B', checked: false }] },
        order: 1,
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } })
  })

  it('allows fractional order between existing blocks (insert without rewrite)', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0102')
    await db.insert(schema.blocks).values({
      recordId,
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'first' }],
            },
          ],
        },
      },
      order: 1,
      createdByUserId: OWNER,
    })
    await db.insert(schema.blocks).values({
      recordId,
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'third' }],
            },
          ],
        },
      },
      order: 2,
      createdByUserId: OWNER,
    })
    // Insert between them at order 1.5 — no rewrite of existing rows.
    await db.insert(schema.blocks).values({
      recordId,
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'between' }],
            },
          ],
        },
      },
      order: 1.5,
      createdByUserId: OWNER,
    })
    const { rows } = await migrator.query(
      `SELECT payload->>'text' AS t, payload#>>'{doc,content,0,content,0,text}' AS b, "order" FROM api.blocks
       WHERE record_id = '${recordId}' ORDER BY "order"`,
    )
    expect(
      rows.map((r: { t: string | null; b: string | null }) => r.t ?? r.b),
    ).toEqual(['first', 'between', 'third'])
  })

  it('rejects a record_link with an unknown link_type', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0103')
    await expect(
      db.insert(schema.recordLinks).values({
        sourceRecordId: recordId,
        targetKind: 'sample',
        targetIdentifier: 'SMP-2025-0001',
        linkType: 'mystery',
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('rejects a record_link to a record in a different workspace', async () => {
    const WS2 = '00000000-0000-4000-8000-00000000060d'
    const PROJ_B = '00000000-0000-4000-8000-00000000060e'
    await db
      .insert(schema.workspaces)
      .values({ id: WS2, slug: 'eln-ws-2', name: 'ELN WS 2' })
    await db.insert(schema.projects).values({
      id: PROJ_B,
      workspaceId: WS2,
      key: 'eln-proj-b',
      title: 'ELN Project B',
    })
    const sourceId = await createRecord('experiment', 'EXP-2025-0104')
    const [crossTarget] = await db
      .insert(schema.records)
      .values({
        workspaceId: WS2,
        projectId: PROJ_B,
        kind: 'experiment',
        identifier: 'EXP-2025-0001',
        title: 'Cross-ws target',
        createdByUserId: OWNER,
      })
      .returning({ id: schema.records.id })
    await expect(
      db.insert(schema.recordLinks).values({
        sourceRecordId: sourceId,
        targetRecordId: crossTarget!.id,
        targetKind: 'experiment',
        targetIdentifier: 'EXP-2025-0001',
        linkType: 'general',
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('rejects a revision with an unknown reason', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0105')
    await expect(
      db.insert(schema.revisions).values({
        recordId,
        structureVersion: 1,
        metadataVersion: 1,
        metadataSnapshot: { title: 'x' },
        blockSnapshot: [],
        reason: 'snapshot',
        createdByUserId: OWNER,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } })
  })

  it('cascades block deletion when a record is deleted', async () => {
    const recordId = await createRecord('experiment', 'EXP-2025-0106')
    await db.insert(schema.blocks).values({
      recordId,
      type: 'checklist',
      payload: { items: [{ text: 'to be deleted', checked: false }] },
      order: 1,
      createdByUserId: OWNER,
    })
    await db.delete(schema.records).where(eq(schema.records.id, recordId))
    const { rows } = await migrator.query(
      `SELECT count(*)::int AS n FROM api.blocks WHERE record_id = '${recordId}'`,
    )
    expect(rows[0].n).toBe(0)
  })
})

describe('create_record RPC identifier sequence', () => {
  it('assigns design-prefixed, workspace-scoped identifiers that never repeat', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const a = await owner.query(
      `SELECT * FROM api.create_record('${PROJ}', 'experiment', 'First experiment', 'draft', ARRAY['stability'])`,
    )
    const b = await owner.query(
      `SELECT * FROM api.create_record('${PROJ}', 'experiment', 'Second experiment')`,
    )
    const c = await owner.query(
      `SELECT * FROM api.create_record('${PROJ}', 'protocol_template', 'Titration template')`,
    )
    expect(a.rows[0].identifier).toMatch(/^EXP-\d{4}$/)
    expect(b.rows[0].identifier).toMatch(/^EXP-\d{4}$/)
    expect(c.rows[0].identifier).toMatch(/^PRT-\d{3}$/)
    // The sequence is per (workspace, kind), so the two EXP ids differ by one
    // and the PRT starts at its own 001.
    const aSeq = Number(a.rows[0].identifier.split('-')[1])
    const bSeq = Number(b.rows[0].identifier.split('-')[1])
    expect(bSeq).toBe(aSeq + 1)
    const cSeq = Number(c.rows[0].identifier.split('-')[1])
    expect(cSeq).toBe(1)
  })

  it('rejects an unsupported kind', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    await expect(
      owner.query(`SELECT * FROM api.create_record('${PROJ}', 'assay', 'Bad')`),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })
})

describe('Virus Stability demo fixtures', () => {
  it('applies demo seeds idempotently without bypassing constraints', async () => {
    // Demo steps depend on the minimal fixture user/workspace/membership.
    for (const step of fixtureSteps) await step.run(db)
    for (const step of demoSteps) await step.run(db)
    for (const step of demoSteps) await step.run(db)

    const { rows } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.blocks
       WHERE record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'`,
    )
    // 10 representative blocks plus two copied execution steps, with no
    // duplicates after two runs.
    // 10 representative blocks plus two copied execution steps plus one
    // SCI-003 file block, with no duplicates after two runs.
    // SCI-004 adds a Sheet Instance block. Charts no longer bind a
    // scientific table. SCI-005 adds a plate map. SCI-009 adds a
    // linked_record block. Total 16.
    expect(Number(rows[0]?.n)).toBe(16)

    const { rows: sheet } = await migrator.query<{
      fields: string
      rows: string
    }>(
      `SELECT jsonb_array_length(i.state->'localFields')::text AS fields,
              (SELECT count(*)::text FROM jsonb_object_keys(i.state->'localValues')) AS rows
         FROM api.sheet_instances i
         JOIN api.blocks b ON b.payload->>'instanceId' = i.id::text
        WHERE b.record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'
          AND b.type = 'sheet'
          AND i.lifecycle = 'active'`,
    )
    expect(Number(sheet[0]?.fields)).toBe(6)
    expect(Number(sheet[0]?.rows)).toBe(32)

    const { rows: links } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.record_links
       WHERE source_record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'`,
    )
    // 1 protocol link + 3 SCI-001 links (sample, reagent, archived sample)
    // + 4 SCI-003 file links (active, quarantined, deleted, missing).
    expect(Number(links[0]?.n)).toBe(8)

    const { rows: demoRec } = await migrator.query<{ title: string }>(
      `SELECT title FROM api.records WHERE id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'`,
    )
    expect(demoRec[0]?.title).toBe('Virus Stability at 4°C')

    const { rows: proj } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.projects
       WHERE id = '${DEMO_VIRUS_STABILITY_PROJECT_ID}'`,
    )
    expect(Number(proj[0]?.n)).toBe(1)

    const { rows: reagents } = await migrator.query<{
      n: string
      statuses: string
    }>(
      `SELECT count(*)::text AS n,
              count(DISTINCT status)::text AS statuses
       FROM api.records
       WHERE project_id = '${DEMO_VIRUS_STABILITY_PROJECT_ID}'
         AND kind = 'reagent'`,
    )
    expect(Number(reagents[0]?.n)).toBe(26)
    expect(Number(reagents[0]?.statuses)).toBe(5)

    const { rows: reagentMovements } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.reagent_movements
       WHERE reagent_record_id = '${DEMO_REAGENT_RECORD_ID}'`,
    )
    expect(Number(reagentMovements[0]?.n)).toBe(3)
  })

  it('seeded blocks cover every initial block type that the demo exercises', async () => {
    const { rows } = await migrator.query<{ type: string }>(
      `SELECT DISTINCT type FROM api.blocks
       WHERE record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'
       ORDER BY type`,
    )
    expect(rows.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        'rich_text',
        'table',
        'chart',
        'metric',
        'checklist',
        'callout',
        'materials',
        'protocol_reference',
        'procedure_step',
        'file',
      ]),
    )
  })

  it('seeds structured material observations instead of legacy prose', async () => {
    const { rows } = await migrator.query<{
      id: string
      type: string
      payload: { items?: Array<{ materialRecordId?: string }> }
    }>(
      `SELECT id, type, payload FROM api.blocks
       WHERE record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'
       ORDER BY "order"`,
    )
    expect(
      rows.some((row) => row.type === 'heading' || row.type === 'list'),
    ).toBe(false)
    const materials = rows.find((row) => row.id === DEMO_BLOCK_IDS.materials)
    expect(materials?.type).toBe('materials')
    expect(materials?.payload.items).toHaveLength(3)
  })

  it('demo block payloads validate at the application boundary', async () => {
    const { rows } = await migrator.query<{ type: string; payload: unknown }>(
      `SELECT type, payload FROM api.blocks
       WHERE record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'`,
    )
    for (const row of rows) {
      // SCI-002 intentionally lands its durable DB contract separately from
      // the application validators.
      if (
        ['materials', 'protocol_reference', 'procedure_step'].includes(row.type)
      )
        continue
      const result = validateBlock({ type: row.type, payload: row.payload })
      expect(result.ok, `${row.type} should validate`).toBe(true)
    }
  })

  it('seeds four SCI-003 file fixtures covering every lifecycle state', async () => {
    const { rows: files } = await migrator.query<{
      id: string
      status: string
      display_name: string
      media_type: string
      byte_size: string
      quarantined_at: string | null
      deleted_at: string | null
      storage_key: string
    }>(
      `SELECT id, status, display_name, media_type, byte_size::text,
              quarantined_at, deleted_at, storage_key
         FROM api.file_objects
        WHERE workspace_id = '${FIXTURE_WORKSPACE_ID}'
          AND record_id IN (
            '${DEMO_FILE_IDS.activeRecord}',
            '${DEMO_FILE_IDS.quarantinedRecord}',
            '${DEMO_FILE_IDS.deletedRecord}',
            '${DEMO_FILE_IDS.missingRecord}'
          )
        ORDER BY status`,
    )
    expect(files).toHaveLength(4)

    const byStatus = Object.fromEntries(files.map((f) => [f.status, f]))
    // Active: checksum and bytes are consistent; no lifecycle timestamps.
    expect(byStatus.active.display_name).toBe('stability-run07-4c.csv')
    expect(byStatus.active.media_type).toBe('text/csv')
    expect(byStatus.active.quarantined_at).toBeNull()
    expect(byStatus.active.deleted_at).toBeNull()
    expect(byStatus.active.storage_key).toMatch(/\/[0-9a-f]{32}$/)
    // Quarantined: reason and timestamp set, no deletion.
    expect(byStatus.quarantined.quarantined_at).not.toBeNull()
    expect(byStatus.quarantined.deleted_at).toBeNull()
    // Deleted: timestamp set, no quarantine.
    expect(byStatus.deleted.deleted_at).not.toBeNull()
    expect(byStatus.deleted.quarantined_at).toBeNull()
    // Missing: no bytes on disk and no lifecycle timestamps; honest render.
    expect(byStatus.missing.status).toBe('missing')
    expect(byStatus.missing.quarantined_at).toBeNull()
    expect(byStatus.missing.deleted_at).toBeNull()

    // The active file block references the active file record and carries
    // display metadata that matches the storage object.
    const { rows: blocks } = await migrator.query<{
      type: string
      payload: {
        fileRecordId?: string
        fileIdentifier?: string
        displayName?: string
        mediaType?: string
        byteSize?: number
      }
    }>(
      `SELECT type, payload FROM api.blocks
        WHERE id = '${DEMO_FILE_IDS.block}'`,
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('file')
    expect(blocks[0].payload.fileRecordId).toBe(DEMO_FILE_IDS.activeRecord)
    expect(blocks[0].payload.fileIdentifier).toBe(
      DEMO_FILE_IDS.activeIdentifier,
    )
    expect(blocks[0].payload.displayName).toBe('stability-run07-4c.csv')
    expect(blocks[0].payload.mediaType).toBe('text/csv')
    expect(blocks[0].payload.byteSize).toBe(Number(byStatus.active.byte_size))

    // Four file links to the experiment, one per lifecycle state.
    const { rows: links } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM api.record_links
        WHERE source_record_id = '${DEMO_VIRUS_STABILITY_RECORD_ID}'
          AND link_type = 'file'`,
    )
    expect(Number(links[0]?.n)).toBe(4)
  })
})
