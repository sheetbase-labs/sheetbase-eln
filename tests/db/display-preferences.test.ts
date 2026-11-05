/**
 * How a person reads the clock, and whether the layout bar stays on a single
 * pane, are kept in their own preferences row. `api.set_display_preferences` is
 * the only writer: it writes the caller's row, refuses anything but a 12 or 24
 * hour clock, changes only what it is given and keeps the rest of the row.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const A = 'display-a'
const B = 'display-b'
const WS = '00000000-0000-4000-8000-0000000003b1'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${A}', 'Display A', 'display-a@sheetbase.test', true),
      ('${B}', 'Display B', 'display-b@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'display-ws', 'Display WS')
     ON CONFLICT (id) DO NOTHING`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${A}', 'owner'), ('${WS}', '${B}', 'scientist')
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
      workspace_id: WS,
      session_id: 'display-session',
    }),
  ])
  return client
}

async function stored(client: Client) {
  const { rows } = await client.query<{ preferences: unknown }>(
    `SELECT preferences FROM api.user_preferences`,
  )
  return rows[0]?.preferences ?? null
}

describe('api.set_display_preferences', () => {
  it('remembers the clock and the layout bar on the caller’s own row', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_display_preferences('12h', NULL)`)
    expect(await stored(a)).toEqual({ clock: '12h' })
    await a.query(`SELECT api.set_display_preferences(NULL, true)`)
    expect(await stored(a)).toEqual({ clock: '12h', alwaysShowLayout: true })
  })

  it('keeps what it was not given, and other people’s rows alone', async () => {
    const a = await asUser(A)
    await a.query(`SELECT api.set_display_preferences('24h', NULL)`)
    expect(await stored(a)).toEqual({ clock: '24h', alwaysShowLayout: true })
    const b = await asUser(B)
    expect(await stored(b)).toBeNull()
  })

  it('refuses a clock that is not 12h or 24h', async () => {
    const a = await asUser(A)
    await expect(
      a.query(`SELECT api.set_display_preferences('am', NULL)`),
    ).rejects.toThrow(/12h or 24h/)
  })

  it('needs a signed-in person', async () => {
    const anon = await asRole('authenticator')
    clients.push(anon)
    await anon.query('SET ROLE anon')
    await expect(
      anon.query(`SELECT api.set_display_preferences('12h', NULL)`),
    ).rejects.toThrow()
  })
})
