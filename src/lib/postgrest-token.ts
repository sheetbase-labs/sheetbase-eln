/**
 * Mints the short-lived JWT PostgREST receives for an authenticated browser
 * request. Server-only: the signing secret never leaves the server.
 *
 * Claim set is deliberately minimal (see docs/development/database-access.md):
 * - sub: Better Auth user id
 * - workspace_id: the caller's active workspace
 * - session_id: Better Auth session id (revocation handle)
 * - client_id: tab-scoped client id (LIVE-003) so durable change events
 *   record which tab emitted them; null when the browser did not send one
 * - role: the PostgreSQL request role PostgREST switches to
 * - iat/exp: short lifetime; minted per proxied request
 */
import { SignJWT } from 'jose'

export interface PostgrestClaimsInput {
  userId: string
  workspaceId: string
  sessionId: string
  /** Tab-scoped client id for live-event reconciliation (LIVE-003). */
  clientId?: string | null
  /** Seconds until expiry. Keep short; tokens are minted per request. */
  ttlSeconds?: number
}

// A token is minted for every proxied request. Handing jose the raw secret
// makes it import a fresh WebCrypto HMAC key on each sign, so the imported key
// is kept instead. Deployments use one secret; the cache is keyed by value so
// a different secret (tests, rotation) still signs with the right key.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null

function signingKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    // A failed import must not be remembered.
    key.catch(() => {
      if (cachedKey?.key === key) cachedKey = null
    })
    cachedKey = { secret, key }
  }
  return cachedKey.key
}

export async function mintPostgrestToken(
  secret: string,
  input: PostgrestClaimsInput,
): Promise<string> {
  const ttl = input.ttlSeconds ?? 120
  const claims: Record<string, unknown> = {
    sub: input.userId,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    role: 'authenticated',
  }
  if (input.clientId) {
    claims.client_id = input.clientId
  }
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(await signingKey(secret))
}
