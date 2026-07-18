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
import { createAuth } from '#/lib/auth'
import { migratorUrl, prepareTestDatabase } from './helpers'

let migrator: Client
let auth: ReturnType<typeof createAuth>
let db: ReturnType<typeof drizzle<typeof schema>>

const userId = 'session-test-user'
const sessionToken = 'session-test-token'

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
  db = drizzle(migratorUrl(), { schema })
  auth = createAuth(migratorUrl())

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
    headers.set('cookie', `better-auth.session_token=${signSessionToken(token)}`)
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
