/**
 * Scoped external API credentials. Credentials live in
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
import { isValidScope } from '#/lib/api-credential-scopes'
import type { Scope } from '#/lib/api-credential-scopes'

export type { Scope } from '#/lib/api-credential-scopes'
export {
  isValidScope,
  SCOPE_GROUPS,
  VALID_SCOPES,
} from '#/lib/api-credential-scopes'

export type Db = NodePgDatabase<typeof schema>

/**
 * Credential kinds. A `service` credential is the workspace service identity
 * (role `api_client`, no user id). A `personal` token acts as its creating
 * member (role `authenticated` with a real `sub`), inheriting member RLS —
 * including GOV-01 viewer read-only — under the same canonical scopes and
 * the same fail-closed external allowlist.
 */
export type CredentialKind = 'service' | 'personal'

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
  kind: CredentialKind
}

export interface CredentialRecord {
  id: string
  workspaceId: string
  kind: CredentialKind
  displayPrefix: string
  name: string
  scopes: Scope[]
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date | null
  createdByUserId: string
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

function assertIssuableScopes(scopes: readonly string[]): Scope[] {
  if (scopes.length === 0) {
    throw new CredentialError(
      'invalid_scope',
      'At least one scope is required.',
    )
  }
  const issued: Scope[] = []
  for (const scope of scopes) {
    if (!isValidScope(scope)) {
      throw new CredentialError('invalid_scope', `Unknown scope: ${scope}`)
    }
    issued.push(scope)
  }
  return issued
}

/**
 * Creates a credential. The full secret is returned exactly once; only the
 * hash and display prefix are stored. Scopes must be the canonical API-01
 * vocabulary.
 */
export async function createCredential(
  db: Db,
  input: {
    workspaceId: string
    createdByUserId: string
    name: string
    scopes: readonly string[]
    expiresAt?: Date | null
    kind?: CredentialKind
  },
): Promise<CreatedCredential> {
  const name = input.name.trim()
  if (!name) {
    throw new Error('Name is required.')
  }
  const kind: CredentialKind = input.kind ?? 'service'
  const scopes = assertIssuableScopes(input.scopes)
  const expiresAt = input.expiresAt ?? null
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new CredentialError('expired', 'Expiry must be in the future.')
  }

  return await db.transaction(async (tx) => {
    // Generate a unique prefix (collision is astronomically unlikely but the
    // unique constraint is the backstop).
    let prefix = generatePrefix()
    const secret = generateSecret()
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await tx.query.apiCredentials.findFirst({
        where: eq(apiCredentials.displayPrefix, prefix),
      })
      if (!existing) break
      prefix = generatePrefix()
    }

    const [row] = await tx
      .insert(apiCredentials)
      .values({
        workspaceId: input.workspaceId,
        kind,
        displayPrefix: prefix,
        secretHash: hashSecret(prefix, secret),
        name,
        scopes,
        createdByUserId: input.createdByUserId,
        expiresAt,
      })
      .returning({ id: apiCredentials.id })

    // The insert returning() always yields a row for a successful insert;
    // a failure throws before this point.
    return {
      id: row.id,
      secret: buildCredentialString(prefix, secret),
      displayPrefix: prefix,
      name,
      scopes,
      kind,
    }
  })
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
    kind: row.kind as CredentialKind,
    displayPrefix: row.displayPrefix,
    name: row.name,
    scopes: row.scopes as Scope[],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
    createdByUserId: row.createdByUserId,
  }))
}

