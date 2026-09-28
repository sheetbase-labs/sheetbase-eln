/**
 * DSET-01.1 — flag and clear a dataset value. Writes require a workspace
 * writer; the row and field must belong to the dataset; a duplicate active
 * flag updates in place.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000b0a'
const PROJECT = '00000000-0000-4000-8000-000000000b0b'
const DATASET = '00000000-0000-4000-8000-000000000b0c'
const SCHEMA_DEF = '00000000-0000-4000-8000-000000000b0d'
const SCHEMA_VERSION = '00000000-0000-4000-8000-000000000b0e'
const FIELD = '00000000-0000-4000-8000-000000000b0f'
const ROW = '00000000-0000-4000-8000-000000000b10'
const MEMBER = 'flag-member'
const VIEWER = 'flag-viewer'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Flag Member', 'flag-member@sheetbase.test', true),
      ('${VIEWER}', 'Flag Viewer', 'flag-viewer@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'flag-ws', 'Flag WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES ('${PROJECT}', '${WS}', 'flg', 'Flag project')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle) VALUES ('${SCHEMA_DEF}', '${WS}', 'flag_schema', 'Flag schema', 'draft')`,
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
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, primary_project_id) VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'Flag dataset', '${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id) VALUES ('${ROW}', '${DATASET}', '${WS}')`,
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

describe('api.flag_dataset_value', () => {
  it('flags a value and updates a duplicate active flag in place', async () => {
    const member = await asAuthenticated(MEMBER)
    const first = await member.query<{ id: string; kind: string }>(
      `SELECT * FROM api.flag_dataset_value($1, $2, $3, 'out_of_range', 'Above top standard')`,
      [DATASET, ROW, FIELD],
    )
    expect(first.rows[0]?.kind).toBe('out_of_range')

    const second = await member.query<{ id: string }>(
      `SELECT * FROM api.flag_dataset_value($1, $2, $3, 'out_of_range', 'Still above')`,
      [DATASET, ROW, FIELD],
    )
    expect(second.rows[0]?.id).toBe(first.rows[0]?.id)
  })

  it('clears a flag', async () => {
    const member = await asAuthenticated(MEMBER)
    const flag = await member.query<{ id: string }>(
      `SELECT id FROM api.dataset_value_flags WHERE cleared_at IS NULL LIMIT 1`,
    )
    const { rows } = await member.query<{ cleared_at: string }>(
      `SELECT * FROM api.clear_dataset_value_flag($1)`,
      [flag.rows[0]!.id],
    )
    expect(rows[0]?.cleared_at).not.toBeNull()
  })

  it('refuses an unknown kind', async () => {
    const member = await asAuthenticated(MEMBER)
    await expect(
      member.query(
        `SELECT api.flag_dataset_value($1, $2, $3, 'nonsense', 'why')`,
        [DATASET, ROW, FIELD],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a viewer', async () => {
    const viewer = await asAuthenticated(VIEWER)
    await expectDenied(
      viewer.query(
        `SELECT api.flag_dataset_value($1, $2, $3, 'high_cv', 'CV above 20%')`,
        [DATASET, ROW, FIELD],
      ),
      '42501',
    )
  })
})
