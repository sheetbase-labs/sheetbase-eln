/**
 * UI port (DSET-02.1) — api.dataset_list_summary respects RLS and aggregates.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000230a'
const OTHER_WS = '00000000-0000-4000-8000-00000000230b'
const SCHEMA_DEF = '00000000-0000-4000-8000-00000000230c'
const SCHEMA_VERSION = '00000000-0000-4000-8000-00000000230d'
const FIELD = '00000000-0000-4000-8000-00000000230e'
const DATASET = '00000000-0000-4000-8000-00000000230f'
const ROW_1 = '00000000-0000-4000-8000-000000002310'
const ROW_2 = '00000000-0000-4000-8000-000000002311'
const EXPERIMENT = '00000000-0000-4000-8000-000000002313'
const MEMBER = 'dls-member'
const OUTSIDER = 'dls-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'DLS Member', 'dls@sheetbase.test', true),
      ('${OUTSIDER}', 'DLS Outsider', 'dlso@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'dls', 'DLS'), ('${OTHER_WS}', 'dls-other', 'DLS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle)
     VALUES ('${SCHEMA_DEF}', '${WS}', 'dls', 'DLS model', 'active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle)
     VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id, schema_version_id, field_id, key, label, logical_type, display_order, cardinality, lifecycle)
     VALUES ('00000000-0000-4000-8000-000000002312', '${SCHEMA_VERSION}', '${FIELD}', 'observation', 'Observation', 'text', 1, 'one', 'active')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active' WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets (id, workspace_id, schema_version_id, name, display_id)
     VALUES ('${DATASET}', '${WS}', '${SCHEMA_VERSION}', 'DLS dataset', 'DS-9001')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_rows (id, dataset_id, workspace_id) VALUES
      ('${ROW_1}', '${DATASET}', '${WS}'), ('${ROW_2}', '${DATASET}', '${WS}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_value_flags
       (workspace_id, dataset_id, row_id, field_id, kind, reason, set_by_user_id)
     VALUES ('${WS}', '${DATASET}', '${ROW_1}', '${FIELD}', 'out_of_range', 'above range', '${MEMBER}'),
            ('${WS}', '${DATASET}', '${ROW_2}', '${FIELD}', 'missing_unit', 'unit missing', '${MEMBER}')`,
  )
  // The producing experiment (DSET-02.2): the Experiment column and the
  // Validation suffix come from the record_links row and its status.
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, kind, identifier, title, status, created_by_user_id)
     VALUES ('${EXPERIMENT}', '${WS}', 'experiment', 'EXP-9001',
             'DLS experiment', 'approved', '${MEMBER}')`,
  )
  await migrator.query(
    `INSERT INTO api.record_links
       (source_record_id, target_kind, target_identifier, link_type, created_by_user_id)
     VALUES ('${EXPERIMENT}', 'dataset', 'DS-9001', 'dataset', '${MEMBER}')`,
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

describe('api.dataset_list_summary', () => {
  it('counts rows and active issues for a member', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{
      display_id: string
      model: string
      created_by_user_id: string
      row_count: string
      issue_count: string
      out_of_range_count: string
      missing_unit_count: string
      missing_unit_fields: string[] | null
      experiment_display_id: string | null
      review_state: string | null
    }>(`SELECT * FROM api.dataset_list_summary()`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      display_id: 'DS-9001',
      model: 'DLS model v1',
      experiment_display_id: 'EXP-9001',
      missing_unit_fields: ['Observation'],
      review_state: 'locked',
    })
    expect(Number(rows[0]!.row_count)).toBe(2)
    expect(Number(rows[0]!.issue_count)).toBe(2)
    expect(Number(rows[0]!.out_of_range_count)).toBe(1)
    expect(Number(rows[0]!.missing_unit_count)).toBe(1)
  })

  it('shows another workspace nothing', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query(
      `SELECT * FROM api.dataset_list_summary()`,
    )
    expect(rows).toEqual([])
  })
})
