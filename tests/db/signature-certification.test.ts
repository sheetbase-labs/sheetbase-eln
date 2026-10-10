import { drizzle } from 'drizzle-orm/node-postgres'
import { createHmac, createHash } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth, handleAuthRequest } from '#/lib/auth'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import type { SignatureStepUpDeps } from '#/lib/signature-step-up.server'
import { expectDenied, migratorUrl, prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000220a'
const OTHER_WS = '00000000-0000-4000-8000-00000000220b'
const PASSWORD = 'fixture-signing-password-2026'
const ORIGIN = 'https://sheetbase.test'
let migrator: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []
let sequence = 0

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
    ($1,'certification','Certification'),($2,'other-certification','Other')`,
    [WS, OTHER_WS],
  )
  await addUser('verifier', 'owner')
  await addUser('admin-verifier', 'admin')
})
afterAll(async () => {
  vi.unstubAllEnvs()
  for (const client of clients) await client.end()
  await database.$client.end()
  await migrator.end()
})

async function addUser(id: string, role = 'member', workspace = WS) {
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,$1,$2,true)`,
    [id, `${id}@sheetbase.test`],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3)`,
    [workspace, id, role],
  )
  await addSession(id)
}
async function addSession(id: string, sessionId = `session-${id}`) {
  await migrator.query(
    `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 hour')`,
    [sessionId, `token-${sessionId}`, id],
  )
}
function headers(id: string, sessionId = `session-${id}`) {
  const token = `token-${sessionId}`
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Test secret required')
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: ORIGIN,
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}
async function actor(id: string, workspace = WS, sessionId = `session-${id}`) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({
      sub: id,
      workspace_id: workspace,
      session_id: sessionId,
      role: 'authenticated',
    }),
  ])
  return client
}
async function fixture(
  options: { credential?: boolean; verified?: boolean; role?: string } = {},
) {
  const id = `certification-${++sequence}`
  await addUser(id, options.role)
  const client = await actor(id)
  if (options.credential)
    await authentication.api.setPassword({
      headers: headers(id),
      body: { newPassword: PASSWORD },
    })
  if (options.verified) await verify(id, client)
  return { id, client }
}
async function verify(id: string, client: Client, verifier = 'verifier') {
  await client.query('SELECT api.request_signature_identity_verification()')
  const admin = await actor(verifier)
  await admin.query('SELECT api.verify_signature_identity($1,$2)', [
    id,
    `${id}@sheetbase.test`,
  ])
}
function step(
  id: string,
  input: object,
  deps: Partial<SignatureStepUpDeps> = {},
  sessionId = `session-${id}`,
) {
  return handleSignatureStepUp(
    new Request(`${ORIGIN}/api/signatures/step-up`, {
      method: 'POST',
      headers: headers(id, sessionId),
      body: JSON.stringify({ workspaceId: WS, ...input }),
    }),
    { database, authentication, ...deps },
  )
}
async function token(id: string, purpose = 'certify') {
  const response = await step(id, { purpose, password: PASSWORD })
  expect(response.status).toBe(200)
  const result: { token: string; authMethod: string; expiresAt: string } =
    await response.json()
  expect(result.authMethod).toBe('password')
  expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(
    290_000,
  )
  expect(new Date(result.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
    300_000,
  )
  return result.token
}
async function certify(id: string, client: Client) {
  await client.query('SELECT api.certify_signature($1,1,$2)', [
    WS,
    await token(id),
  ])
}
function mailbox() {
  const messages: { to: string; subject: string; body: string }[] = []
  return {
    messages,
    transport: {
      send: async (message: { to: string; subject: string; body: string }) => {
        messages.push(message)
      },
    },
  }
}
async function deliveredSecret(
  id: string,
  purpose: 'enroll-request' | 'recover-request',
  mail = mailbox(),
) {
  const response = await step(id, { purpose }, { transport: mail.transport })
  expect(response.status).toBe(200)
  const result: object = await response.json()
  expect(result).toMatchObject({ delivered: true })
  expect(result).not.toHaveProperty('secret')
  const message = mail.messages.at(-1)
  expect(message?.to).toBe(`${id}@sheetbase.test`)
  const secret = message?.body.split('\n\n')[1]
  if (!secret) throw new Error('Missing delivered secret')
  return { secret, mail }
}

describe('REV-03 independent certification and password evidence', () => {
  it('denies old self-certification, bootstrap self-verification, and session-only enrollment', async () => {
    const { id, client } = await fixture({ role: 'owner' })
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1)', [WS]),
      '42501',
    )
    await client.query('SELECT api.request_signature_identity_verification()')
    await expectDenied(
      client.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '42501',
    )
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(403)
    expect(
      (await step(id, { purpose: 'certify', password: PASSWORD })).status,
    ).toBe(403)
  })

  it('requires a different active owner/admin, requested live session and exact independently verified email', async () => {
    const { id, client } = await fixture()
    const other = await fixture()
    await client.query('SELECT api.request_signature_identity_verification()')
    await expectDenied(
      other.client.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '42501',
    )
    const admin = await actor('admin-verifier')
    await expectDenied(
      admin.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        'different@sheetbase.test',
      ]),
      '22023',
    )
    await migrator.query(
      'UPDATE api.workspace_memberships SET suspended_at=now() WHERE user_id=$1',
      ['admin-verifier'],
    )
    await expectDenied(
      admin.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '42501',
    )
    await migrator.query(
      'UPDATE api.workspace_memberships SET suspended_at=NULL WHERE user_id=$1',
      ['admin-verifier'],
    )
    await admin.query('SELECT api.verify_signature_identity($1,$2)', [
      id,
      `${id}@sheetbase.test`,
    ])
    const row = await client.query(
      'SELECT identity_verified_by,verified_email,certified_at FROM api.workspace_signature_certifications() WHERE user_id=$1',
      [id],
    )
    expect(row.rows[0]).toMatchObject({
      identity_verified_by: 'admin-verifier',
      verified_email: `${id}@sheetbase.test`,
      certified_at: null,
    })
  })

  it('certifies, withdraws, and recertifies only with fresh single-use password evidence', async () => {
    const { id, client } = await fixture({ credential: true, verified: true })
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1)', [WS]),
      'SB002',
    )
    const proof = await token(id)
    await expectDenied(
      client.query('SELECT api.certify_signature($1,2,$2)', [WS, proof]),
      '22023',
    )
    await client.query('SELECT api.certify_signature($1,1,$2)', [WS, proof])
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1,$2)', [WS, proof]),
      'SB002',
    )
    const evidence = await client.query(
      'SELECT auth_method,certified_session_id FROM api.user_signature_certifications WHERE user_id=$1',
      [id],
    )
    expect(evidence.rows[0]).toEqual({
      auth_method: 'password',
      certified_session_id: `session-${id}`,
    })
    const outstanding = await token(id, 'practice')
    await client.query('SELECT api.withdraw_signature_certification($1)', [WS])
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [outstanding]),
      '42501',
    )
    await certify(id, client)
    await client.query('SELECT api.practice_signature($1)', [
      await token(id, 'practice'),
    ])
  })

  it('binds password tokens to user, session, workspace, purpose, expiry and current verified email', async () => {
    const { id, client } = await fixture({ credential: true, verified: true })
    const other = await fixture({ credential: true, verified: true })
    const proof = await token(id)
    await expectDenied(
      other.client.query('SELECT api.certify_signature($1,1,$2)', [WS, proof]),
      'SB002',
    )
    await addSession(id, `second-${id}`)
    const second = await actor(id, WS, `second-${id}`)
    await expectDenied(
      second.query('SELECT api.certify_signature($1,1,$2)', [WS, proof]),
      'SB002',
    )
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1,$2)', [OTHER_WS, proof]),
      '42501',
    )
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [proof]),
      '42501',
    )
    await migrator.query(
      'UPDATE internal.signature_grants SET expires_at=clock_timestamp() WHERE token_hash=$1',
      [createHash('sha256').update(proof).digest('hex')],
    )
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1,$2)', [WS, proof]),
      'SB002',
    )
    const next = await token(id)
    await migrator.query('UPDATE internal."user" SET email=$1 WHERE id=$2', [
      'changed@sheetbase.test',
      id,
    ])
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1,$2)', [WS, next]),
      '42501',
    )
  })

  it('enrolls through native Better Auth only after OOB delivery, invalidates reissues and prevents overwrite', async () => {
    const { id, client } = await fixture({ verified: true })
    const first = await deliveredSecret(id, 'enroll-request')
    const second = await deliveredSecret(id, 'enroll-request', first.mail)
    expect(second.secret).not.toBe(first.secret)
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: first.secret,
          password: PASSWORD,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: second.secret,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200)
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: PASSWORD },
    })
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: second.secret,
          password: 'overwrite-password-2026',
        })
      ).status,
    ).toBe(403)
    await verify(id, client)
    expect(
      (
        await step(
          id,
          { purpose: 'enroll-request' },
          { transport: first.mail.transport },
        )
      ).status,
    ).toBe(409)
    const stored = await migrator.query(
      'SELECT token_hash FROM internal.signature_grants WHERE user_id=$1',
      [id],
    )
    expect(JSON.stringify(stored.rows)).not.toContain(first.secret)
    expect(JSON.stringify(stored.rows)).not.toContain(second.secret)
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int n FROM internal.email_deliveries WHERE user_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(0)
  })

  it('fails closed without SMTP or on send failure, never restores the previously issued secret', async () => {
    const { id } = await fixture({ verified: true })
    vi.stubEnv('SMTP_HOST', '')
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(503)
    vi.unstubAllEnvs()
    const first = await deliveredSecret(id, 'enroll-request')
    const failed = await step(
      id,
      { purpose: 'enroll-request' },
      {
        transport: {
          send: async () => {
            throw new Error('local delivery failed')
          },
        },
      },
    )
    expect(failed.status).toBe(503)
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: first.secret,
          password: PASSWORD,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int n FROM internal.signature_grants WHERE user_id=$1 AND consumed_at IS NULL`,
          [id],
        )
      ).rows[0].n,
    ).toBe(0)
  })

  it('spends authorization before a failed credential operation and requires independent reauthorization', async () => {
    const { id, client } = await fixture({ verified: true })
    const first = await deliveredSecret(id, 'enroll-request')
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: first.secret,
          password: 'short',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: first.secret,
          password: PASSWORD,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await step(
          id,
          { purpose: 'enroll-request' },
          { transport: first.mail.transport },
        )
      ).status,
    ).toBe(403)
    await verify(id, client)
    const next = await deliveredSecret(id, 'enroll-request')
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: next.secret,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200)
  })

  it('recovers via trusted Better Auth reset APIs, revokes signing grants and sessions, and does not restore a failed authorization', async () => {
    const { id, client } = await fixture({ credential: true, verified: true })
    await certify(id, client)
    const oldGrant = await token(id, 'practice')
    await verify(id, client)
    const first = await deliveredSecret(id, 'recover-request')
    expect(
      (
        await step(id, {
          purpose: 'recover',
          secret: first.secret,
          password: 'short',
        })
      ).status,
    ).toBe(400)
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: PASSWORD },
    })
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [oldGrant]),
      '42501',
    )
    expect(
      (
        await step(id, {
          purpose: 'recover',
          secret: first.secret,
          password: 'recovered-password-2026',
        })
      ).status,
    ).toBe(403)
    await verify(id, client)
    const next = await deliveredSecret(id, 'recover-request')
    const recovered = await step(id, {
      purpose: 'recover',
      secret: next.secret,
      password: 'recovered-password-2026',
    })
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toEqual({
      completed: true,
      signInAgain: true,
    })
    expect(
      await authentication.api.getSession({ headers: headers(id) }),
    ).toBeNull()
    await addSession(id, `after-recovery-${id}`)
    await authentication.api.verifyPassword({
      headers: headers(id, `after-recovery-${id}`),
      body: { password: 'recovered-password-2026' },
    })
    await expect(
      authentication.api.verifyPassword({
        headers: headers(id, `after-recovery-${id}`),
        body: { password: PASSWORD },
      }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    expect(
      (
        await migrator.query(
          `SELECT count(*)::int n FROM internal.signature_grants WHERE user_id=$1 AND consumed_at IS NULL`,
          [id],
        )
      ).rows[0].n,
    ).toBe(0)
  })

  it('commits three concurrent failures as a durable user-wide 15-minute lockout and closes HTTP verification bypasses', async () => {
    const { id, client } = await fixture({ credential: true, verified: true })
    const outstanding = await token(id)
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        step(id, { purpose: 'certify', password: 'incorrect-password-2026' }),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([401, 401, 423])
    const state = await migrator.query(
      `SELECT failures,locked_until>now()+interval '14 minutes 59 seconds' AS full_lock FROM internal.signature_password_attempts WHERE user_id=$1`,
      [id],
    )
    expect(state.rows[0]).toEqual({ failures: 3, full_lock: true })
    const newInstance = createAuth(database)
    expect(
      (
        await step(
          id,
          { purpose: 'certify', password: PASSWORD },
          { authentication: newInstance },
        )
      ).status,
    ).toBe(423)
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1,$2)', [WS, outstanding]),
      'SB002',
    )
    for (let i = 0; i < 4; i++)
      expect(
        (
          await handleAuthRequest(
            new Request(`${ORIGIN}/api/auth/verify-password`, {
              method: 'POST',
              headers: headers(id),
              body: JSON.stringify({ password: PASSWORD }),
            }),
            authentication,
          )
        ).status,
      ).toBe(404)
    expect(
      (
        await migrator.query(
          'SELECT failures FROM internal.signature_password_attempts WHERE user_id=$1',
          [id],
        )
      ).rows[0].failures,
    ).toBe(3)
    await migrator.query(
      `UPDATE internal.signature_password_attempts SET locked_until=now()-interval '1 microsecond' WHERE user_id=$1`,
      [id],
    )
    await token(id)
    expect(
      (
        await migrator.query(
          'SELECT failures,locked_until FROM internal.signature_password_attempts WHERE user_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ failures: 0, locked_until: null })
  })

  it('resets consecutive failures on genuine password success, and practice consumes evidence without creating a real signature', async () => {
    const { id, client } = await fixture({ credential: true, verified: true })
    expect(
      (await step(id, { purpose: 'certify', password: 'bad-password' })).status,
    ).toBe(401)
    expect(
      (await step(id, { purpose: 'certify', password: 'bad-password' })).status,
    ).toBe(401)
    await certify(id, client)
    const proof = await token(id, 'practice')
    const practice = await client.query(
      'SELECT api.practice_signature($1) AS result',
      [proof],
    )
    expect(practice.rows[0].result).toMatchObject({
      practice: true,
      authMethod: 'password',
    })
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [proof]),
      'SB002',
    )
    expect(
      (
        await migrator.query(
          'SELECT count(*)::int n FROM api.signatures WHERE signer_user_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await migrator.query(
          `SELECT event FROM internal.signature_authentication_events WHERE user_id=$1 ORDER BY occurred_at`,
          [id],
        )
      ).rows.map((r) => r.event),
    ).toContain('practice-signature')
  })

  it('keeps workspace boundaries, token minting and failure counters outside request-role reach', async () => {
    const { id, client } = await fixture()
    await expectDenied(
      client.query('SELECT api.certify_signature($1,1)', [OTHER_WS]),
      '42501',
    )
    await expectDenied(
      client.query('SELECT * FROM internal.signature_grants'),
      '42501',
    )
    await expectDenied(
      client.query(
        'UPDATE internal.signature_password_attempts SET failures=0',
      ),
      '42501',
    )
    await expectDenied(
      client.query(
        `UPDATE api.user_signature_certifications SET identity_verified_by=$1`,
        [id],
      ),
      '42501',
    )
    expect(
      (await step(id, { purpose: 'provider', provider: 'github' })).status,
    ).toBe(400)
    const forged = new Request(`${ORIGIN}/api/signatures/step-up`, {
      method: 'POST',
      headers: {
        ...Object.fromEntries(headers(id)),
        origin: 'https://evil.test',
      },
      body: JSON.stringify({
        purpose: 'certify',
        workspaceId: WS,
        password: PASSWORD,
      }),
    })
    expect(
      (await handleSignatureStepUp(forged, { database, authentication }))
        .status,
    ).toBe(403)
  })
})
