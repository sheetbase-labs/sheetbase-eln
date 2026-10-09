/**
 * DSET-01.3 — planned rows. A requested repeat is created with a scheduled
 * time and no values; it refuses values until it is recorded. Writers only.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000c0a'
const PROJECT = '00000000-0000-4000-8000-000000000c0b'
const DATASET = '00000000-0000-4000-8000-000000000c0c'
const SCHEMA_DEF = '00000000-0000-4000-8000-000000000c0d'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000000c0e'
const FIELD = '00000000-0000-4000-8000-000000000c0f'
const MEMBER = 'plan-member'
const VIEWER = 'plan-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Plan Member', 'plan-member@sheetbase.test', true),
      ('${VIEWER}', 'Plan Viewer', 'plan-viewer@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'plan-ws', 'Plan WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES ('${PROJECT}', '${WS}', 'pln', 'Plan project', '${MEMBER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS}', 'plan_schema', 'Plan schema', 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle) VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields (id, schema_version_id, field_id, key, label, logical_type, nullable, display_order) VALUES
      (gen_random_uuid(), '${SCHEMA_VERSION}', '${FIELD}', 'titre', 'Titre', 'decimal', true, 1)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active', published_at = now() WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'Plan dataset', '${PROJECT}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

describe('api.plan_dataset_row', () => {
  it('creates a planned row with a scheduled time and no values', async () => {
    const member = await asAuthenticated(MEMBER)
    const { rows } = await member.query<{
      id: string
      status: string
      scheduled_at: string
    }>(`SELECT * FROM api.plan_dataset_row($1, '2026-09-28T09:00:00+01:00')`, [
      DATASET,
    ])
    expect(rows[0]?.status).toBe('planned')
    expect(rows[0]?.scheduled_at).not.toBeNull()

    const values = await migrator.query(
      `SELECT count(*)::int AS n FROM api.dataset_row_values WHERE row_id = $1`,
      [rows[0]!.id],
    )
    expect(values.rows[0]!.n).toBe(0)
  })

  it('refuses values on a planned row', async () => {
    const member = await asAuthenticated(MEMBER)
    const planned = await member.query<{ id: string }>(
      `SELECT id FROM api.dataset_rows WHERE dataset_id = $1 AND status = 'planned' LIMIT 1`,
      [DATASET],
    )
    // Direct writes are RPC-only, so insert as the migrator: the guard
    // trigger still fires for a planned row.
    await migrator.query('RESET ROLE')
    await expect(
      migrator.query(
        `INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, numeric_value)
         VALUES ($1, $2, 0, 1.0)`,
        [planned.rows[0]!.id, FIELD],
      ),
    ).rejects.toMatchObject({ code: 'SB072' })
  })

  it('refuses a viewer', async () => {
    const viewer = await asAuthenticated(VIEWER)
    await expectDenied(
      viewer.query(`SELECT api.plan_dataset_row($1, NULL)`, [DATASET]),
      '42501',
    )
  })
})
