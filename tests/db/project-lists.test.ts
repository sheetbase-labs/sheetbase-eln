/**
 * R5-SURF-02 — a project's Experiments, Samples and Datasets rows are exactly
 * its own.
 *
 * The project tabs read at the `/api/db` boundary: `api.records` filtered by
 * `project_id`/`kind` for experiments and samples, and the
 * `dataset_list_summary` RPC filtered by `p_project_id` for datasets. This
 * suite proves the boundary returns only the named project's rows and that RLS
 * hides another project's rows even when its id is named explicitly.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000ab001'
const OTHER_WS = '00000000-0000-4000-8000-0000000ab002'
const PROJECT_A = '00000000-0000-4000-8000-0000000ab003'
const PROJECT_B = '00000000-0000-4000-8000-0000000ab004'
const SCHEMA_DEF = '00000000-0000-4000-8000-0000000ab005'
const SCHEMA_VERSION = '00000000-0000-4000-8000-0000000ab006'
const FIELD = '00000000-0000-4000-8000-0000000ab007'
const DS_A = '00000000-0000-4000-8000-0000000ab008'
const DS_B = '00000000-0000-4000-8000-0000000ab009'
const DS_A_ARCHIVED = '00000000-0000-4000-8000-0000000ab010'
const MEMBER = 'pl-member'
const OUTSIDER = 'pl-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'PL Member', 'pl@sheetbase.test', true),
      ('${OUTSIDER}', 'PL Outsider', 'plo@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pl', 'Project lists'),
      ('${OTHER_WS}', 'pl-other', 'Project lists other');
     INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJECT_A}', '${WS}', 'pl-a', 'Project A'),
      ('${PROJECT_B}', '${WS}', 'pl-b', 'Project B');`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'steward'),
      ('${OTHER_WS}', '${OUTSIDER}', 'owner')`,
  )
  // The member can see project A only; project B is in the same workspace but
  // has no project_access row for them.
  await migrator.query(
    `INSERT INTO api.project_access
       (workspace_id, project_id, user_id, can_view, can_edit, can_review, can_manage, granted_by_user_id)
     VALUES ('${WS}', '${PROJECT_A}', '${MEMBER}', true, false, false, false, '${MEMBER}')`,
  )
  await migrator.query(
    `INSERT INTO api.records
       (id, workspace_id, project_id, kind, identifier, title, status, created_by_user_id)
     VALUES
       ('00000000-0000-4000-8000-0000000ab011', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-A1', 'A one', 'in_progress', '${MEMBER}'),
       ('00000000-0000-4000-8000-0000000ab012', '${WS}', '${PROJECT_A}', 'experiment', 'EXP-A2', 'A two', 'draft', '${MEMBER}'),
       ('00000000-0000-4000-8000-0000000ab013', '${WS}', '${PROJECT_B}', 'experiment', 'EXP-B1', 'B one', 'draft', '${MEMBER}'),
       ('00000000-0000-4000-8000-0000000ab014', '${WS}', '${PROJECT_A}', 'sample', 'SMP-A1', 'A sample', 'available', '${MEMBER}'),
       ('00000000-0000-4000-8000-0000000ab015', '${WS}', '${PROJECT_B}', 'sample', 'SMP-B1', 'B sample', 'available', '${MEMBER}'),
       ('00000000-0000-4000-8000-0000000ab016', '${WS}', '${PROJECT_B}', 'sample', 'SMP-B2', 'B sample 2', 'available', '${MEMBER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name, lifecycle)
     VALUES ('${SCHEMA_DEF}', '${WS}', 'pl', 'PL model', 'active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions (id, schema_id, version, lifecycle)
     VALUES ('${SCHEMA_VERSION}', '${SCHEMA_DEF}', 1, 'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id, schema_version_id, field_id, key, label, logical_type, display_order, cardinality, lifecycle)
     VALUES ('00000000-0000-4000-8000-0000000ab017', '${SCHEMA_VERSION}', '${FIELD}',
             'observation', 'Observation', 'text', 1, 'one', 'active')`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions SET lifecycle = 'active' WHERE id = '${SCHEMA_VERSION}'`,
  )
  await migrator.query(
    `INSERT INTO api.datasets
       (id, workspace_id, schema_version_id, name, display_id, primary_project_id, updated_at)
     VALUES
       ('${DS_A}', '${WS}', '${SCHEMA_VERSION}', 'A dataset', 'DS-9001', '${PROJECT_A}', '2026-01-01T00:00:00Z'),
       ('${DS_B}', '${WS}', '${SCHEMA_VERSION}', 'B dataset', 'DS-9002', '${PROJECT_B}', '2026-01-02T00:00:00Z'),
       ('${DS_A_ARCHIVED}', '${WS}', '${SCHEMA_VERSION}', 'A archived', 'DS-9003', '${PROJECT_A}', '2026-01-03T00:00:00Z')`,
  )
  await migrator.query(
    `UPDATE api.datasets SET archived_at = '2026-01-04T00:00:00Z' WHERE id = '${DS_A_ARCHIVED}'`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
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

describe("a project's records", () => {
  it('returns exactly the project’s live experiments and samples', async () => {
    const member = await actor(MEMBER)

    const experiments = await member.query<{ identifier: string }>(
      `SELECT identifier FROM api.records
        WHERE project_id = $1 AND kind = 'experiment'
          AND archived_at IS NULL AND deleted_at IS NULL
        ORDER BY identifier`,
      [PROJECT_A],
    )
    expect(experiments.rows.map((r) => r.identifier)).toEqual([
      'EXP-A1',
      'EXP-A2',
    ])

    const samples = await member.query<{ identifier: string }>(
      `SELECT identifier FROM api.records
        WHERE project_id = $1 AND kind = 'sample'
          AND archived_at IS NULL AND deleted_at IS NULL
        ORDER BY identifier`,
      [PROJECT_A],
    )
    expect(samples.rows.map((r) => r.identifier)).toEqual(['SMP-A1'])
  })

  it('leaks nothing from another project even when its id is named', async () => {
    const member = await actor(MEMBER)
    const foreign = await member.query(
      `SELECT identifier FROM api.records WHERE project_id = $1`,
      [PROJECT_B],
    )
    expect(foreign.rows).toEqual([])
  })

  it('shows another workspace nothing', async () => {
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query(`SELECT identifier FROM api.records`)
    expect(rows).toEqual([])
  })
})

describe("a project's datasets", () => {
  it('returns only the named project’s active datasets', async () => {
    const member = await actor(MEMBER)

    const a = await member.query<{ display_id: string }>(
      `SELECT display_id FROM api.dataset_list_summary(
         p_project_id => $1, p_include_archived => false)`,
      [PROJECT_A],
    )
    expect(a.rows.map((r) => r.display_id)).toEqual(['DS-9001'])

    const b = await member.query(
      `SELECT display_id FROM api.dataset_list_summary(
         p_project_id => $1, p_include_archived => false)`,
      [PROJECT_B],
    )
    expect(b.rows).toEqual([])
  })

  it('keeps the global registry reading: visible datasets, archived included by default', async () => {
    const member = await actor(MEMBER)
    const all = await member.query<{ display_id: string }>(
      `SELECT display_id FROM api.dataset_list_summary()`,
    )
    expect(all.rows.map((r) => r.display_id).sort()).toEqual([
      'DS-9001',
      'DS-9003',
    ])
  })

  it('pages the project’s datasets newest first', async () => {
    const member = await actor(MEMBER)
    const first = await member.query<{ display_id: string }>(
      `SELECT display_id FROM api.dataset_list_summary(
         p_project_id => $1, p_include_archived => true, p_limit => 1, p_offset => 0)`,
      [PROJECT_A],
    )
    expect(first.rows.map((r) => r.display_id)).toEqual(['DS-9003'])
    const second = await member.query<{ display_id: string }>(
      `SELECT display_id FROM api.dataset_list_summary(
         p_project_id => $1, p_include_archived => true, p_limit => 1, p_offset => 1)`,
      [PROJECT_A],
    )
    expect(second.rows.map((r) => r.display_id)).toEqual(['DS-9001'])
  })
})
