/**
 * SHELL-02 contract: per-user appearance preferences are written only through
 * `api.set_user_preference` and read back under RLS for the row owner.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const A = 'shell02-a'
const B = 'shell02-b'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${A}', 'Shell A', 'shell02-a@sheetbase.test', true),
      ('${B}', 'Shell B', 'shell02-b@sheetbase.test', true)`,
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
      workspace_id: '00000000-0000-4000-8000-0000000000ff',
      session_id: 'shell02-session',
    }),
  ])
  return client
}

describe('user preferences', () => {
  it('sets and reads the caller preferences', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_user_preference('dark', true)`)
    const { rows } = await a.query(
      `SELECT appearance, nav_collapsed FROM api.user_preferences`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ appearance: 'dark', nav_collapsed: true })
  })

  it('upserts on repeat rather than duplicating', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_user_preference('light', false)`)
    await a.query(`SELECT api.set_user_preference('system', true)`)
    const { rows } = await a.query(
      `SELECT appearance, nav_collapsed FROM api.user_preferences`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ appearance: 'system', nav_collapsed: true })
  })

  it('rejects an unknown appearance value', async () => {
    const a = await asUser(A)
    await expect(
      a.query(`SELECT api.set_user_preference('midnight', false)`),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('isolates each user to their own row', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_user_preference('dark', false)`)
    const b = await asUser(B)
    const empty = await b.query(
      `SELECT count(*)::int AS n FROM api.user_preferences`,
    )
    expect(empty.rows[0].n).toBe(0)

    await b.query(`SELECT api.set_user_preference('system', true)`)
    const bRow = await b.query(
      `SELECT appearance, nav_collapsed FROM api.user_preferences`,
    )
    expect(bRow.rows).toHaveLength(1)
    expect(bRow.rows[0]).toMatchObject({
      appearance: 'system',
      nav_collapsed: true,
    })

    const aRow = await a.query(
      `SELECT appearance, nav_collapsed FROM api.user_preferences`,
    )
    expect(aRow.rows).toHaveLength(1)
    expect(aRow.rows[0]).toMatchObject({
      appearance: 'dark',
      nav_collapsed: false,
    })
  })

  it('denies a direct insert', async () => {
    const a = await asUser(A)
    await expect(
      a.query(
        `INSERT INTO api.user_preferences (user_id, appearance) VALUES ('${A}', 'dark')`,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
