/**
 * Sequence blocks became blocks of the Sequence tools plugin. The migration keeps
 * every saved payload as the plugin block's state, even in a notebook of an
 * archived project or a workspace that asks for a reason on every change, and
 * the words in the block stay searchable.
 */
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000a5e01'
const LIVE = '00000000-0000-4000-8000-0000000a5e02'
const OLD = '00000000-0000-4000-8000-0000000a5e03'
const REC_LIVE = '00000000-0000-4000-8000-0000000a5e04'
const REC_OLD = '00000000-0000-4000-8000-0000000a5e05'
const USER = 'sequence-plugin-user'

let migrator: Client

const FILE = readFileSync(
  new URL(
    '../../drizzle/20261108193859_sequence_blocks_to_plugin.sql',
    import.meta.url,
  ),
  'utf8',
)
const CONVERT = FILE.slice(
  FILE.indexOf('DO $$\nBEGIN\n  ALTER TABLE api.blocks DISABLE TRIGGER'),
)

const small = {
  residues: 'ATGGCTAGCTAGCTAGGATCCGATCGATCGTAGC',
  name: 'pKanTest',
  molecule: 'dna',
  topology: 'circular',
  title: 'Kan plasmid',
  features: [
    {
      id: 1,
      type: 'CDS',
      label: 'KanRMarker',
      strand: 1,
      parts: [{ start: 1, end: 30 }],
      start: 1,
      end: 30,
      qualifiers: {},
    },
  ],
  primers: [{ id: 'p1', name: 'fwdPrimerQ', seq: 'ATGGCTAGCTAGCTAGG' }],
}
const big = {
  ...small,
  residues: 'ACGTTGCAAC'.repeat(30_000),
  title: 'Big one',
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Seq User', 'seq-plugin@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'seq-plugin-ws', 'Seq WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_settings (workspace_id, require_change_reason, created_by_user_id)
     VALUES ('${WS}', true, '${USER}') ON CONFLICT (workspace_id) DO UPDATE SET require_change_reason = true`,
  )
  for (const [id, key] of [
    [LIVE, 'sqa'],
    [OLD, 'sqb'],
  ])
    await migrator.query(
      `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ($1, '${WS}', $2, $2, NULL)`,
      [id, key],
    )
  for (const [rec, project, ident] of [
    [REC_LIVE, LIVE, 'EXP-SQ1'],
    [REC_OLD, OLD, 'EXP-SQ2'],
  ])
    await migrator.query(
      `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id)
       VALUES ($1, '${WS}', $2, 'experiment', $3, 'Cloning', '${USER}')`,
      [rec, project, ident],
    )
  const add = (record: string, order: number, payload: unknown) =>
    migrator.query(
      `INSERT INTO api.blocks (record_id, type, payload, "order", created_by_user_id)
       VALUES ($1, 'sequence', $2::jsonb, $3, '${USER}')`,
      [record, JSON.stringify(payload), order],
    )
  await add(REC_LIVE, 1, small)
  await add(REC_LIVE, 2, big)
  await add(REC_OLD, 1, { ...small, name: 'archivedSeqName' })
  await migrator.query(
    `UPDATE api.projects SET status = 'archived', archived_at = now() WHERE id = '${OLD}'`,
  )
  await migrator.query(CONVERT)
})

afterAll(async () => {
  await migrator.end()
})

describe('sequence blocks converted to plugin blocks', () => {
  it('keeps each old payload as the plugin block state', async () => {
    const { rows } = await migrator.query(
      `SELECT type, payload, version FROM api.blocks WHERE record_id IN ('${REC_LIVE}', '${REC_OLD}') ORDER BY record_id, "order"`,
    )
    expect(rows.map((r) => r.type)).toEqual(['plugin', 'plugin', 'plugin'])
    expect(rows.every((r) => r.version === 2)).toBe(true)
    expect(rows[0].payload).toEqual({
      plugin: 'sequence-tools',
      block: 'sequence',
      state: small,
    })
    expect(rows[1].payload.state.residues).toHaveLength(300_000)
    expect(rows[2].payload.state.name).toBe('archivedSeqName')
  })

  it('puts every trigger it paused back', async () => {
    const { rows } = await migrator.query(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgname IN ('blocks_identity_immutable', 'enforce_change_reason', 'record_change_reason',
                         'change_event_blocks', 'set_updated_at', 'assert_record_project_active')`,
    )
    expect(rows.length).toBeGreaterThanOrEqual(6)
    expect(rows.every((r) => r.tgenabled === 'O')).toBe(true)
  })

  it('keeps the words searchable, long sequences aside, archived projects included', async () => {
    const { rows } = await migrator.query<{ id: string; hit: Record<string, boolean> }>(
      `SELECT id,
              jsonb_build_object(
                'feature', search_tsv @@ plainto_tsquery('english', 'KanRMarker'),
                'primer', search_tsv @@ plainto_tsquery('english', 'fwdPrimerQ'),
                'title', search_tsv @@ plainto_tsquery('english', 'Big'),
                'archived', search_tsv @@ plainto_tsquery('english', 'archivedSeqName')) AS hit
         FROM api.records WHERE id IN ('${REC_LIVE}', '${REC_OLD}')`,
    )
    const live = rows.find((r) => r.id === REC_LIVE)!.hit
    const old = rows.find((r) => r.id === REC_OLD)!.hit
    expect(live).toMatchObject({ feature: true, primer: true, title: true })
    expect(old.archived).toBe(true)
  })
})
