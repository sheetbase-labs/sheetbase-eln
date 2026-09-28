/**
 * UI port — electronic signature certification (SIGN-003).
 *
 * A person certifies their signature per workspace; certifying again updates the
 * statement version and withdrawing revokes it. Only workspace members can act,
 * and only for their own workspace.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000220a'
const OTHER_WS = '00000000-0000-4000-8000-00000000220b'
const MEMBER = 'sig-member'
const SECOND = 'sig-second'
const OUTSIDER = 'sig-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user" (id, name, email, "emailVerified") VALUES
      ('${MEMBER}', 'Mo Member', 'sig-member@sheetbase.test', true),
      ('${SECOND}', 'Sam Second', 'sig-second@sheetbase.test', true),
      ('${OUTSIDER}', 'Olive Outsider', 'sig-outsider@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'sig', 'Signature workspace'),
      ('${OTHER_WS}', 'sig-other', 'Other workspace')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${MEMBER}', 'scientist'),
      ('${WS}', '${SECOND}', 'member'),
      ('${OTHER_WS}', '${OUTSIDER}', 'member')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function asAuthenticated(userId: string, workspaceId: string): Promise<Client> {
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

describe('signature certification', () => {
  it('certifies, re-certifies and withdraws for the caller', async () => {
    const member = await asAuthenticated(MEMBER, WS)

    const first = await member.query<{
      statement_version: number
      revoked_at: Date | null
    }>(`SELECT * FROM api.certify_signature($1, 1)`, [WS])
    expect(first.rows[0]?.statement_version).toBe(1)
    expect(first.rows[0]?.revoked_at).toBeNull()

    // Certifying again updates the agreed statement version in place.
    const second = await member.query<{
      statement_version: number
      revoked_at: Date | null
    }>(`SELECT * FROM api.certify_signature($1, 2)`, [WS])
    expect(second.rows[0]?.statement_version).toBe(2)
    expect(second.rows[0]?.revoked_at).toBeNull()

    const listed = await member.query<{
      user_id: string
      statement_version: number | null
      revoked_at: Date | null
    }>(`SELECT * FROM api.workspace_signature_certifications()`)
    const mine = listed.rows.find((r) => r.user_id === MEMBER)
    expect(mine?.statement_version).toBe(2)
    expect(mine?.revoked_at).toBeNull()
    // A member who has not certified is listed with no certification.
    expect(listed.rows.find((r) => r.user_id === SECOND)?.statement_version).toBeNull()

    await member.query(`SELECT * FROM api.withdraw_signature_certification($1)`, [
      WS,
    ])
    const afterWithdraw = await member.query<{ revoked_at: Date | null }>(
      `SELECT * FROM api.workspace_signature_certifications() WHERE user_id = $1`,
      [MEMBER],
    )
    expect(afterWithdraw.rows[0]?.revoked_at).not.toBeNull()

    // Certifying after a withdrawal clears the revocation.
    const again = await member.query<{ revoked_at: Date | null }>(
      `SELECT * FROM api.certify_signature($1, 2)`,
      [WS],
    )
    expect(again.rows[0]?.revoked_at).toBeNull()
  })

  it('denies an outsider and keeps workspaces separate', async () => {
    const outsider = await asAuthenticated(OUTSIDER, OTHER_WS)
    await expectDenied(
      outsider.query(`SELECT * FROM api.certify_signature($1, 1)`, [WS]),
      '42501',
    )

    // Certifying their own workspace works and is not visible in the other.
    await outsider.query(`SELECT * FROM api.certify_signature($1, 1)`, [OTHER_WS])
    const otherList = await outsider.query<{ user_id: string }>(
      `SELECT * FROM api.workspace_signature_certifications()`,
    )
    expect(otherList.rows.map((r) => r.user_id)).toEqual([OUTSIDER])

    const member = await asAuthenticated(MEMBER, WS)
    const wsList = await member.query<{ user_id: string }>(
      `SELECT * FROM api.workspace_signature_certifications()`,
    )
    expect(wsList.rows.map((r) => r.user_id).sort()).toEqual([
      MEMBER,
      SECOND,
    ])
  })

  it('rejects an invalid statement version and a missing certification', async () => {
    const member = await asAuthenticated(MEMBER, WS)
    await expect(
      member.query(`SELECT * FROM api.certify_signature($1, 0)`, [WS]),
    ).rejects.toMatchObject({ code: '22023' })

    const second = await asAuthenticated(SECOND, WS)
    await expect(
      second.query(`SELECT * FROM api.withdraw_signature_certification($1)`, [
        WS,
      ]),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
