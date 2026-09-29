/**
 * UI port — project membership read and management.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000210a'
const OTHER_WS = '00000000-0000-4000-8000-00000000210b'
const PROJECT = '00000000-0000-4000-8000-00000000210c'
const LEAD = 'pm-lead'
const MEMBER = 'pm-member'
const OUTSIDER = 'pm-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${LEAD}', 'Pat Lead', 'pm-lead@sheetbase.test', true),
      ('${MEMBER}', 'Sam Member', 'pm-member@sheetbase.test', true),
      ('${OUTSIDER}', 'Olive Outsider', 'pm-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'pm', 'PM'), ('${OTHER_WS}', 'pm-other', 'PM other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${LEAD}', 'scientist'),
      ('${WS}', '${MEMBER}', 'member'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title, lead_user_id) VALUES
      ('${PROJECT}', '${WS}', 'pm', 'Members project', '${LEAD}')`,
  )
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

describe('project members', () => {
  it('lists workspace member names', async () => {
    const lead = await asAuthenticated(LEAD, WS)
    const { rows } = await lead.query<{ name: string }>(
      `SELECT * FROM api.workspace_members_list()`,
    )
    expect(rows.map((r) => r.name).sort()).toEqual(['Pat Lead', 'Sam Member'])
  })

  it('lets the lead add, change and remove a member', async () => {
    const lead = await asAuthenticated(LEAD, WS)
    await lead.query(`SELECT * FROM api.set_project_member($1, $2, 'viewer')`, [
      PROJECT,
      MEMBER,
    ])
    const afterAdd = await lead.query<{
      user_id: string
      name: string
      access_level: string
      is_lead: boolean
    }>(`SELECT * FROM api.project_members($1)`, [PROJECT])
    expect(afterAdd.rows.find((r) => r.user_id === MEMBER)?.name).toBe(
      'Sam Member',
    )
    expect(afterAdd.rows.find((r) => r.user_id === MEMBER)?.access_level).toBe(
      'viewer',
    )
    expect(afterAdd.rows.find((r) => r.user_id === LEAD)?.is_lead).toBe(true)

    await lead.query(`SELECT * FROM api.set_project_member($1, $2, 'editor')`, [
      PROJECT,
      MEMBER,
    ])
    const afterChange = await lead.query<{ access_level: string }>(
      `SELECT access_level FROM api.project_members($1) WHERE user_id = $2`,
      [PROJECT, MEMBER],
    )
    expect(afterChange.rows[0]?.access_level).toBe('editor')

    await lead.query(`SELECT api.remove_project_member($1, $2)`, [
      PROJECT,
      MEMBER,
    ])
    const afterRemove = await lead.query(
      `SELECT * FROM api.project_members($1)`,
      [PROJECT],
    )
    expect(afterRemove.rows.find((r) => r.user_id === MEMBER)).toBeUndefined()
  })

  it('denies a non-lead member and an outsider', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    await expectDenied(
      member.query(`SELECT * FROM api.set_project_member($1, $2, 'viewer')`, [
        PROJECT,
        MEMBER,
      ]),
      '42501',
    )
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expectDenied(
      outsider.query(`SELECT * FROM api.set_project_member($1, $2, 'viewer')`, [
        PROJECT,
        OUTSIDER,
      ]),
      '42501',
    )
    const seen = await outsider.query(`SELECT * FROM api.project_members($1)`, [
      PROJECT,
    ])
    expect(seen.rows).toEqual([])
  })

  it('rejects an unknown access level', async () => {
    const lead = await asAuthenticated(LEAD, WS)
    await expect(
      lead.query(`SELECT * FROM api.set_project_member($1, $2, 'superuser')`, [
        PROJECT,
        MEMBER,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
