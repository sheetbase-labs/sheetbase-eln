/**
 * Mints the short-lived JWT PostgREST receives for an authenticated browser
 * request. Server-only: the signing secret never leaves the server.
 *
 * Claim set is deliberately minimal (see docs/database-access.md):
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
    .sign(new TextEncoder().encode(secret))
}
