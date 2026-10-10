/**
 * MDL-01 follow-up — `api.discover_model_dependencies` resolves a workspace
 * record model (ADR-0051), not only global `api.model_kinds`, so the MDL-02
 * Usage tab can report a workspace model's dependents. A workspace model is
 * treated as an `api.records` host with `record_kind = key`; another
 * workspace's key reads as not found and never leaks.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000d1a0'
const WS_B = '00000000-0000-4000-8000-00000000d1a1'
const PROJECT_A = '00000000-0000-4000-8000-00000000d1a2'
const PROJECT_B = '00000000-0000-4000-8000-00000000d1a3'
const MEMBER_A = 'deps-member-a'
const MEMBER_B = 'deps-member-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${MEMBER_A}', 'Deps A', 'deps-a@sheetbase.test', true),
      ('${MEMBER_B}', 'Deps B', 'deps-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'deps-a', 'Deps A'),
      ('${WS_B}', 'deps-b', 'Deps B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${MEMBER_A}', 'owner'),
      ('${WS_B}', '${MEMBER_B}', 'owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT_A}', '${WS_A}', 'depa', 'Deps A', '${MEMBER_A}'),
      ('${PROJECT_B}', '${WS_B}', 'depb', 'Deps B', '${MEMBER_B}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asUser(userId: string, workspaceId: string): Promise<Client> {
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

interface Dependency {
  kind: string
  label: string
}

async function discover(
  client: Client,
  modelKey: string,
): Promise<Dependency[]> {
  const { rows } = await client.query<{
    result: { dependencies: Dependency[] }
  }>(`SELECT api.discover_model_dependencies($1) AS result`, [modelKey])
  return rows[0]!.result.dependencies
}

describe('workspace model dependency discovery', () => {
  it('reports fields and records of a workspace model to its own workspace', async () => {
    const member = await asUser(MEMBER_A, WS_A)
    const model = await member.query<{ id: string }>(
      `SELECT (api.create_workspace_model($1, 'cell_bank', 'Cell bank', 'CB', NULL)).id AS id`,
      [WS_A],
    )
    const modelId = model.rows[0]!.id
    // MDL-03: publish version 1 so records may be created from the model.
    await member.query(
      `INSERT INTO api.record_model_versions(workspace_id, model_id, version, revision, lifecycle, definition, published_at, created_by_user_id, updated_by_user_id)
       SELECT $1, $2, 1, 1, 'published', '{"fields":[]}'::jsonb, now(), api.current_user_id(), api.current_user_id()`,
      [WS_A, modelId],
    )
    await member.query(
      `UPDATE api.record_models SET current_version = 1, lifecycle = 'published' WHERE id = $1`,
      [modelId],
    )
    await migrator.query(
      `INSERT INTO api.record_field_definitions
         (workspace_id, kind, field_name, label, display_order, logical_type,
          nullable, validation, lifecycle, created_by_user_id)
       VALUES ($1, 'cell_bank', 'passage', 'Passage', 1, 'integer',
               false, '{}'::jsonb, 'active', $2)`,
      [WS_A, MEMBER_A],
    )
    await member.query(
      `SELECT api.create_model_record($1, 'cell_bank', 'Bank one', 'available',
         '{}'::text[], '{}'::jsonb, '{"passage":12}'::jsonb)`,
      [PROJECT_A],
    )
    // The field usage is attributed to the model's identifier, so keep the
    // model id reachable for the assertion below.
    expect(modelId).toBeTruthy()

    const dependencies = await discover(member, 'cell_bank')
    const kinds = dependencies.map((d) => d.kind)
    expect(kinds).toContain('model_field')
    expect(kinds).toContain('record')
    // Record dependencies carry the stable identifier, e.g. CB-0001.
    expect(dependencies.some((d) => d.label.startsWith('CB-'))).toBe(true)
  })

  it('does not let another workspace discover the model', async () => {
    const other = await asUser(MEMBER_B, WS_B)
    await expectDenied(discover(other, 'cell_bank'), '42501')
  })

  it('still discovers built-in kinds', async () => {
    const member = await asUser(MEMBER_A, WS_A)
    const { rows } = await member.query<{ result: { id: string } }>(
      `SELECT api.discover_model_dependencies('sample') AS result`,
    )
    // The built-in registry path is unchanged: it resolves without raising.
    expect(rows[0]!.result.id).toBe('sample')
  })
})
