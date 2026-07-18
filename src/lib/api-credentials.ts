/**
 * API-005: scoped external API credentials. Credentials live in
 * internal.api_credentials (never exposed to PostgREST). The full secret is
 * shown to the user exactly once at creation; only a hash is stored.
 *
 * Exchange verifies the secret, checks revocation and scope, rate-limits
 * guesses, and mints a short-lived PostgREST JWT with a narrower
 * `api_client` role claim. RLS for api_client arrives in a later ticket;
 * for now the token carries the workspace_id and scopes so policy-level
 * enforcement can be added without changing the exchange contract.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { SignJWT } from 'jose'

import type * as schema from '#/db/schema'
import { apiCredentials, workspaceMemberships } from '#/db/schema'

export type Db = NodePgDatabase<typeof schema>

/** The initial scope vocabulary (API-005). Future tickets extend this. */
export const VALID_SCOPES = ['projects:read', 'projects:write'] as const
export type Scope = (typeof VALID_SCOPES)[number]

/**
 * The full credential string shown to the user once. Format:
 * `sb_<prefix>_<secret>`, where prefix is 8 hex chars (stored) and secret is
 * 32 hex chars (never stored). The prefix lets users identify a credential
 * without revealing it; the prefix is also the lookup key at exchange time.
 */
export interface CreatedCredential {
  id: string
  /** The full credential string. Show once, never store. */
  secret: string
  displayPrefix: string
  name: string
  scopes: Scope[]
}

export interface CredentialRecord {
  id: string
  workspaceId: string
  displayPrefix: string
  name: string
  scopes: Scope[]
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

function generatePrefix(): string {
  return randomBytes(4).toString('hex') // 8 hex chars
}

function generateSecret(): string {
  return randomBytes(16).toString('hex') // 32 hex chars
}

/** Salted hash: SHA-256(prefix + ":" + secret). The prefix is the salt. */
export function hashSecret(prefix: string, secret: string): string {
  return createHash('sha256').update(`${prefix}:${secret}`).digest('hex')
}

export function buildCredentialString(prefix: string, secret: string): string {
  return `sb_${prefix}_${secret}`
}

/**
 * Parses a credential string of the form `sb_<prefix>_<secret>`. Returns null
 * for anything malformed — callers treat null as an auth failure, never an
 * error, so the endpoint does not leak which part was wrong.
 */
export function parseCredentialString(
  raw: string,
): { prefix: string; secret: string } | null {
  const match = /^sb_([0-9a-f]{8})_([0-9a-f]{32})$/.exec(raw)
  if (!match) return null
  return { prefix: match[1], secret: match[2] }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Creates a credential. The full secret is returned exactly once; only the
 * hash and display prefix are stored. Scopes are validated against the
 * current vocabulary.
 */
export async function createCredential(
  db: Db,
  input: {
    workspaceId: string
    createdByUserId: string
    name: string
    scopes: Scope[]
  },
): Promise<CreatedCredential> {
  for (const scope of input.scopes) {
    if (!VALID_SCOPES.includes(scope)) {
      throw new CredentialError('invalid_scope', `Unknown scope: ${scope}`)
    }
  }

  // Generate a unique prefix (collision is astronomically unlikely but the
  // unique constraint is the backstop).
  let prefix = generatePrefix()
  const secret = generateSecret()
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.query.apiCredentials.findFirst({
      where: eq(apiCredentials.displayPrefix, prefix),
    })
    if (!existing) break
    prefix = generatePrefix()
  }

  const [row] = await db
    .insert(apiCredentials)
    .values({
      workspaceId: input.workspaceId,
      displayPrefix: prefix,
      secretHash: hashSecret(prefix, secret),
      name: input.name,
      scopes: input.scopes,
      createdByUserId: input.createdByUserId,
    })
    .returning({ id: apiCredentials.id })

  // The insert returning() always yields a row for a successful insert;
  // a failure throws before this point.
  return {
    id: row.id,
    secret: buildCredentialString(prefix, secret),
    displayPrefix: prefix,
    name: input.name,
    scopes: input.scopes,
  }
}

/** Lists a workspace's credentials (without secrets). */
export async function listCredentials(
  db: Db,
  workspaceId: string,
): Promise<CredentialRecord[]> {
  const rows = await db.query.apiCredentials.findMany({
    where: eq(apiCredentials.workspaceId, workspaceId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  })
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    displayPrefix: row.displayPrefix,
    name: row.name,
    scopes: row.scopes as Scope[],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  }))
}

/** Revokes a credential. Revocation is immediate and permanent. */
export async function revokeCredential(
  db: Db,
  input: { workspaceId: string; credentialId: string },
): Promise<void> {
  await db
    .update(apiCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiCredentials.id, input.credentialId),
        eq(apiCredentials.workspaceId, input.workspaceId),
      ),
    )
}

export type ExchangeErrorCode =
  'invalid_credential' | 'revoked' | 'insufficient_scope' | 'rate_limited'

