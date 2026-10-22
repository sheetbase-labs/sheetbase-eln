import { execFileSync } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSecureContext,
  getCACertificates,
  setDefaultCACertificates,
  TLSSocket,
} from 'node:tls'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth } from '#/lib/auth'
import { createSmtpTransport } from '#/lib/email-delivery.server'
import { handleSignatureStepUp } from '#/lib/signature-step-up.server'
import {
  ensureSessions,
  expectDenied,
  migratorUrl,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const WS = '00000000-0000-4000-8000-00000000221a'
const ORIGIN = 'https://sheetbase.test'
const PASSWORD = 'smtp-enrollment-password-2026'
const RECOVERED_PASSWORD = 'smtp-recovered-password-2026'
const hash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex')
let migrator: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let authentication: ReturnType<typeof createAuth>
let asRole: Awaited<ReturnType<typeof prepareTestDatabase>>['asRole']
const clients: Client[] = []
let sequence = 0
let directory: string
let trusted: Awaited<ReturnType<typeof smtpReceiver>>
let untrusted: Awaited<ReturnType<typeof smtpReceiver>>
const originalCAs = getCACertificates('default')

// Fresh test-only keys never leave the temporary directory or enter git/logs.
function certificates(name: string) {
  const path = (suffix: string) => join(directory, `${name}-${suffix}`)
  const openssl = (...args: string[]) =>
    execFileSync('openssl', args, { stdio: 'ignore' })
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    `/CN=${name} disposable test CA`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    path('ca.key'),
    '-out',
    path('ca.pem'),
  )
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    path('server.key'),
    '-out',
    path('server.csr'),
  )
  writeFileSync(
    path('extensions'),
    'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
  )
  openssl(
    'x509',
    '-req',
    '-days',
    '1',
    '-in',
    path('server.csr'),
    '-CA',
    path('ca.pem'),
    '-CAkey',
    path('ca.key'),
    '-CAcreateserial',
    '-extfile',
    path('extensions'),
    '-out',
    path('server.pem'),
  )
  return {
    ca: readFileSync(path('ca.pem'), 'utf8'),
    key: readFileSync(path('server.key')),
    cert: readFileSync(path('server.pem')),
  }
}

