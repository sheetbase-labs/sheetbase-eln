/**
 * AUTH-004 integration proof: row-level security isolates workspaces. Two
 * workspaces, three users (owner of A, owner of B, member of A) and projects
 * in each. Reads, inserts, updates and deletes are exercised as the
 * `authenticated` role with real claim GUCs, plus the missing-claim and anon
 * failure paths.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const DENIED = '42501'

const WS_A = '00000000-0000-4000-8000-00000000010a'
const WS_B = '00000000-0000-4000-8000-00000000010b'
const PROJ_A = '00000000-0000-4000-8000-00000000020a'
const PROJ_B = '00000000-0000-4000-8000-00000000020b'
const OWNER_A = 'rls-owner-a'
const OWNER_B = 'rls-owner-b'
const MEMBER_A = 'rls-member-a'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER_A}', 'Owner A', 'owner-a@sheetbase.test', true),
      ('${OWNER_B}', 'Owner B', 'owner-b@sheetbase.test', true),
      ('${MEMBER_A}', 'Member A', 'member-a@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS_A}', 'ws-a', 'Workspace A'),
      ('${WS_B}', 'ws-b', 'Workspace B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS_A}', '${OWNER_A}', 'owner'),
      ('${WS_B}', '${OWNER_B}', 'owner'),
      ('${WS_A}', '${MEMBER_A}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
      ('${PROJ_A}', '${WS_A}', 'proj-a', 'Project A'),
      ('${PROJ_B}', '${WS_B}', 'proj-b', 'Project B')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
  })
}

async function asAuthenticated(
  userId: string,
  workspaceId: string,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

async function projectIds(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id::text FROM api.projects ORDER BY id',
  )
  return rows.map((r) => r.id)
}

describe('workspace read isolation', () => {
  it('shows an owner only their own workspace and its projects', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    expect(await projectIds(a)).toEqual([PROJ_A])
    const { rows: ws } = await a.query<{ id: string }>(
      'SELECT id::text FROM api.workspaces ORDER BY id',
    )
    expect(ws.map((r) => r.id)).toEqual([WS_A])
  })

  it('shows a different owner only their own workspace and its projects', async () => {
    const b = await asAuthenticated(OWNER_B, WS_B)
    expect(await projectIds(b)).toEqual([PROJ_B])
  })

  it('lets a member read all memberships of their workspace', async () => {
    const a = await asAuthenticated(MEMBER_A, WS_A)
    const { rows } = await a.query<{ user_id: string }>(
      'SELECT user_id::text AS user_id FROM api.workspace_memberships ORDER BY user_id',
    )
    expect(rows.map((r) => r.user_id).sort()).toEqual(
      [MEMBER_A, OWNER_A].sort(),
    )
  })
})

describe('project writes', () => {
  it('lets a member create a project in their own workspace', async () => {
    const a = await asAuthenticated(MEMBER_A, WS_A)
    await a.query(
      `INSERT INTO api.projects (workspace_id, key, title) VALUES ('${WS_A}', 'new-by-member', 'Member Project')`,
    )
  })

  it('rejects inserting a project into another workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      a.query(
        `INSERT INTO api.projects (workspace_id, key, title) VALUES ('${WS_B}', 'sneaky', 'Sneaky')`,
      ),
      DENIED,
    )
  })

  it('lets a member update a project but not move it between workspaces', async () => {
    const a = await asAuthenticated(MEMBER_A, WS_A)
    await a.query(
      `UPDATE api.projects SET title = 'Renamed' WHERE id = '${PROJ_A}'`,
    )
    await expectDenied(
      a.query(
        `UPDATE api.projects SET workspace_id = '${WS_B}' WHERE id = '${PROJ_A}'`,
      ),
      DENIED,
    )
  })

  it('makes project deletion owner-only', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    // Member cannot delete: the DELETE policy's owner-only USING excludes the
    // row, so the statement silently affects zero rows.
    await member.query(`DELETE FROM api.projects WHERE id = '${PROJ_A}'`)
    const { rows } = await migrator.query<{ id: string }>(
      `SELECT id::text FROM api.projects WHERE id = '${PROJ_A}'`,
    )
    expect(rows).toHaveLength(1)

    const owner = await asAuthenticated(OWNER_A, WS_A)
    await owner.query(`DELETE FROM api.projects WHERE id = '${PROJ_A}'`)
    const { rows: after } = await migrator.query<{ id: string }>(
      `SELECT id::text FROM api.projects WHERE id = '${PROJ_A}'`,
    )
    expect(after).toHaveLength(0)
  })

  it('cannot delete or update a project in another workspace', async () => {
    const a = await asAuthenticated(OWNER_A, WS_A)
    // projB belongs to WS_B and is invisible to owner A: updates affect 0 rows.
    await a.query(
      `UPDATE api.projects SET title = 'Hijacked' WHERE id = '${PROJ_B}'`,
    )
    await a.query(`DELETE FROM api.projects WHERE id = '${PROJ_B}'`)
    const { rows } = await migrator.query<{ id: string; title: string }>(
      `SELECT id::text, title FROM api.projects WHERE id = '${PROJ_B}'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Project B')
  })
})

describe('membership writes are owner-only', () => {
  it('rejects a member adding a membership', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    await expectDenied(
      member.query(
        `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES ('${WS_A}', 'rls-invite', 'member')`,
      ),
      DENIED,
    )
  })

  it('rejects an owner adding a membership to another workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await expectDenied(
      owner.query(
        `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES ('${WS_B}', 'rls-invite', 'member')`,
      ),
      DENIED,
    )
  })
})

describe('workspace metadata writes are owner-only', () => {
  it('rejects a member renaming the workspace', async () => {
    const member = await asAuthenticated(MEMBER_A, WS_A)
    // The UPDATE policy's owner-only USING excludes the row for a member, so
    // the statement silently affects zero rows — the name must not change.
    await member.query(
      `UPDATE api.workspaces SET name = 'Hijacked' WHERE id = '${WS_A}'`,
    )
    const { rows } = await migrator.query<{ name: string }>(
      `SELECT name FROM api.workspaces WHERE id = '${WS_A}'`,
    )
    expect(rows[0]?.name).toBe('Workspace A')
  })

  it('lets the owner rename the workspace', async () => {
    const owner = await asAuthenticated(OWNER_A, WS_A)
    await owner.query(
      `UPDATE api.workspaces SET name = 'Workspace A Renamed' WHERE id = '${WS_A}'`,
    )
    const { rows } = await migrator.query<{ name: string }>(
      `SELECT name FROM api.workspaces WHERE id = '${WS_A}'`,
    )
    expect(rows[0]?.name).toBe('Workspace A Renamed')
  })
})

describe('missing or malformed claims', () => {
  it('returns no private data when claims are missing', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query('RESET request.jwt.claims')
    expect(await projectIds(client)).toEqual([])
  })

  it('returns no private data when claims are malformed', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query(
      "SELECT set_config('request.jwt.claims', 'garbage', false)",
    )
    expect(await projectIds(client)).toEqual([])
  })

  it('denies the anonymous role any access to projects', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE anon')
    await expectDenied(client.query('SELECT * FROM api.projects'), DENIED)
  })
})