export class CredentialError extends Error {
  readonly code: ExchangeErrorCode | 'invalid_scope'
  constructor(code: ExchangeErrorCode | 'invalid_scope', message: string) {
    super(message)
    this.name = 'CredentialError'
    this.code = code
  }
}

/**
 * In-memory rate limiter for credential exchange. Tracks failed attempts per
 * prefix; after 5 failures within 15 minutes, the prefix is locked for 15
 * minutes. A successful exchange clears the counter. This bounds guessing
 * without adding a durable store; a distributed deployment would move this
 * to Redis, but the single-user phase has one server process.
 */
interface RateBucket {
  failures: number
  firstFailureAt: number
  lockedUntil: number
}

const rateBuckets = new Map<string, RateBucket>()
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

function checkRateLimit(prefix: string): void {
  const bucket = rateBuckets.get(prefix)
  if (!bucket) return
  const now = Date.now()
  if (bucket.lockedUntil > now) {
    throw new CredentialError('rate_limited', 'Too many attempts. Try later.')
  }
  // Expire stale buckets.
  if (bucket.firstFailureAt < now - WINDOW_MS) {
    rateBuckets.delete(prefix)
  }
}

function recordFailure(prefix: string): void {
  const now = Date.now()
  const bucket = rateBuckets.get(prefix) ?? {
    failures: 0,
    firstFailureAt: now,
    lockedUntil: 0,
  }
  bucket.failures += 1
  bucket.firstFailureAt = now
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockedUntil = now + LOCK_MS
  }
  rateBuckets.set(prefix, bucket)
}

function clearRateLimit(prefix: string): void {
  rateBuckets.delete(prefix)
}

export interface ExchangeDeps {
  /** Mints the short-lived PostgREST JWT. */
  mintToken: (input: {
    workspaceId: string
    credentialId: string
    scopes: Scope[]
  }) => Promise<string>
}

/**
 * Exchanges a credential string for a short-lived PostgREST JWT. The token
 * carries `workspace_id`, `credential_id`, `scopes` and `role: 'api_client'`
 * — narrower than the browser-session claim (AUTH-003), which carries a user
 * id and session id instead.
 *
 * Every failure path returns the same `invalid_credential` code to avoid
 * leaking which part was wrong, except `rate_limited` (actionable) and
 * `revoked` (the owner already knows). Scope mismatch is reported so a
 * caller knows to request broader scopes, not to retry blindly.
 */
export async function exchangeCredential(
  db: Db,
  rawSecret: string,
  requiredScopes: Scope[],
  deps: ExchangeDeps,
): Promise<string> {
  const parsed = parseCredentialString(rawSecret)
  if (!parsed) {
    throw new CredentialError('invalid_credential', 'Invalid credential.')
  }

  checkRateLimit(parsed.prefix)

  const row = await db.query.apiCredentials.findFirst({
    where: eq(apiCredentials.displayPrefix, parsed.prefix),
  })

  // Use a dummy hash comparison so timing does not reveal whether the prefix
  // existed.
  const expectedHash = row?.secretHash ?? hashSecret(parsed.prefix, 'no-such')
  if (
    !row ||
    !constantTimeEqual(hashSecret(parsed.prefix, parsed.secret), expectedHash)
  ) {
    recordFailure(parsed.prefix)
    throw new CredentialError('invalid_credential', 'Invalid credential.')
  }

  if (row.revokedAt) {
    throw new CredentialError('revoked', 'Credential has been revoked.')
  }

  for (const required of requiredScopes) {
    if (!(row.scopes as Scope[]).includes(required)) {
      throw new CredentialError(
        'insufficient_scope',
        `Credential lacks scope: ${required}`,
      )
    }
  }

  // Stamp last-used. Best-effort: a failure here must not invalidate an
  // otherwise-valid exchange.
  try {
    await db
      .update(apiCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiCredentials.id, row.id))
  } catch {
    // ignore
  }

  clearRateLimit(parsed.prefix)

  return deps.mintToken({
    workspaceId: row.workspaceId,
    credentialId: row.id,
    scopes: requiredScopes,
  })
}

/** Mints a PostgREST JWT for an API client. */
export async function mintApiClientToken(
  secret: string,
  input: {
    workspaceId: string
    credentialId: string
    scopes: Scope[]
    ttlSeconds?: number
  },
): Promise<string> {
  const ttl = input.ttlSeconds ?? 300
  return await new SignJWT({
    workspace_id: input.workspaceId,
    credential_id: input.credentialId,
    scopes: input.scopes,
    role: 'api_client',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(new TextEncoder().encode(secret))
}

/**
 * Verifies the caller is an owner of the workspace before a credential
 * mutation. Used by the route layer to authorise create/revoke.
 */
export async function isWorkspaceOwner(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await db.query.workspaceMemberships.findFirst({
    where: and(
      eq(workspaceMemberships.userId, userId),
      eq(workspaceMemberships.workspaceId, workspaceId),
    ),
  })
  return membership?.role === 'owner'
}