/** Minimal loopback SMTP sink. It refuses message data before STARTTLS. */
async function smtpReceiver(pair: ReturnType<typeof certificates>) {
  const context = createSecureContext(pair)
  const sockets = new Set<Socket>()
  const messages: { recipient: string; data: string; tls: boolean }[] = []
  let plaintextMail = 0
  const server = createServer((plain) => {
    let socket: Socket = plain
    let encrypted = false
    let buffer = ''
    let data: string[] | null = null
    let recipient = ''
    function track(connection: Socket) {
      sockets.add(connection)
      connection.on('close', () => sockets.delete(connection))
      // A certificate refusal intentionally aborts the TLS handshake.
      connection.on('error', () => {})
      connection.setTimeout(5_000, () => connection.destroy())
    }
    track(plain)
    function receive(chunk: Buffer) {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') {
            messages.push({ recipient, data: data.join('\n'), tls: encrypted })
            data = null
            socket.write('250 Accepted\r\n')
          } else data.push(line.replace(/^\.\./, '.'))
        } else if (/^EHLO /i.test(line)) {
          socket.write(
            encrypted
              ? '250-localhost\r\n250 OK\r\n'
              : '250-localhost\r\n250 STARTTLS\r\n',
          )
        } else if (line === 'STARTTLS' && !encrypted) {
          plain.removeListener('data', receive)
          plain.write('220 Begin TLS\r\n')
          const secure = new TLSSocket(plain, {
            isServer: true,
            secureContext: context,
          })
          track(secure)
          socket = secure
          encrypted = true
          secure.on('data', receive)
        } else if (/^(MAIL|RCPT|DATA)\b/i.test(line) && !encrypted) {
          plaintextMail += 1
          socket.write('530 STARTTLS required\r\n')
        } else if (/^MAIL FROM:/i.test(line)) socket.write('250 OK\r\n')
        else if (/^RCPT TO:/i.test(line)) {
          recipient = line.slice(8).trim().replace(/^<|>$/g, '')
          socket.write('250 OK\r\n')
        } else if (line === 'DATA') {
          data = []
          socket.write('354 End with dot\r\n')
        } else if (line === 'QUIT') socket.end('221 Goodbye\r\n')
        else if (line === 'RSET') socket.write('250 OK\r\n')
        else socket.write('500 Unsupported command\r\n')
      }
    }
    plain.on('data', receive)
    plain.write('220 localhost disposable SMTP\r\n')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing SMTP port')
  return {
    messages,
    config: {
      host: '127.0.0.1',
      port: address.port,
      user: null,
      pass: null,
      from: 'Sheetbase <no-reply@sheetbase.test>',
    },
    plaintextMail: () => plaintextMail,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function configureSmtp(receiver = trusted) {
  vi.stubEnv('SMTP_HOST', receiver.config.host)
  vi.stubEnv('SMTP_PORT', String(receiver.config.port))
  vi.stubEnv('SMTP_FROM', receiver.config.from)
  vi.stubEnv('SMTP_USER', '')
  vi.stubEnv('SMTP_PASS', '')
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sheetbase-signing-smtp-'))
  const pair = certificates('trusted')
  trusted = await smtpReceiver(pair)
  untrusted = await smtpReceiver(certificates('untrusted'))
  // Vitest's isolated DB worker alone trusts this CA. No machine trust store,
  // NODE_TLS_REJECT_UNAUTHORIZED or production transport options are changed.
  setDefaultCACertificates([...originalCAs, pair.ca])
  ;({ migrator, asRole } = await prepareTestDatabase())
  database = drizzle(migratorUrl(), { schema })
  authentication = createAuth(database)
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES($1,'smtp-signing','SMTP signing')`,
    [WS],
  )
  await user('smtp-admin', 'admin')
})

afterAll(async () => {
  vi.unstubAllEnvs()
  setDefaultCACertificates(originalCAs)
  await trusted?.close()
  await untrusted?.close()
  for (const client of clients) await client.end()
  await database?.$client.end()
  await migrator?.end()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function user(id = `smtp-user-${++sequence}`, role = 'member') {
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES($1,$1,$2,true)`,
    [id, `${id}@sheetbase.test`],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3)`,
    [WS, id, role],
  )
  await ensureSessions(migrator, [id])
  return id
}

function headers(id: string, session = `session-${id}`) {
  const token = `token-${session}`
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Test auth secret required')
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return new Headers({
    origin: ORIGIN,
    'content-type': 'application/json',
    cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  })
}

async function actor(id: string, session = `session-${id}`) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await setActorJwt(client, id, WS, { session_id: session })
  return client
}

async function verify(id: string, session = `session-${id}`) {
  const target = await actor(id, session)
  await target.query('SELECT api.request_signature_identity_verification()')
  const admin = await actor('smtp-admin')
  await admin.query('SELECT api.verify_signature_identity($1,$2)', [
    id,
    `${id}@sheetbase.test`,
  ])
  return target
}

function step(id: string, input: object, session = `session-${id}`) {
  // No transport or authentication replacement: use configured production SMTP
  // and Better Auth against the disposable migrated PostgreSQL database.
  return handleSignatureStepUp(
    new Request(`${ORIGIN}/api/signatures/step-up`, {
      method: 'POST',
      headers: headers(id, session),
      body: JSON.stringify({ workspaceId: WS, ...input }),
    }),
    { database, authentication },
  )
}

async function delivered(id: string, purpose = 'enroll-request') {
  configureSmtp()
  const count = trusted.messages.length
  const response = await step(id, { purpose })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body).toEqual({ delivered: true, expiresAt: expect.any(String) })
  expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(290_000)
  expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000)
  expect(trusted.messages.length).toBe(count + 1)
  const message = trusted.messages[count]
  expect(message.recipient).toBe(`${id}@sheetbase.test`)
  expect(message.tls).toBe(true)
  const separator = message.data.indexOf('\n\n')
  const mimeHeaders = message.data.slice(0, separator)
  const encoded = message.data.slice(separator + 2)
  const text = /Content-Transfer-Encoding: base64/i.test(mimeHeaders)
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : encoded
        .replace(/=\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
  const secret = text.match(/^[A-Za-z0-9_-]{43}\r?$/m)?.[0].trim()
  if (!secret) throw new Error('SMTP message missing one-use secret')
  expect(JSON.stringify(body).includes(secret)).toBe(false)
  const stored = await migrator.query(
    `SELECT token_hash,expires_at>clock_timestamp() AS live FROM internal.signature_grants
     WHERE user_id=$1 AND consumed_at IS NULL`,
    [id],
  )
  expect(stored.rows).toEqual([{ token_hash: hash(secret), live: true }])
  return secret
}

async function noLiveGrants(id: string) {
  const result = await migrator.query(
    `SELECT count(*)::int n FROM internal.signature_grants WHERE user_id=$1 AND consumed_at IS NULL`,
    [id],
  )
  expect(result.rows[0].n).toBe(0)
}

async function enroll(id: string) {
  await verify(id)
  const secret = await delivered(id)
  const response = await step(id, {
    purpose: 'enroll',
    secret,
    password: PASSWORD,
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ completed: true, signInAgain: false })
}

describe('governed signing credentials over certificate-validated local SMTP', () => {
  it('rejects an untrusted server certificate, spends failed delivery grants, and never falls back to plaintext', async () => {
    const transport = await createSmtpTransport(untrusted.config)
    await expect(
      transport.send({
        to: 'control@sheetbase.test',
        subject: 'TLS negative control',
        body: 'No secret',
      }),
    ).rejects.toMatchObject({
      code: 'ESOCKET',
      message: expect.stringMatching(/unable to verify|self.signed/i),
    })
    const id = await user()
    await verify(id)
    const previous = await delivered(id)
    configureSmtp(untrusted)
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(503)
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: previous,
          password: PASSWORD,
        })
      ).status,
    ).toBe(403)
    await noLiveGrants(id)
    expect(untrusted.messages.length).toBe(0)
    expect(untrusted.plaintextMail()).toBe(0)
    const events = await migrator.query(
      'SELECT event FROM internal.signature_authentication_events WHERE user_id=$1',
      [id],
    )
    expect(events.rows.map((row) => row.event)).toContain(
      'enroll-delivery-failed',
    )
    // The same production transport succeeds only with the trusted CA.
    await delivered(id)
    expect(trusted.plaintextMail()).toBe(0)
  })

  it('requires independent administrator verification of the exact email and a fresh live requested session', async () => {
    configureSmtp()
    const id = await user(undefined, 'owner')
    const target = await actor(id)
    const admin = await actor('smtp-admin')
    const before = trusted.messages.length
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(403)
    await target.query('SELECT api.request_signature_identity_verification()')
    await expectDenied(
      target.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '42501',
    )
    const member = await actor(await user())
    await expectDenied(
      member.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '42501',
    )
    await expectDenied(
      admin.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        'wrong@sheetbase.test',
      ]),
      '22023',
    )
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(403)
    expect(trusted.messages.length).toBe(before)
    await verify(id)
    await migrator.query(
      `UPDATE api.user_signature_certifications SET identity_verified_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1`,
      [id],
    )
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(403)
    await verify(id)
    await migrator.query(
      `UPDATE internal.session SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE "userId"=$1`,
      [id],
    )
    const expired = await step(id, { purpose: 'enroll-request' })
    expect(expired.status).toBe(401)
    expect(await expired.json()).toMatchObject({ code: 'session_expired' })
    await expectDenied(
      admin.query('SELECT api.verify_signature_identity($1,$2)', [
        id,
        `${id}@sheetbase.test`,
      ]),
      '22023',
    )
    expect(trusted.messages.length).toBe(before)
  })

  it('refuses wrong-session, reissued and expired secrets, then enrolls exactly once through Better Auth', async () => {
    const id = await user()
    await verify(id)
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 hour')`,
      [`second-${id}`, `token-second-${id}`, id],
    )
    const first = await delivered(id)
    expect(
      (await step(id, { purpose: 'enroll-request' }, `second-${id}`)).status,
    ).toBe(403)
    expect(
      (
        await step(
          id,
          { purpose: 'enroll', secret: first, password: PASSWORD },
          `second-${id}`,
        )
      ).status,
    ).toBe(403)
    const second = await delivered(id)
    expect(first === second).toBe(false)
    expect(
      (await step(id, { purpose: 'enroll', secret: first, password: PASSWORD }))
        .status,
    ).toBe(403)
    await migrator.query(
      `UPDATE internal.signature_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`,
      [hash(second)],
    )
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: second,
          password: PASSWORD,
        })
      ).status,
    ).toBe(403)
    const live = await delivered(id)
    const results = await Promise.all(
      [1, 2].map(() =>
        step(id, { purpose: 'enroll', secret: live, password: PASSWORD }),
      ),
    )
    expect(results.map((result) => result.status).sort()).toEqual([200, 403])
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: PASSWORD },
    })
    await expect(
      authentication.api.verifyPassword({
        headers: headers(id),
        body: { password: RECOVERED_PASSWORD },
      }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    expect(
      (
        await step(id, {
          purpose: 'enroll',
          secret: live,
          password: RECOVERED_PASSWORD,
        })
      ).status,
    ).toBe(403)
    await verify(id)
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(409)
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: PASSWORD },
    })
    const account = await migrator.query(
      `SELECT password FROM internal.account WHERE "userId"=$1 AND "providerId"='credential'`,
      [id],
    )
    expect(account.rows.length).toBe(1)
    expect(typeof account.rows[0].password).toBe('string')
    expect(account.rows[0].password === PASSWORD).toBe(false)
    const outbox = await migrator.query(
      'SELECT count(*)::int n FROM internal.email_deliveries WHERE user_id=$1',
      [id],
    )
    expect(outbox.rows[0].n).toBe(0)
  })

  it('spends the email secret and independent authorization even when Better Auth rejects the new password', async () => {
    const id = await user()
    await verify(id)
    const secret = await delivered(id)
    expect(
      (await step(id, { purpose: 'enroll', secret, password: 'short' })).status,
    ).toBe(400)
    expect(
      (await step(id, { purpose: 'enroll', secret, password: PASSWORD }))
        .status,
    ).toBe(403)
    expect((await step(id, { purpose: 'enroll-request' })).status).toBe(403)
    await noLiveGrants(id)
    const accounts = await migrator.query(
      `SELECT count(*)::int n FROM internal.account WHERE "userId"=$1 AND "providerId"='credential'`,
      [id],
    )
    expect(accounts.rows[0].n).toBe(0)
    await enroll(id)
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: PASSWORD },
    })
  })

  it('recovers an enrolled credential, rejects old evidence, revokes every session/grant, and requires sign-in plus recertification', async () => {
    const id = await user()
    await enroll(id)
    const client = await actor(id)
    await migrator.query(
      `INSERT INTO internal.session(id,token,"userId","expiresAt") VALUES($1,$2,$3,now()+interval '1 hour')`,
      [`second-${id}`, `token-second-${id}`, id],
    )
    await verify(id)
    const first = await delivered(id, 'recover-request')
    expect(
      (
        await step(
          id,
          { purpose: 'recover', secret: first, password: RECOVERED_PASSWORD },
          `second-${id}`,
        )
      ).status,
    ).toBe(403)
    const second = await delivered(id, 'recover-request')
    expect(
      (
        await step(id, {
          purpose: 'recover',
          secret: first,
          password: RECOVERED_PASSWORD,
        })
      ).status,
    ).toBe(403)
    await migrator.query(
      `UPDATE internal.signature_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`,
      [hash(second)],
    )
    expect(
      (
        await step(id, {
          purpose: 'recover',
          secret: second,
          password: RECOVERED_PASSWORD,
        })
      ).status,
    ).toBe(403)
    const secret = await delivered(id, 'recover-request')
    // Mint live signing evidence AFTER independent reauthorization and email
    // reissues. Otherwise those earlier operations already revoke it, and the
    // test would not establish recovery's own grant/certification revocation.
    const certification = await step(id, {
      purpose: 'certify',
      password: PASSWORD,
    })
    expect(certification.status).toBe(200)
    await client.query('SELECT api.certify_signature($1,1,$2)', [
      WS,
      (await certification.json()).token,
    ])
    const practice = await step(id, { purpose: 'practice', password: PASSWORD })
    expect(practice.status).toBe(200)
    const outstanding = await practice.json()
    const live = await migrator.query(
      `SELECT purpose FROM internal.signature_grants WHERE user_id=$1 AND consumed_at IS NULL ORDER BY purpose`,
      [id],
    )
    expect(live.rows.map((row) => row.purpose)).toEqual(['practice', 'recover'])
    const response = await step(id, {
      purpose: 'recover',
      secret,
      password: RECOVERED_PASSWORD,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      completed: true,
      signInAgain: true,
    })
    for (const session of [`session-${id}`, `second-${id}`]) {
      expect(
        await authentication.api.getSession({ headers: headers(id, session) }),
      ).toBeNull()
    }
    expect(
      (await step(id, { purpose: 'recover', secret, password: PASSWORD }))
        .status,
    ).toBe(401)
    await noLiveGrants(id)
    const sessions = await migrator.query(
      `SELECT count(*)::int n FROM internal.session WHERE "userId"=$1`,
      [id],
    )
    expect(sessions.rows[0].n).toBe(0)
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [outstanding.token]),
      'SB002',
    )
    // Fixture only the new login session, never the password or certification.
    await ensureSessions(migrator, [id])
    await authentication.api.verifyPassword({
      headers: headers(id),
      body: { password: RECOVERED_PASSWORD },
    })
    await expect(
      authentication.api.verifyPassword({
        headers: headers(id),
        body: { password: PASSWORD },
      }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    expect(
      (await step(id, { purpose: 'practice', password: RECOVERED_PASSWORD }))
        .status,
    ).toBe(403)
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [outstanding.token]),
      '42501',
    )
    const recertify = await step(id, {
      purpose: 'certify',
      password: RECOVERED_PASSWORD,
    })
    expect(recertify.status).toBe(200)
    await client.query('SELECT api.certify_signature($1,1,$2)', [
      WS,
      (await recertify.json()).token,
    ])
    await expectDenied(
      client.query('SELECT api.practice_signature($1)', [outstanding.token]),
      'SB002',
    )
    const fresh = await step(id, {
      purpose: 'practice',
      password: RECOVERED_PASSWORD,
    })
    expect(fresh.status).toBe(200)
    const practiced = await client.query(
      'SELECT api.practice_signature($1) result',
      [(await fresh.json()).token],
    )
    expect(practiced.rows[0].result).toMatchObject({
      practice: true,
      authMethod: 'password',
    })
  })
})
