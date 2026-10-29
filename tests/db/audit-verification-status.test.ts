/**
 * Every member of a workspace can read when its audit trail and signed records
 * were last found intact. The nightly check writes the result; this only reads it.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase, setActorJwt } from './helpers'

const WS = '00000000-0000-4000-8000-00000000cf10'
const OTHER_WS = '00000000-0000-4000-8000-00000000cf11'
const MEMBER = 'avs-member'
const OUTSIDER = 'avs-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [MEMBER, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'avs','Status'),($2,'avs-other','Other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values($1,$2,'member'),($3,$4,'member')`,
    [WS, MEMBER, OTHER_WS, OUTSIDER],
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspace: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspace)
  return client
}

describe('api.audit_verification_status', () => {
  it('says nothing until a check has run, then reports its result to a member', async () => {
    const member = await actor(MEMBER, WS)
    const before = await member.query<{ status: unknown }>(
      'select api.audit_verification_status() as status',
    )
    expect(before.rows[0].status).toBeNull()

    // The scheduled runner connects as the function owner, with no user session.
    await migrator.query('select api.run_audit_verification($1)', [WS])

    const after = await member.query<{
      status: {
        ok: boolean
        checkedAt: string
        entriesChecked: number
        signaturesChecked: number
      }
    }>('select api.audit_verification_status() as status')
    const status = after.rows[0].status
    expect(status.ok).toBe(true)
    expect(status.signaturesChecked).toBe(0)
    expect(Date.parse(status.checkedAt)).not.toBeNaN()
  })

  it('shows a workspace only its own result', async () => {
    await migrator.query('select api.run_audit_verification($1)', [OTHER_WS])
    const outsider = await actor(OUTSIDER, OTHER_WS)
    const own = await outsider.query<{ status: { entriesChecked: number } }>(
      'select api.audit_verification_status() as status',
    )
    expect(own.rows[0].status).not.toBeNull()
    // The caller's workspace is the only one it can ask about.
    const stranger = await actor('avs-nobody', WS)
    await expectDenied(
      stranger.query('select api.audit_verification_status()'),
      '42501',
    )
  })
})