/** Revokes a credential. Revocation is immediate and permanent. */
export async function revokeCredential(
  db: Db,
  input: {
    workspaceId: string
    credentialId: string
  },
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

/**
 * Issues a replacement credential with the same scopes and expiry, then
 * revokes the previous one. Rotation never adds, drops, or substitutes a
 * scope or kind. If the stored scopes are not a non-empty canonical set, it
 * fails. Callers pair this with create(new) / revoke(old) activity events;
 * emit them on the transaction running this call so the rotation cannot
 * land without its audit trail.
 */
export async function rotateCredential(
  db: Db,
  input: {
    workspaceId: string
    credentialId: string
    createdByUserId: string
  },
): Promise<CreatedCredential> {
  return await db.transaction(async (tx) => {
    const existing = await tx.query.apiCredentials.findFirst({
      where: and(
        eq(apiCredentials.id, input.credentialId),
        eq(apiCredentials.workspaceId, input.workspaceId),
      ),
    })
    if (!existing) {
      throw new CredentialError('invalid_credential', 'Credential not found.')
    }
    if (existing.revokedAt) {
      throw new CredentialError('revoked', 'Credential has been revoked.')
    }
    if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
      throw new CredentialError('expired', 'Credential has expired.')
    }

    const scopes = assertIssuableScopes(existing.scopes)

    const created = await createCredential(tx, {
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      name: existing.name,
      scopes,
      expiresAt: existing.expiresAt,
      kind: existing.kind as CredentialKind,
    })
    await revokeCredential(tx, {
      workspaceId: input.workspaceId,
      credentialId: existing.id,
    })
    return created
  })
}

export type ExchangeErrorCode =
  | 'invalid_credential'
  | 'revoked'
  | 'expired'
  | 'insufficient_scope'
  | 'rate_limited'

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
    /** Service credentials mint api_client; personal tokens act as userId. */
    kind: CredentialKind
    /** The acting member for a personal token (the credential creator). */
    userId?: string
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
  requiredScopes: readonly string[],
  deps: ExchangeDeps,
): Promise<string> {
  const parsed = parseCredentialString(rawSecret)
  if (!parsed) {
    throw new CredentialError('invalid_credential', 'Invalid credential.')
  }

  const requested = assertIssuableScopes(requiredScopes)

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

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new CredentialError('expired', 'Credential has expired.')
  }

  // A personal token acts as its creating member, so it is only usable while
  // that membership is active. Removing or suspending the member stops the
  // token at exchange even though the credential row itself is untouched.
  // Service credentials keep working on the workspace binding alone.
  if (row.kind === 'personal') {
    const member = await db.query.workspaceMemberships.findFirst({
      where: and(
        eq(workspaceMemberships.userId, row.createdByUserId),
        eq(workspaceMemberships.workspaceId, row.workspaceId),
      ),
    })
    if (!member || member.suspendedAt) {
      throw new CredentialError(
        'revoked',
        'Credential is not currently usable.',
      )
    }
  }

  for (const required of requested) {
    if (!row.scopes.includes(required)) {
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
    scopes: requested,
    kind: row.kind as CredentialKind,
    userId: row.kind === 'personal' ? row.createdByUserId : undefined,
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
 * Mints the short-lived PostgREST JWT for a personal token. A personal token
 * acts as its creating member: the claim set is the browser-session shape
 * (role `authenticated`, real `sub`) plus `credential_id` and `scopes`, so
 * member RLS — including GOV-01 viewer read-only — and human attribution
 * apply, while the proxy still enforces the same canonical allowlist.
 *
 * Deliberately has no `session_id` claim: attestation RPCs that require a
 * live human session stay unusable (they are not on the allowlist either),
 * and there is no revocable browser session behind a token.
 */
export async function mintPersonalApiToken(
  secret: string,
  input: {
    workspaceId: string
    credentialId: string
    userId: string
    scopes: Scope[]
    ttlSeconds?: number
  },
): Promise<string> {
  const ttl = input.ttlSeconds ?? 300
  return await new SignJWT({
    sub: input.userId,
    workspace_id: input.workspaceId,
    credential_id: input.credentialId,
    scopes: input.scopes,
    kind: 'personal',
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(new TextEncoder().encode(secret))
}

/**
 * Verifies the caller is an owner of the workspace before a credential
 * mutation. Used by the route layer to authorise create/revoke/rotate.
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
  return membership?.role === 'owner' && !membership.suspendedAt
}

/** True when the user is a non-suspended member of the workspace. */
export async function isWorkspaceMember(
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
  return Boolean(membership && !membership.suspendedAt)
}
