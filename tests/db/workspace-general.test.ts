/**
 * SET-01.1 — workspace general settings are admin-only.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000150a'
const ADMIN = 'wsg-admin'
const MEMBER = 'wsg-member'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${ADMIN}', 'WSG Admin', 'wsg-admin@sheetbase.test', true),
      ('${MEMBER}', 'WSG Member', 'wsg-member@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES ('${WS}', 'wsg', 'WSG')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${ADMIN}', 'admin'),
      ('${WS}', '${MEMBER}', 'member')`,
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
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

describe('api.update_workspace_general', () => {
  it('updates general settings for an admin', async () => {
    const admin = await asAuthenticated(ADMIN)
    const { rows } = await admin.query<{
      site: string
      timezone: string
      number_format: string
    }>(
      `SELECT * FROM api.update_workspace_general($1, 'Cambridge', 'Europe/London', 'd MMM yyyy', 'scientific')`,
      [WS],
    )
    expect(rows[0]?.site).toBe('Cambridge')
    expect(rows[0]?.number_format).toBe('scientific')
  })

  it('refuses a non-admin and an unknown number format', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(
        `SELECT api.update_workspace_general($1, 'X', NULL, NULL, NULL)`,
        [WS],
      ),
      '42501',
    )

    const admin = await asAuthenticated(ADMIN)
    await expect(
      admin.query(
        `SELECT api.update_workspace_general($1, NULL, NULL, NULL, 'roman')`,
        [WS],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })
})

describe('api.update_workspace_id_prefixes', () => {
  it('sets the prefixes for an admin and refuses a bad one', async () => {
    const admin = await asAuthenticated(ADMIN)
    const { rows } = await admin.query<{ id_prefixes: Record<string, string> }>(
      `SELECT * FROM api.update_workspace_id_prefixes($1, '{"experiment":"EXP","sample":"SMP"}'::jsonb)`,
      [WS],
    )
    expect(rows[0]?.id_prefixes).toEqual({ experiment: 'EXP', sample: 'SMP' })

    await expect(
      admin.query(
        `SELECT api.update_workspace_id_prefixes($1, '{"experiment":"exp"}'::jsonb)`,
        [WS],
      ),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('refuses a non-admin', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(`SELECT api.update_workspace_id_prefixes($1, '{}'::jsonb)`, [
        WS,
      ]),
      '42501',
    )
  })
})

describe('api.update_workspace_name', () => {
  it('renames the workspace for an admin', async () => {
    const admin = await asAuthenticated(ADMIN)
    const { rows } = await admin.query<{ name: string }>(
      `SELECT * FROM api.update_workspace_name($1, 'Process Development')`,
      [WS],
    )
    expect(rows[0]?.name).toBe('Process Development')
  })

  it('refuses a non-admin and an invalid name', async () => {
    const member = await asAuthenticated(MEMBER)
    await expectDenied(
      member.query(`SELECT api.update_workspace_name($1, 'Nope')`, [WS]),
      '42501',
    )
    const admin = await asAuthenticated(ADMIN)
    await expect(
      admin.query(`SELECT api.update_workspace_name($1, '   ')`, [WS]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
