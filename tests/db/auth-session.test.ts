/**
 * AUTH-001 integration proof: session creation, expiry and unauthenticated
 * access through Better Auth against a real database. No live GitHub calls —
 * sessions are established directly in the identity tables, which is exactly
 * what the OAuth callback does after provider consent.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { createHmac } from 'node:crypto'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import { createAuth, handleAuthRequest } from '#/lib/auth'
import { migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let auth: ReturnType<typeof createAuth>
let db: ReturnType<typeof drizzle<typeof schema>>

const userId = 'session-test-user'
const sessionToken = 'session-test-token'

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  auth = createAuth(db)

  await db.insert(schema.user).values({
    id: userId,
    name: 'Session Test User',
    email: 'session-test@sheetbase.test',
    emailVerified: true,
  })
  await db.insert(schema.session).values({
    id: 'session-test-session',
    token: sessionToken,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
})

afterAll(async () => {
  await db.$client.end()
  await migrator.end()
})

function sessionHeaders(token?: string): Headers {
  const headers = new Headers()
  if (token) {
    // Better Auth stores the session token as a signed cookie:
    // encodeURIComponent(`${token}.${base64(HMAC-SHA256(token, secret))}`).
    // With useSecureCookies enabled (auth.ts) the cookie is prefixed with
    // the `__Secure-` prefix, so the session lookup only matches that name.
    headers.set(
      'cookie',
      `__Secure-better-auth.session_token=${signSessionToken(token)}`,
    )
  }
  return headers
}

function signSessionToken(token: string): string {
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!)
    .update(token, 'utf8')
    .digest('base64')
  return encodeURIComponent(`${token}.${signature}`)
}

describe('session lifecycle', () => {
  it('returns no session without a cookie', async () => {
    const result = await auth.api.getSession({ headers: sessionHeaders() })
    expect(result).toBeNull()
  })

  it('returns no session for an unknown token', async () => {
    const result = await auth.api.getSession({
      headers: sessionHeaders('forged-token'),
    })
    expect(result).toBeNull()
  })

  it('resolves a created session to its user', async () => {
    const result = await auth.api.getSession({
      headers: sessionHeaders(sessionToken),
    })
    expect(result?.user.id).toBe(userId)
    expect(result?.user.email).toBe('session-test@sheetbase.test')
    expect(result?.session.token).toBe(sessionToken)
  })

  it('uses Better Auth to verify a local signing password without creating a session', async () => {
    const headers = sessionHeaders(sessionToken)
    // Password enrollment is a fixture operation through Better Auth, not a
    // shipped session-only enrollment endpoint or an application-owned hash.
    await auth.api.setPassword({
      headers,
      body: { newPassword: 'fixture-signing-password-2026' },
    })
    const before = await db
      .select({ id: schema.session.id })
      .from(schema.session)

    await expect(
      auth.api.verifyPassword({
        headers,
        body: { password: 'incorrect-fixture-password' },
      }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    await expect(
      auth.api.verifyPassword({
        headers: sessionHeaders(),
        body: { password: 'fixture-signing-password-2026' },
      }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' })
    expect(
      await auth.api.verifyPassword({
        headers,
        body: { password: 'fixture-signing-password-2026' },
      }),
    ).toEqual({ status: true })
    expect(
      await db.select({ id: schema.session.id }).from(schema.session),
    ).toEqual(before)
  })

  it.each([
    {
      path: 'verify-password',
      body: { password: 'fixture-signing-password-2026' },
    },
    {
      path: 'change-password',
      body: {
        currentPassword: 'fixture-signing-password-2026',
        newPassword: 'unauthorised-fixture-replacement',
      },
    },
    {
      path: 'request-password-reset',
      body: { email: 'session-test@sheetbase.test' },
    },
    {
      path: 'reset-password',
      body: {
        newPassword: 'unauthorised-fixture-replacement',
        token: 'untrusted',
      },
    },
    {
      path: 'sign-in/email',
      body: {
        email: 'session-test@sheetbase.test',
        password: 'fixture-signing-password-2026',
      },
    },
    {
      path: 'sign-up/email',
      body: {
        email: 'unauthorised@sheetbase.test',
        password: 'unauthorised-fixture-password',
        name: 'Unauthorised',
      },
    },
    {
      path: 'set-password',
      body: { newPassword: 'unauthorised-fixture-replacement' },
    },
  ])(
    'does not expose $path outside governed signing authentication',
    async ({ path, body }) => {
      const origin = new URL(process.env.BETTER_AUTH_URL!).origin
      const headers = sessionHeaders(sessionToken)
      headers.set('origin', origin)
      headers.set('content-type', 'application/json')
      const response = await handleAuthRequest(
        new Request(`${origin}/api/auth/${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
        auth,
      )
      expect(response.status).toBe(404)
    },
  )

  it('keeps the normal session HTTP endpoint available', async () => {
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin
    const response = await handleAuthRequest(
      new Request(`${origin}/api/auth/get-session`, {
        headers: sessionHeaders(sessionToken),
      }),
      auth,
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.user.id).toBe(userId)
  })

  it('blocks a valid reset token callback and redemption at the HTTP boundary', async () => {
    const token = 'rev03-valid-reset-fixture-token'
    const context = await auth.$context
    await context.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt: new Date(Date.now() + 300_000),
    })
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin
    const callback = new Request(
      `${origin}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(`${origin}/settings/signatures`)}`,
    )
    // Establish that this token really is accepted by the library callback,
    // rather than obtaining a denial from an invalid-token fixture.
    const libraryResponse = await auth.handler(callback.clone())
    expect(libraryResponse.status).toBe(302)
    expect(
      new URL(libraryResponse.headers.get('location')!).searchParams.get(
        'token',
      ),
    ).toBe(token)

    const publicResponse = await handleAuthRequest(callback, auth)
    expect(publicResponse.status).toBe(404)
    const headers = sessionHeaders(sessionToken)
    headers.set('origin', origin)
    headers.set('content-type', 'application/json')
    const reset = await handleAuthRequest(
      new Request(`${origin}/api/auth/reset-password`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          token,
          newPassword: 'blocked-recovery-fixture-password',
        }),
      }),
      auth,
    )
    expect(reset.status).toBe(404)
    expect(
      await auth.api.verifyPassword({
        headers,
        body: { password: 'fixture-signing-password-2026' },
      }),
    ).toEqual({ status: true })
    // The HTTP guard must not disable the trusted API used by authorised
    // recovery. Only the test fixture calls it directly here.
    expect(
      await auth.api.resetPassword({
        body: { token, newPassword: 'trusted-recovery-fixture-password' },
      }),
    ).toEqual({ status: true })
    expect(await auth.api.getSession({ headers })).toBeNull()
    // Recovery revokes every old session. Establish a fresh fixture session
    // before verifying the replacement credential through Better Auth.
    await db.insert(schema.session).values({
      id: 'session-test-session',
      token: sessionToken,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    expect(
      await auth.api.verifyPassword({
        headers,
        body: { password: 'trusted-recovery-fixture-password' },
      }),
    ).toEqual({ status: true })
  })

  it('does not expose a password oracle outside durable signing failure counting', async () => {
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin
    const headers = sessionHeaders(sessionToken)
    headers.set('origin', origin)
    headers.set('content-type', 'application/json')
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await handleAuthRequest(
        new Request(`${origin}/api/auth/verify-password`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: 'incorrect-fixture-password' }),
        }),
        auth,
      )
      expect(response.status).toBe(404)
    }
  })

  it('applies the configured inactivity window to a new session', async () => {
    // SET-03.3. The window is not merely declared: Better Auth stamps the expiry when it
    // creates the session, and an idle window is one that is refreshed by activity, so the
    // refresh interval has to be shorter than the window itself. Enforcement of the stamped
    // expiry is covered by the expired-session case below.
    const ctx = await (
      auth as unknown as { $context: Promise<Record<string, unknown>> }
    ).$context
    const sessionOptions = (
      auth as unknown as {
        options: { session: { expiresIn: number; updateAge: number } }
      }
    ).options.session
    expect(sessionOptions.expiresIn).toBe(30 * 60)
    expect(sessionOptions.updateAge).toBeLessThan(sessionOptions.expiresIn)

    const created = await (
      ctx.internalAdapter as {
        createSession: (userId: string) => Promise<{ expiresAt: Date }>
      }
    ).createSession(userId)
    const windowMs = created.expiresAt.getTime() - Date.now()
    expect(windowMs).toBeGreaterThan(29 * 60 * 1000)
    expect(windowMs).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  it('rejects an expired session', async () => {
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(schema.session.token, sessionToken))

    const result = await auth.api.getSession({
      headers: sessionHeaders(sessionToken),
    })
    expect(result).toBeNull()

    // Restore for other assertions.
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(schema.session.token, sessionToken))
  })
})
