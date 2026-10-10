/**
 * FIND-02 RLS proof: api.user_favourites SELECT requires BOTH row ownership
 * AND continued workspace membership, and api.set_record_favourite removes
 * the caller-owned pin BEFORE object-resolution/membership checks so stale
 * favourites stay removable.
 *
 * Covered here:
 * - membership revocation hides a user's favourites for that workspace
 *   (the row is retained but invisible — hiding is a read-time concern);
 * - cross-user isolation (user B never sees user A's favourites);
 * - unfavouriting succeeds for a deleted object and for an object in a
 *   workspace the caller left, because the RPC deletes the caller-owned pin
 *   before any object-resolution or membership check (and cannot touch
 *   another user's pin).
 *
 * NOTE: requires a real PostgreSQL database (pnpm services:up). Run via
 * `pnpm test:db`; it is skipped by the plain `pnpm test` src sweep.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase, grantProjectAccess } from './helpers'

const WS_A = '00000000-0000-4000-8000-00000000053a'
const WS_B = '00000000-0000-4000-8000-00000000053b'
const PROJ_A = '00000000-0000-4000-8000-00000000054a'
const PROJ_B = '00000000-0000-4000-8000-00000000054b'
const PROJ_STALE = '00000000-0000-4000-8000-00000000054c'
const PROJ_LEFT = '00000000-0000-4000-8000-00000000054d'
const USER_A = 'favourites-rls-user-a'
const USER_B = 'favourites-rls-user-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${USER_A}', 'Favourites User A', 'favourites-a@sheetbase.test', true),
      ('${USER_B}', 'Favourites User B', 'favourites-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'favourites-ws-a', 'Favourites WS A'),
      ('${WS_B}', 'favourites-ws-b', 'Favourites WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${USER_A}', 'member'),
      ('${WS_B}', '${USER_A}', 'member'),
      ('${WS_B}', '${USER_B}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJ_A}', '${WS_A}', 'fav-proj-a', 'Favourites Project A', '${USER_A}'),
      ('${PROJ_B}', '${WS_B}', 'fav-proj-b', 'Favourites Project B', '${USER_B}'),
      ('${PROJ_STALE}', '${WS_A}', 'fav-proj-stale', 'Favourites Project Stale', '${USER_A}'),
      ('${PROJ_LEFT}', '${WS_A}', 'fav-proj-left', 'Favourites Project Left', '${USER_A}')`,
  )
  await grantProjectAccess(migrator, {
    workspaceId: WS_B,
    projectId: PROJ_B,
    userId: USER_A,
    canView: true,
    canEdit: true,
  })

  // Seed every pin through the only write path: the SECURITY DEFINER RPC.
  // Favouriting resolves the object's project, so each pin is written under the
  // claim of the workspace that owns the project.
  const userAInA = await asAuthenticated(USER_A, WS_A)
  for (const projectId of [PROJ_A, PROJ_STALE, PROJ_LEFT]) {
    await userAInA.query('SELECT api.set_record_favourite($1, $2, true)', [
      'project',
      projectId,
    ])
  }
  const userAInB = await asAuthenticated(USER_A, WS_B)
  await userAInB.query('SELECT api.set_record_favourite($1, $2, true)', [
    'project',
    PROJ_B,
  ])
  const userB = await asAuthenticated(USER_B, WS_B)
  await userB.query('SELECT api.set_record_favourite($1, $2, true)', [
    'project',
    PROJ_B,
  ])
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string = WS_A,
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

async function visibleFavourites(
  client: Client,
): Promise<Array<{ object_id: string }>> {
  const { rows } = await client.query(
    'SELECT object_id FROM api.user_favourites ORDER BY object_id',
  )
  return rows
}

describe('user_favourites RLS', () => {
  it('isolates favourites per user: user B cannot see user A’s favourites', async () => {
    const clientB = await asAuthenticated(USER_B)
    expect(await visibleFavourites(clientB)).toEqual([{ object_id: PROJ_B }])

    const clientA = await asAuthenticated(USER_A)
    expect(await visibleFavourites(clientA)).toEqual([
      { object_id: PROJ_A },
      { object_id: PROJ_B },
      { object_id: PROJ_STALE },
      { object_id: PROJ_LEFT },
    ])
  })

  it('hides favourites for a workspace whose membership was revoked (row retained)', async () => {
    await migrator.query(
      `DELETE FROM api.workspace_memberships
        WHERE workspace_id = '${WS_A}' AND user_id = '${USER_A}'`,
    )
    const clientA = await asAuthenticated(USER_A)
    // The WS_A pins are hidden from the read surface…
    expect(await visibleFavourites(clientA)).toEqual([{ object_id: PROJ_B }])
    // …but retained in the table: hiding is a read-time resolution, not a
    // delete, so reinstating membership restores the favourite.
    const { rows } = await migrator.query(
      `SELECT object_id FROM api.user_favourites
        WHERE user_id = '${USER_A}' AND workspace_id = '${WS_A}'`,
    )
    expect(rows.map((r: { object_id: string }) => r.object_id)).toContain(
      PROJ_A,
    )
  })

  it('unfavourites a deleted object: the RPC deletes before resolving', async () => {
    // PROJ_STALE's pin exists; delete the canonical object out from under it.
    await migrator.query(`DELETE FROM api.projects WHERE id = '${PROJ_STALE}'`)
    const clientA = await asAuthenticated(USER_A)
    const result = await clientA.query(
      'SELECT api.set_record_favourite($1, $2, false) AS removed_at',
      ['project', PROJ_STALE],
    )
    expect(result.rows[0].removed_at).toBeNull()
    const { rows } = await migrator.query(
      `SELECT 1 FROM api.user_favourites
        WHERE user_id = '${USER_A}' AND object_id = '${PROJ_STALE}'`,
    )
    expect(rows).toEqual([])
  })

  it('unfavourites an object in a workspace the caller left, and cannot re-favourite it', async () => {
    // WS_A membership was revoked earlier in this suite.
    const clientA = await asAuthenticated(USER_A)
    const result = await clientA.query(
      'SELECT api.set_record_favourite($1, $2, false) AS removed_at',
      ['project', PROJ_LEFT],
    )
    expect(result.rows[0].removed_at).toBeNull()
    let { rows } = await migrator.query(
      `SELECT 1 FROM api.user_favourites
        WHERE user_id = '${USER_A}' AND object_id = '${PROJ_LEFT}'`,
    )
    expect(rows).toEqual([])

    // Re-favouriting an invisible object is ignored rather than erroring:
    // the star toggle is presentation-support state and must never fail.
    const refavourite = await clientA.query(
      'SELECT api.set_record_favourite($1, $2, true) AS created_at',
      ['project', PROJ_LEFT],
    )
    expect(refavourite.rows[0].created_at).toBeNull()
    ;({ rows } = await migrator.query(
      `SELECT 1 FROM api.user_favourites
        WHERE user_id = '${USER_A}' AND object_id = '${PROJ_LEFT}'`,
    ))
    expect(rows).toEqual([])
  })

  it('never removes another user’s favourite via the unfavourite path', async () => {
    // Both users pinned PROJ_B; user B's pin must survive user A's removal
    // attempt on the same object.
    const clientA = await asAuthenticated(USER_A)
    await clientA.query('SELECT api.set_record_favourite($1, $2, false)', [
      'project',
      PROJ_B,
    ])
    const { rows } = await migrator.query(
      `SELECT 1 FROM api.user_favourites
        WHERE user_id = '${USER_B}' AND object_id = '${PROJ_B}'`,
    )
    expect(rows).toHaveLength(1)
  })
})
