/**
 * Email sign-in by one-time link, TOTP two-factor and company OIDC against a
 * real database. No mail server and no identity provider: the link sender is
 * injected and discovery is stubbed, so the flows run through Better Auth's
 * real HTTP handler.
 */
import { createHmac } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { Client } from 'pg'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import * as schema from '#/db/schema'
import { createAuth, handleAuthRequest } from '#/lib/auth'
import { migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let db: ReturnType<typeof drizzle<typeof schema>>
const origin = () => new URL(process.env.BETTER_AUTH_URL!).origin

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) so the test needs no extra package. */
function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const hmac = createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const value = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(value % 1_000_000).padStart(6, '0')
}

const sent: Array<{ to: string; body: string }> = []
let auth: ReturnType<typeof createAuth>

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  auth = createAuth(db, {
    emailLink: true,
    emailLinkAllowedDomains: ['lab.test'],
    oidc: null,
    sendEmail: async ({ to, body }) => {
      sent.push({ to, body })
    },
  })
  await db.insert(schema.user).values({
    id: 'email-existing',
    name: 'Existing Person',
    email: 'existing@elsewhere.test',
    emailVerified: true,
  })
})

afterEach(() => {
  sent.length = 0
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

function post(path: string, body: unknown, cookie?: string) {
  const headers = new Headers({
    origin: origin(),
    'content-type': 'application/json',
  })
  if (cookie) headers.set('cookie', cookie)
  return handleAuthRequest(
    new Request(`${origin()}/api/auth/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    auth,
  )
}

/** The cookies a browser would hold after this response: last write wins, empty clears. */
function cookiesOf(response: Response): string {
  const jar = new Map<string, string>()
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    jar.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  return [...jar]
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function linkIn(body: string): string {
  return body.match(/https?:\/\/\S+/)![0]
}

async function followLink(url: string) {
  return handleAuthRequest(
    new Request(url, { headers: { origin: origin() }, redirect: 'manual' }),
    auth,
  )
}

describe('email sign-in link', () => {
  it('signs an existing account in and lands on the callback', async () => {
    const res = await post('sign-in/magic-link', {
      email: 'existing@elsewhere.test',
      callbackURL: '/experiments',
    })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    const verify = await followLink(linkIn(sent[0].body))
    expect(verify.status).toBe(302)
    expect(verify.headers.get('location')).toContain('/experiments')
    expect(cookiesOf(verify)).toContain('better-auth.session_token')
  })

  it('answers the same for an unknown address outside the allowed domains and sends nothing', async () => {
    const res = await post('sign-in/magic-link', {
      email: 'stranger@nowhere.test',
    })
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(0)
    const users = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'stranger@nowhere.test'))
    expect(users).toHaveLength(0)
  })

  it('creates an account with a workspace for an allowed domain', async () => {
    await post('sign-in/magic-link', { email: 'new.person@lab.test' })
    expect(sent).toHaveLength(1)
    const verify = await followLink(linkIn(sent[0].body))
    expect(verify.status).toBe(302)
    const [created] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'new.person@lab.test'))
    expect(created.emailVerified).toBe(true)
    const memberships = await db
      .select()
      .from(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.userId, created.id))
    expect(memberships).toHaveLength(1)
  })

  it('works only once', async () => {
    await post('sign-in/magic-link', { email: 'existing@elsewhere.test' })
    const url = linkIn(sent[0].body)
    await followLink(url)
    const again = await followLink(url)
    expect(cookiesOf(again)).not.toContain('session_token')
    expect(again.headers.get('location')).toContain('error=')
  })
})

describe('two-factor (TOTP)', () => {
  it('enrols from a signed-in session, then gates the email link behind a code', async () => {
    // Sign in by link, as a person would.
    await post('sign-in/magic-link', { email: 'existing@elsewhere.test' })
    const first = await followLink(linkIn(sent[0].body))
    const sessionCookie = cookiesOf(first)
    sent.length = 0

    const enable = await post('two-factor/enable', {}, sessionCookie)
    expect(enable.status).toBe(200)
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string
      backupCodes: string[]
    }
    expect(backupCodes.length).toBeGreaterThan(0)
    const secret = new URL(totpURI).searchParams.get('secret')!
    const code = () => totp(secret)

    // Not enabled until a first code proves the authenticator works.
    let [row] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, 'email-existing'))
    expect(row.twoFactorEnabled).toBe(false)
    const confirm = await post(
      'two-factor/verify-totp',
      { code: code() },
      sessionCookie,
    )
    expect(confirm.status).toBe(200)
    ;[row] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.id, 'email-existing'))
    expect(row.twoFactorEnabled).toBe(true)

    // The next link sign-in is held at the code prompt: no session yet.
    await post('sign-in/magic-link', {
      email: 'existing@elsewhere.test',
      callbackURL: '/experiments',
    })
    const held = await followLink(linkIn(sent[0].body))
    expect(held.status).toBe(302)
    const location = held.headers.get('location')!
    expect(location).toContain('/sign-in/two-factor')
    expect(decodeURIComponent(location)).toContain('/experiments')
    const challenge = cookiesOf(held)
    expect(challenge).toContain('two_factor')
    expect(challenge).not.toContain('session_token')

    const wrong = await post(
      'two-factor/verify-totp',
      { code: '000000' },
      challenge,
    )
    expect(wrong.status).toBe(401)
    const ok = await post('two-factor/verify-totp', { code: code() }, challenge)
    expect(ok.status).toBe(200)
    expect(cookiesOf(ok)).toContain('session_token')
  })
})

describe('company OIDC sign-in', () => {
  it('starts an authorisation-code flow with PKCE against the discovered endpoint', async () => {
    const issuer = 'https://login.company.test/realms/lab'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url === `${issuer}/.well-known/openid-configuration`) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
            token_endpoint: `${issuer}/protocol/openid-connect/token`,
            userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
          })
        }
        throw new Error(`unexpected fetch ${url}`)
      }),
    )
    auth = createAuth(db, {
      oidc: {
        issuerUrl: issuer,
        clientId: 'sheetbase',
        clientSecret: 'secret',
        name: 'Company SSO',
      },
      emailLink: false,
    })
    const res = await post('sign-in/oauth2', {
      providerId: 'oidc',
      callbackURL: '/',
    })
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    const authorise = new URL(url)
    expect(authorise.origin + authorise.pathname).toBe(
      `${issuer}/protocol/openid-connect/auth`,
    )
    expect(authorise.searchParams.get('client_id')).toBe('sheetbase')
    expect(authorise.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorise.searchParams.get('redirect_uri')).toContain(
      '/api/auth/oauth2/callback/oidc',
    )
    expect(authorise.searchParams.get('scope')).toContain('openid')
  })
})
