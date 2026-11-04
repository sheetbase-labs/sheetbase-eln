/**
 * "Skip for now" on the lab setup dialog is remembered per person in their own
 * preferences row, so another device does not ask again. `api.skip_lab_setup`
 * is the only writer: it writes the caller's row, only for a workspace the
 * caller belongs to, and keeps whatever else the row holds.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const A = 'labskip-a'
const B = 'labskip-b'
const WS1 = '00000000-0000-4000-8000-0000000003a1'
const WS2 = '00000000-0000-4000-8000-0000000003a2'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${A}', 'Skip A', 'labskip-a@sheetbase.test', true),
      ('${B}', 'Skip B', 'labskip-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS1}', 'labskip-ws1', 'Skip WS 1'),
      ('${WS2}', 'labskip-ws2', 'Skip WS 2')
     ON CONFLICT (id) DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS1}', '${A}', 'owner'),
      ('${WS2}', '${A}', 'owner'),
      ('${WS1}', '${B}', 'scientist')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asUser(userId: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      role: 'authenticated',
      sub: userId,
      workspace_id: WS1,
      session_id: 'labskip-session',
    }),
  ])
  return client
}

async function skipped(client: Client) {
  const { rows } = await client.query<{ skipped: unknown }>(
    `SELECT preferences->'labSetupSkipped' AS skipped FROM api.user_preferences`,
  )
  return rows[0]?.skipped ?? null
}

describe('api.skip_lab_setup', () => {
  it('remembers the skip on the caller’s own row, per workspace', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.skip_lab_setup($1)`, [WS1])
    expect(await skipped(a)).toEqual({ [WS1]: true })
    await a.query(`SELECT api.skip_lab_setup($1)`, [WS2])
    expect(await skipped(a)).toEqual({ [WS1]: true, [WS2]: true })
  })

  it('keeps the appearance and other preferences it did not touch', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_user_preference('dark', true)`)
    await a.query(`SELECT api.skip_lab_setup($1)`, [WS1])
    const { rows } = await a.query(
      `SELECT appearance, nav_collapsed FROM api.user_preferences`,
    )
    expect(rows[0]).toMatchObject({ appearance: 'dark', nav_collapsed: true })
  })

  it('does not show one person’s skip to another', async () => {
    const b = await asUser(B)
    expect(await skipped(b)).toBeNull()
  })

  it('refuses a workspace the caller does not belong to', async () => {
    const b = await asUser(B)
    await expect(
      b.query(`SELECT api.skip_lab_setup($1)`, [WS2]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('leaves the preferences table read-only to the app role', async () => {
    const a = await asUser(A)
    await expect(
      a.query(`UPDATE api.user_preferences SET preferences = '{}'::jsonb`),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
