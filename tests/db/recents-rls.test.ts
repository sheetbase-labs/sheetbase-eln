/**
 * FIND-01 RLS proof: api.recently_viewed SELECT requires BOTH row ownership
 * AND continued workspace membership. A user removed from (or suspended in)
 * a workspace must stop seeing their stale view-tracking rows for that
 * workspace, while rows in workspaces they still belong to stay readable.
 *
 * NOTE: requires a real PostgreSQL database (pnpm services:up). Run via
 * `pnpm test:db`; it is skipped by the plain `pnpm test` src sweep.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000051a'
const WS_B = '00000000-0000-4000-8000-00000000051b'
const USER_A = 'recents-rls-user-a'
const USER_B = 'recents-rls-user-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${USER_A}', 'Recents User A', 'recents-a@sheetbase.test', true),
      ('${USER_B}', 'Recents User B', 'recents-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'recents-ws-a', 'Recents WS A'),
      ('${WS_B}', 'recents-ws-b', 'Recents WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${USER_A}', 'member'),
      ('${WS_B}', '${USER_A}', 'member'),
      ('${WS_B}', '${USER_B}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.recently_viewed (workspace_id, user_id, object_kind, object_id, viewed_at) VALUES
      ('${WS_A}', '${USER_A}', 'project', '00000000-0000-4000-8000-00000000052a', now()),
      ('${WS_B}', '${USER_A}', 'project', '00000000-0000-4000-8000-00000000052b', now())`,
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
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  return client
}

describe('recently_viewed RLS', () => {
  it('returns only the caller’s own rows while memberships are intact', async () => {
    const client = await asAuthenticated(USER_A)
    const { rows } = await client.query(
      'SELECT object_id FROM api.recently_viewed ORDER BY object_id',
    )
    // USER_A owns both seeded rows; USER_B's rows (none seeded here) and
    // everyone else's stay invisible.
    expect(rows.map((r) => r.object_id)).toEqual([
      '00000000-0000-4000-8000-00000000052a',
      '00000000-0000-4000-8000-00000000052b',
    ])
  })

  it('hides rows for a workspace whose membership was revoked', async () => {
    await migrator.query(
      `DELETE FROM api.workspace_memberships
        WHERE workspace_id = '${WS_A}' AND user_id = '${USER_A}'`,
    )
    const client = await asAuthenticated(USER_A)
    const { rows } = await client.query(
      'SELECT object_id FROM api.recently_viewed ORDER BY object_id',
    )
    // The WS_A row is gone from view; the WS_B row survives.
    expect(rows.map((r) => r.object_id)).toEqual([
      '00000000-0000-4000-8000-00000000052b',
    ])
  })

  it('hides rows while the workspace membership is suspended', async () => {
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at = now()
        WHERE workspace_id = '${WS_B}' AND user_id = '${USER_A}'`,
    )
    const client = await asAuthenticated(USER_A)
    const { rows } = await client.query(
      'SELECT object_id FROM api.recently_viewed',
    )
    expect(rows).toEqual([])
  })

  it('restores visibility when the membership is reinstated', async () => {
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at = NULL
        WHERE workspace_id = '${WS_B}' AND user_id = '${USER_A}'`,
    )
    const client = await asAuthenticated(USER_A)
    const { rows } = await client.query(
      'SELECT object_id FROM api.recently_viewed',
    )
    expect(rows.map((r) => r.object_id)).toEqual([
      '00000000-0000-4000-8000-00000000052b',
    ])
  })
})
