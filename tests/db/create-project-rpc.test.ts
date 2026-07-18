/**
 * API-004 contract proof: the create_project RPC generates a stable per-
 * workspace key, is subject to the projects_insert RLS policy (defence in
 * depth), and returns the created row. Runs against a freshly migrated
 * sheetbase_test database with real claim GUCs.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const DENIED = '42501'

const WS = '00000000-0000-4000-8000-00000000040a'
const OWNER = 'rpc-owner'
const OUTSIDER = 'rpc-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'RPC Owner', 'rpc-owner@sheetbase.test', true),
      ('${OUTSIDER}', 'RPC Outsider', 'rpc-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'rpc-ws', 'RPC WS')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner')`,
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

describe('api.create_project', () => {
  it('creates a project with a slug derived from the title', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows } = await owner.query<{
      id: string
      key: string
      title: string
      workspace_id: string
    }>(`SELECT * FROM api.create_project('Virus Stability!')`)

    expect(rows[0]?.key).toBe('virus-stability')
    expect(rows[0]?.title).toBe('Virus Stability!')
    expect(rows[0]?.workspace_id).toBe(WS)
    expect(rows[0]?.status).toBe('active')
  })

  it('appends a numeric suffix when the key already exists', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows } = await owner.query<{ key: string }>(
      `SELECT key FROM api.create_project('Virus Stability!')`,
    )
    expect(rows[0]?.key).toBe('virus-stability-2')
  })

  it('falls back to "project" for a whitespace-only title', async () => {
    const owner = await asAuthenticated(OWNER, WS)
    const { rows } = await owner.query<{ key: string; title: string }>(
      `SELECT key, title FROM api.create_project('   ')`,
    )
    // Both key and title fall back so the row is never empty or unnamed.
    expect(rows[0]?.key).toMatch(/^project(-\d+)?$/)
    expect(rows[0]?.title).toBe(rows[0]?.key)
  })

  it('errors when no active workspace is in the claims', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query('RESET request.jwt.claims')

    await expectDenied(
      client.query(`SELECT api.create_project('Anything')`),
      '42804',
    )
  })

  it('errors when the caller is not a member of the active workspace', async () => {
    const outsider = await asAuthenticated(OUTSIDER, WS)
    await expectDenied(
      outsider.query(`SELECT api.create_project('Sneaky')`),
      DENIED,
    )
  })

  it('does not let an outsider read the created project', async () => {
    const outsider = await asAuthenticated(OUTSIDER, WS)
    const { rows } = await outsider.query<{ id: string }>(
      `SELECT id::text FROM api.projects WHERE key = 'virus-stability'`,
    )
    expect(rows).toHaveLength(0)
  })
})
