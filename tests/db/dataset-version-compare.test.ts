/**
 * DSET-03.2 — compare_dataset_versions computes added, changed (per field,
 * including flag-only changes) and removed rows between two snapshots.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000a0a'
const PROJECT = '00000000-0000-4000-8000-000000000a0b'
const DATASET = '00000000-0000-4000-8000-000000000a0c'
const SCHEMA_DEF = '00000000-0000-4000-8000-000000000a0d'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000000a0e'
const FIELD_TITRE = '00000000-0000-4000-8000-000000000a0f'
const FIELD_FLAG = '00000000-0000-4000-8000-000000000a10'
const VERSION_A = '00000000-0000-4000-8000-000000000a11'
const VERSION_B = '00000000-0000-4000-8000-000000000a12'
const ROW_1 = '00000000-0000-4000-8000-000000000a13'
const ROW_2 = '00000000-0000-4000-8000-000000000a14'
const ROW_3 = '00000000-0000-4000-8000-000000000a15'
const USER = 'compare-user'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${USER}', 'Compare User', 'compare@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'compare-ws', 'Compare WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES ('${WS}', '${USER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES ('${PROJECT}', '${WS}', 'cmp', 'Compare project')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS}', 'compare_schema', 'Compare schema', 'active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_TITRE}', 'titre', 'Titre', 'decimal', true, 1),
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD_FLAG}', 'flagged', 'Flagged', 'boolean', true, 2)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'Compare dataset', '${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_versions (id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label) VALUES
      ('${VERSION_A}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 1, 'A'),
      ('${VERSION_B}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 2, 'B')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_rows (dataset_version_id, row_id, revision) VALUES
      ('${VERSION_A}', '${ROW_1}', 1), ('${VERSION_A}', '${ROW_2}', 1),
      ('${VERSION_B}', '${ROW_1}', 1), ('${VERSION_B}', '${ROW_3}', 1)`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_values (dataset_version_id, row_id, field_id, ordinal, numeric_value, boolean_value) VALUES
      ('${VERSION_A}', '${ROW_1}', '${FIELD_TITRE}', 0, 1.0, NULL),
      ('${VERSION_A}', '${ROW_1}', '${FIELD_FLAG}', 0, NULL, false),
      ('${VERSION_A}', '${ROW_2}', '${FIELD_TITRE}', 0, 2.0, NULL),
      ('${VERSION_B}', '${ROW_1}', '${FIELD_TITRE}', 0, 1.0, NULL),
      ('${VERSION_B}', '${ROW_1}', '${FIELD_FLAG}', 0, NULL, true),
      ('${VERSION_B}', '${ROW_3}', '${FIELD_TITRE}', 0, 3.0, NULL)`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: USER, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

interface CompareResult {
  counts: { added: number; removed: number; changed: number }
  columns: unknown[]
  rows: Array<{
    rowId: string
    kind: string
    fields: Array<{ fieldId: string; from: unknown; to: unknown }>
  }>
}

describe('api.compare_dataset_versions', () => {
  it('classifies added, removed and changed rows with per-field changes', async () => {
    const client = await asAuthenticated()
    const { rows } = await client.query<{ result: CompareResult }>(
      `SELECT api.compare_dataset_versions($1, $2, 100, 0) AS result`,
      [VERSION_A, VERSION_B],
    )
    const result = rows[0]!.result
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 1 })

    const changed = result.rows.find((row) => row.rowId === ROW_1)
    expect(changed?.kind).toBe('changed')
    // Only the flag changed; the titre value is untouched.
    expect(changed?.fields).toEqual([
      { fieldId: FIELD_FLAG, from: false, to: true },
    ])

    expect(result.rows.find((row) => row.rowId === ROW_2)?.kind).toBe('removed')
    expect(result.rows.find((row) => row.rowId === ROW_3)?.kind).toBe('added')
  })

  it('refuses an unknown version', async () => {
    const client = await asAuthenticated()
    await expect(
      client.query(`SELECT api.compare_dataset_versions($1, $2, 100, 0)`, [
        VERSION_A,
        '00000000-0000-4000-8000-0000000000ff',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

interface VersionListRow {
  id: string
  rowCount: number
  change: { added: number; removed: number; changed: number } | null
}

describe('api.dataset_version_list', () => {
  it('lists snapshots newest first with the change against the previous one', async () => {
    const client = await asAuthenticated()
    const { rows } = await client.query<{ result: VersionListRow[] }>(
      `SELECT api.dataset_version_list($1) AS result`,
      [DATASET],
    )
    const list = rows[0]!.result
    expect(list.map((version) => version.id)).toEqual([VERSION_B, VERSION_A])
    expect(list[0]!.change).toEqual({ added: 1, removed: 1, changed: 1 })
    expect(list[0]!.rowCount).toBe(2)
    expect(list[1]!.change).toBeNull()
  })
})

describe('api.dataset_version_retention', () => {
  it('keeps an active dataset snapshot indefinitely', async () => {
    const client = await asAuthenticated()
    const { rows } = await client.query<{
      result: { reason: string; keptUntil: string | null }
    }>(`SELECT api.dataset_version_retention($1) AS result`, [VERSION_A])
    expect(rows[0]!.result).toEqual({ reason: 'active', keptUntil: null })
  })

  it('dates uncited retention from the dataset archive time', async () => {
    await migrator.query(
      `UPDATE api.datasets SET archived_at = '2026-01-01T00:00:00Z', lifecycle = 'archived' WHERE id = $1`,
      [DATASET],
    )
    const client = await asAuthenticated()
    const { rows } = await client.query<{
      result: { reason: string; keptUntil: string }
    }>(`SELECT api.dataset_version_retention($1) AS result`, [VERSION_A])
    expect(rows[0]!.result.reason).toBe('uncited_after_archive')
    expect(rows[0]!.result.keptUntil).toBe('2028-01-01T00:00:00+00:00')
  })
})

describe('api.keep_dataset_version', () => {
  it('requires a reason', async () => {
    const client = await asAuthenticated()
    await expect(
      client.query(`SELECT api.keep_dataset_version($1, '')`, [VERSION_A]),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('records the keep and pushes retention out', async () => {
    const client = await asAuthenticated()
    await client.query(`SELECT api.keep_dataset_version($1, $2)`, [
      VERSION_A,
      'Legal hold pending review',
    ])
    const { rows } = await client.query<{
      result: { reason: string; keptUntil: string }
    }>(`SELECT api.dataset_version_retention($1) AS result`, [VERSION_A])
    expect(rows[0]!.result.reason).toBe('kept')
    expect(new Date(rows[0]!.result.keptUntil).getTime()).toBeGreaterThan(
      Date.now(),
    )
  })
})

describe('api.prune_dataset_versions', () => {
  it('removes only eligible snapshots, honouring keeps and citing', async () => {
    // A dataset archived long enough that the uncited retention has passed.
    await migrator.query(
      `UPDATE api.datasets SET archived_at = '2023-01-01T00:00:00Z', lifecycle = 'archived' WHERE id = $1`,
      [DATASET],
    )
    // VERSION_A was kept by the earlier test, so only VERSION_B is eligible.
    await migrator.query('RESET ROLE')
    const { rows } = await migrator.query<{
      result: { pruned: Array<{ datasetVersionId: string }> }
    }>(`SELECT api.prune_dataset_versions(100) AS result`)
    const prunedIds = rows[0]!.result.pruned.map((p) => p.datasetVersionId)
    expect(prunedIds).toContain(VERSION_B)
    expect(prunedIds).not.toContain(VERSION_A)

    const remaining = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api.dataset_version_rows WHERE dataset_version_id = $1`,
      [VERSION_B],
    )
    expect(remaining.rows[0]!.n).toBe(0)

    const record = await migrator.query<{ pruned_row_count: number }>(
      `SELECT pruned_row_count FROM api.dataset_version_prunes WHERE dataset_version_id = $1`,
      [VERSION_B],
    )
    expect(record.rows[0]!.pruned_row_count).toBe(2)

    const audit = await migrator.query<{ operation: string }>(
      `SELECT operation FROM api.change_events WHERE entity_type = 'dataset_version' AND entity_uuid = $1`,
      [VERSION_B],
    )
    expect(audit.rows.some((row) => row.operation === 'delete')).toBe(true)
  })
})
