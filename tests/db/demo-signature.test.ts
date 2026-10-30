import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000230a'
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let sequence = 0

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'demo-signature','Demo signature')`,
    [WS],
  )
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
     ('verifier','Verifier','verifier@sheetbase.test',true)`,
  )
})
afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

/** A certified signer with a session, as the seed or a real sign-in would leave them. */
async function signer(options: {
  sessionId: string
  method: 'demo' | 'password'
}) {
  const id = `signer-${++sequence}`
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,$1,$2,true)`,
    [id, `${id}@sheetbase.test`],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'member')`,
    [WS, id],
  )
  const sessionId = `${options.sessionId}-${id}`
  await migrator.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 hour')`,
    [sessionId, `token-${sessionId}`, id],
  )
  await migrator.query(
    `INSERT INTO api.user_signature_certifications
     (workspace_id,user_id,statement_version,certified_at,identity_verified_by,identity_verified_at,verified_email,auth_method)
     VALUES($1,$2,1,now(),'verifier',now(),$3,$4)`,
    [WS, id, `${id}@sheetbase.test`, options.method],
  )
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: id,
      workspace_id: WS,
      session_id: sessionId,
      role: 'authenticated',
    }),
  ])
  return { id, sessionId, client }
}

async function grant(
  who: { id: string; sessionId: string },
  authMethod: 'demo' | 'password',
) {
  const token = `grant-${++sequence}-${'x'.repeat(30)}`
  await migrator.query(
    `INSERT INTO internal.signature_grants
     (token_hash,user_id,session_id,workspace_id,purpose,auth_method,expires_at)
     VALUES($1,$2,$3,$4,'practice',$5,now()+interval '5 minutes')`,
    [
      createHash('sha256').update(token).digest('hex'),
      who.id,
      who.sessionId,
      WS,
      authMethod,
    ],
  )
  return token
}

describe('demo signature (migration 0046)', () => {
  it('is accepted in a sign-in-free demo session for a demo-certified signer', async () => {
    const who = await signer({
      sessionId: 'dev-auth-free-session',
      method: 'demo',
    })
    const token = await grant(who, 'demo')
    const result = await who.client.query(
      'SELECT api.practice_signature($1) AS result',
      [token],
    )
    expect(result.rows[0].result.practice).toBe(true)
  })

  it('is refused in a real sign-in session, whoever holds the grant', async () => {
    const who = await signer({ sessionId: 'real-session', method: 'demo' })
    const token = await grant(who, 'demo')
    await expect(
      who.client.query('SELECT api.practice_signature($1)', [token]),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('does not let a demo grant stand in for a password on a password-certified signer', async () => {
    const who = await signer({ sessionId: 'real-session', method: 'password' })
    const token = await grant(who, 'demo')
    await expect(
      who.client.query('SELECT api.practice_signature($1)', [token]),
    ).rejects.toMatchObject({ code: 'SB002' })
  })

  it('does not let a password grant pass for a demo-certified signer', async () => {
    const who = await signer({
      sessionId: 'dev-auth-free-session',
      method: 'demo',
    })
    const token = await grant(who, 'password')
    await expect(
      who.client.query('SELECT api.practice_signature($1)', [token]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('records only known confirmation methods on a grant', async () => {
    const who = await signer({ sessionId: 'real-session', method: 'password' })
    await expect(
      migrator.query(
        `INSERT INTO internal.signature_grants
         (token_hash,user_id,session_id,workspace_id,purpose,auth_method,expires_at)
         VALUES(repeat('a',64),$1,$2,$3,'practice','magic',now()+interval '5 minutes')`,
        [who.id, who.sessionId, WS],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
