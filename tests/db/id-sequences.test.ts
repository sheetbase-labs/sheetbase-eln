/**
 * SET-01.2 — identifier assignment reads the workspace prefix and never
 * reuses a number.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000160a'
const OTHER_WS = '00000000-0000-4000-8000-00000000160b'
const OWNER = 'ids-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES ('${OWNER}', 'IDS Owner', 'ids@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'ids-ws', 'IDS WS'),
      ('${OTHER_WS}', 'ids-other', 'IDS other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, id_prefixes)
     VALUES ('${WS}', '${OWNER}', '{"experiment":"EXP","study":"STD"}'::jsonb)`,
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
      sub: OWNER,
      workspace_id: workspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

describe('api.next_record_identifier', () => {
  it('uses the per-kind prefix and increments without reuse', async () => {
    const owner = await asAuthenticated(WS)
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const { rows } = await owner.query<{ id: string }>(
        `SELECT api.next_record_identifier($1, 'experiment') AS id`,
        [WS],
      )
      ids.push(rows[0]!.id)
    }
    expect(ids).toEqual(['EXP-0001', 'EXP-0002', 'EXP-0003'])

    const study = await owner.query<{ id: string }>(
      `SELECT api.next_record_identifier($1, 'study') AS id`,
      [WS],
    )
    expect(study.rows[0]?.id).toBe('STD-0001')
  })

  it('refuses another workspace and an unknown kind', async () => {
    const other = await asAuthenticated(OTHER_WS)
    await expectDenied(
      other.query(`SELECT api.next_record_identifier($1, 'experiment')`, [WS]),
      'SB033',
    )

    const owner = await asAuthenticated(WS)
    await expect(
      owner.query(`SELECT api.next_record_identifier($1, 'Bad Kind')`, [WS]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
