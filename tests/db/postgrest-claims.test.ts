/**
 * AUTH-003 contract proof: the JWT minted by `mintPostgrestToken` carries the
 * minimal claim set, and when those claims are placed into the
 * `request.jwt.claims` session setting — exactly what PostgREST does after
 * verifying the request JWT — they are readable from SQL via
 * `api.claim_probe()`. AUTH-004's RLS policies will read the same setting.
 *
 * PostgREST itself is not booted here (the local orb has no PostgREST
 * binary). The contract being fixed is the claim shape and its propagation
 * into session settings, not PostgREST's JWT verification, which is the
 * library's responsibility. The token is minted with the real server secret
 * and verified with `jose` using that same secret, so the test exercises the
 * full round-trip the proxy performs at request time.
 */
import { jwtVerify } from 'jose'
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mintPostgrestToken } from '#/lib/postgrest-token'
import { expectDenied, prepareTestDatabase } from './helpers'

const INSUFFICIENT_PRIVILEGE = '42501'
const SECRET = process.env.PGRST_JWT_SECRET!

const CLAIM_INPUT = {
  userId: 'claim-test-user',
  workspaceId: 'claim-test-workspace',
  sessionId: 'claim-test-session',
  ttlSeconds: 90,
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []
let mintedToken: string
let verifiedPayload: Record<string, unknown> & {
  sub?: string
  workspace_id?: string
  session_id?: string
  role?: string
  iat?: number
  exp?: number
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  mintedToken = await mintPostgrestToken(SECRET, CLAIM_INPUT)
  const { payload } = await jwtVerify(
    mintedToken,
    new TextEncoder().encode(SECRET),
  )
  verifiedPayload = payload as typeof verifiedPayload
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

async function connectAsAuthenticated(): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  return client
}

async function setClaims(client: Client, claimsJson: string): Promise<void> {
  // PostgREST sets request.jwt.claims as a session GUC from the verified JWT
  // payload. is_local=false keeps it for the session so the next query sees it.
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claimsJson,
  ])
}

describe('minted PostgREST token', () => {
  it('carries the minimal claim set and a short expiry', () => {
    expect(verifiedPayload.sub).toBe(CLAIM_INPUT.userId)
    expect(verifiedPayload.workspace_id).toBe(CLAIM_INPUT.workspaceId)
    expect(verifiedPayload.session_id).toBe(CLAIM_INPUT.sessionId)
    expect(verifiedPayload.role).toBe('authenticated')
    expect(verifiedPayload.iat).toBeTypeOf('number')
    expect(verifiedPayload.exp).toBeTypeOf('number')
    // Short-lived: expiry is within the requested ttl of issuance.
    const ttl = verifiedPayload.exp! - verifiedPayload.iat!
    expect(ttl).toBeLessThanOrEqual(CLAIM_INPUT.ttlSeconds)
    expect(ttl).toBeGreaterThan(0)
  })
})

describe('claim propagation into PostgreSQL session settings', () => {
  it('exposes every claim to api.claim_probe() as readable JSON', async () => {
    const client = await connectAsAuthenticated()
    await setClaims(client, JSON.stringify(verifiedPayload))

    const { rows } = await client.query<{ claims: Record<string, unknown> }>(
      'SELECT api.claim_probe() AS claims',
    )
    const claims = rows[0]?.claims
    expect(claims?.sub).toBe(CLAIM_INPUT.userId)
    expect(claims?.workspace_id).toBe(CLAIM_INPUT.workspaceId)
    expect(claims?.session_id).toBe(CLAIM_INPUT.sessionId)
    expect(claims?.role).toBe('authenticated')
  })

  it('yields no workspace context when claims are missing', async () => {
    // The defensive foundation for AUTH-004 RLS: with no GUC set, the probe
    // returns NULL, so any policy reading request.jwt.claims must treat the
    // request as having no workspace — zero rows, never an error.
    const client = await connectAsAuthenticated()
    await client.query('RESET request.jwt.claims')

    const { rows } = await client.query<{ claims: string | null }>(
      'SELECT api.claim_probe() AS claims',
    )
    expect(rows[0]?.claims).toBeNull()
  })

  it('yields no workspace context when claims are malformed', async () => {
    // Defensive: a non-JSON value in the GUC must not raise. RLS helpers
    // built on this probe must treat garbage as "no workspace" (zero rows).
    const client = await connectAsAuthenticated()
    await setClaims(client, 'not-json')

    const { rows } = await client.query<{ claims: string | null }>(
      'SELECT api.claim_probe() AS claims',
    )
    expect(rows[0]?.claims).toBeNull()
  })

  it('keeps the claim set isolated per session', async () => {
    // A second connection with different claims must not see the first.
    const first = await connectAsAuthenticated()
    await setClaims(
      first,
      JSON.stringify({ ...verifiedPayload, workspace_id: 'ws-a' }),
    )

    const second = await connectAsAuthenticated()
    await setClaims(
      second,
      JSON.stringify({ ...verifiedPayload, workspace_id: 'ws-b' }),
    )

    const a = await first.query<{ claims: Record<string, unknown> }>(
      'SELECT api.claim_probe() AS claims',
    )
    const b = await second.query<{ claims: Record<string, unknown> }>(
      'SELECT api.claim_probe() AS claims',
    )
    expect(a.rows[0]?.claims?.workspace_id).toBe('ws-a')
    expect(b.rows[0]?.claims?.workspace_id).toBe('ws-b')
  })
})

describe('claim_probe privilege', () => {
  it('denies the anonymous role access to the probe', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE anon')
    await expectDenied(
      client.query('SELECT api.claim_probe()'),
      INSUFFICIENT_PRIVILEGE,
    )
  })
})
