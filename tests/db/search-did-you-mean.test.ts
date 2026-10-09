/**
 * SRCH-01.4 — "did you mean" suggests near-miss identifiers under the caller's
 * RLS.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000170a'
const OTHER_WS = '00000000-0000-4000-8000-00000000170b'
const PROJECT = '00000000-0000-4000-8000-00000000170c'
const OTHER_PROJECT = '00000000-0000-4000-8000-00000000170d'
const MEMBER = 'dym-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${MEMBER}', 'DYM Member', 'dym@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'dym-ws', 'DYM WS'),
      ('${OTHER_WS}', 'dym-other', 'DYM other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES ('${WS}', '${MEMBER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'dym', 'DYM', '${MEMBER}'),
      ('${OTHER_PROJECT}', '${OTHER_WS}', 'dymo', 'DYM other', NULL)`,
  )
  await migrator.query(
    `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier, title, created_by_user_id) VALUES
      (gen_random_uuid(), '${WS}', '${PROJECT}', 'experiment', 'EXP-0934', 'Harvest lot, near miss', '${MEMBER}'),
      (gen_random_uuid(), '${OTHER_WS}', '${OTHER_PROJECT}', 'experiment', 'EXP-0935', 'Other workspace', '${MEMBER}')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(workspaceId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: MEMBER,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('api.search_did_you_mean', () => {
  it('suggests a near-miss identifier in the caller workspace', async () => {
    const member = await asAuthenticated(WS)
    const { rows } = await member.query<{ identifier: string; kind: string }>(
      `SELECT identifier, kind FROM api.search_did_you_mean('EXP-0943', 5)`,
    )
    expect(rows.map((row) => row.identifier)).toContain('EXP-0934')
    expect(rows.map((row) => row.identifier)).not.toContain('EXP-0935')
    expect(rows[0]?.kind).toBe('experiment')
  })

  it('hides archived records unless asked for them', async () => {
    const member = await asAuthenticated(WS)
    await migrator.query(
      `UPDATE api.records SET archived_at = now() WHERE identifier = 'EXP-0934'`,
    )
    const hidden = await member.query(
      `SELECT identifier FROM api.search_did_you_mean('EXP-0943', 5)`,
    )
    expect(hidden.rows).toEqual([])
    const shown = await member.query(
      `SELECT identifier FROM api.search_did_you_mean('EXP-0943', 5, true)`,
    )
    expect(shown.rows.map((row) => row.identifier)).toContain('EXP-0934')
  })

  it('returns nothing in another workspace', async () => {
    const other = await asAuthenticated(OTHER_WS)
    const { rows } = await other.query(
      `SELECT identifier FROM api.search_did_you_mean('EXP-0943', 5)`,
    )
    expect(rows).toEqual([])
  })
})
