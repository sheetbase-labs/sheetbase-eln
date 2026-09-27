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
