/**
 * api.experiment_tab_counts groups the Experiments tab counts into one read and
 * respects row security.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-0000000024a0'
const OTHER_WS = '00000000-0000-4000-8000-0000000024a1'
const MEMBER = 'etc-member'
const COLLEAGUE = 'etc-colleague'
const OUTSIDER = 'etc-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

async function insertExperiment(
  workspaceId: string,
  index: number,
  status: string,
  createdBy: string,
  extra = '',
) {
  await migrator.query(
    `INSERT INTO api.records
       (workspace_id, kind, identifier, title, status, created_by_user_id${extra ? ', ' + extra.split('=')[0] : ''})
     VALUES ($1, 'experiment', $2, $2, $3, $4${extra ? ', ' + extra.split('=')[1] : ''})`,
    [workspaceId, `EXP-24${index}`, status, createdBy],
  )
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Member', 'etc-m@sheetbase.test', true),
      ('${COLLEAGUE}', 'Colleague', 'etc-c@sheetbase.test', true),
      ('${OUTSIDER}', 'Outsider', 'etc-o@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'etc', 'ETC'), ('${OTHER_WS}', 'etc-other', 'ETC other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${COLLEAGUE}', 'member'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await insertExperiment(WS, 1, 'in_progress', MEMBER)
  await insertExperiment(WS, 2, 'in_progress', COLLEAGUE)
  await insertExperiment(WS, 3, 'approved', MEMBER)
  await insertExperiment(WS, 4, 'approved', MEMBER, 'archived_at=now()')
  await insertExperiment(WS, 5, 'draft', COLLEAGUE, 'deleted_at=now()')
  await insertExperiment(OTHER_WS, 6, 'in_progress', OUTSIDER)
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(
  userId: string,
  workspaceId: string,
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

describe('api.experiment_tab_counts', () => {
  it('groups live and archived experiments by status, with the caller’s own', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    const { rows } = await member.query<{
      status: string
      archived: boolean
      total: number
      mine: number
    }>(
      `SELECT * FROM api.experiment_tab_counts($1) ORDER BY status, archived`,
      [MEMBER],
    )
    expect(rows).toEqual([
      { status: 'approved', archived: false, total: 1, mine: 1 },
      { status: 'approved', archived: true, total: 1, mine: 1 },
      { status: 'in_progress', archived: false, total: 2, mine: 1 },
    ])
  })

  it('never counts another workspace’s experiments', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    const { rows } = await outsider.query<{ total: number }>(
      `SELECT * FROM api.experiment_tab_counts($1)`,
      [OUTSIDER],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.total).toBe(1)
  })
})
