/**
 * SRCH-01.2 — published Dataset cell values are searchable and RLS-scoped.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000190a'
const OTHER_WS = '00000000-0000-4000-8000-00000000190b'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000190c'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000190d'
const FIELD = '00000000-0000-4000-8000-00000000190e'
const OTHER_SCHEMA_DEF = '00000000-0000-4000-8000-00000000190f'
const OTHER_SCHEMA_VERSION = '00000000-0000-4000-8000-000000001910'
const OTHER_FIELD = '00000000-0000-4000-8000-000000001911'
const DATASET = '00000000-0000-4000-8000-000000001912'
const OTHER_DATASET = '00000000-0000-4000-8000-000000001913'
const VERSION = '00000000-0000-4000-8000-000000001914'
const OTHER_VERSION = '00000000-0000-4000-8000-000000001915'
const ROW = '00000000-0000-4000-8000-000000001916'
const OTHER_ROW = '00000000-0000-4000-8000-000000001917'
const MEMBER = 'dcs-member'
const VIEWER = 'dcs-viewer'
const OUTSIDER = 'dcs-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'DCS Member', 'dcs@sheetbase.test', true),
      ('${VIEWER}', 'DCS Viewer', 'dcsv@sheetbase.test', true),
      ('${OUTSIDER}', 'DCS Outsider', 'dcso@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'dcs-ws', 'DCS WS'),
      ('${OTHER_WS}', 'dcs-other', 'DCS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES
      ('${SCHEMA_DEF}', '${WS}', 'dcs', 'DCS schema', 'active'),
      ('${OTHER_SCHEMA_DEF}', '${OTHER_WS}', 'dcso', 'DCS other schema', 'active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES
      ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft'),
      ('${OTHER_SCHEMA_VERSION}', '${OTHER_SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id, schema_version_id, field_id, key, label, logical_type, display_order, cardinality, lifecycle)
     VALUES
      ('00000000-0000-4000-8000-000000001918', '${SCHEMA_VERSION}', '${FIELD}', 'observation', 'Observation', 'text', 1, 'one', 'active'),
      ('00000000-0000-4000-8000-000000001919', '${OTHER_SCHEMA_VERSION}', '${OTHER_FIELD}', 'observation', 'Observation', 'text', 1, 'one', 'active')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active' WHERE id IN ('${SCHEMA_VERSION}', '${OTHER_SCHEMA_VERSION}')`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, display_id) VALUES
      ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'DCS Dataset', 'DS-9001'),
      ('${OTHER_DATASET}', '${OTHER_WS}', '${OTHER_SCHEMA_VERSION}', 'DCS Other Dataset', 'DS-9002')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_versions
       (id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label)
     VALUES
      ('${VERSION}', '${DATASET}', '${WS}', '${SCHEMA_VERSION}', 1, 'v1'),
      ('${OTHER_VERSION}', '${OTHER_DATASET}', '${OTHER_WS}', '${OTHER_SCHEMA_VERSION}', 1, 'v1')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_rows (dataset_version_id, row_id, revision) VALUES
      ('${VERSION}', '${ROW}', 1),
      ('${OTHER_VERSION}', '${OTHER_ROW}', 1)`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_version_values (dataset_version_id, row_id, field_id, ordinal, text_value) VALUES
      ('${VERSION}', '${ROW}', '${FIELD}', 0, 'C-150 at a 1:5 dilution, 150 mM'),
      ('${OTHER_VERSION}', '${OTHER_ROW}', '${OTHER_FIELD}', 0, 'C-150 at a 1:5 dilution, 150 mM')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('api.search_cells', () => {
  it('finds a published cell with its dataset and matched column', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{
      dataset_name: string
      field_label: string
      value_text: string
      snippet: string
    }>(`SELECT * FROM api.search_cells('dilution', 20)`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      dataset_name: 'DCS Dataset',
      field_label: 'Observation',
    })
    expect(rows[0]?.value_text).toContain('1:5 dilution')
    expect(rows[0]?.snippet).toContain('dilution')
  })

  it('lets a workspace viewer read cell matches', async () => {
    const viewer = await asAuthenticated(VIEWER, WS)
    const { rows } = await viewer.query(
      `SELECT * FROM api.search_cells('dilution', 20)`,
    )
    expect(rows).toHaveLength(1)
  })

  it('shows an outsider only their own workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query<{ dataset_name: string }>(
      `SELECT * FROM api.search_cells('dilution', 20)`,
    )
    expect(rows.map((row) => row.dataset_name)).toEqual(['DCS Other Dataset'])
  })

  it('returns nothing when an outsider claims another workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, WS)
    const { rows } = await outsider.query(
      `SELECT * FROM api.search_cells('dilution', 20)`,
    )
    expect(rows).toEqual([])
  })
})
