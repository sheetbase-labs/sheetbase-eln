/**
 * Mints the short-lived JWT PostgREST receives for an authenticated browser
 * request. Server-only: the signing secret never leaves the server.
 *
 * Claim set is deliberately minimal (see docs/database-access.md):
 * - sub: Better Auth user id
 * - workspace_id: the caller's active workspace
 * - session_id: Better Auth session id (revocation handle)
 * - role: the PostgreSQL request role PostgREST switches to
 * - iat/exp: short lifetime; minted per proxied request
 */
import { SignJWT } from 'jose'

export interface PostgrestClaimsInput {
  userId: string
  workspaceId: string
  sessionId: string
  /** Seconds until expiry. Keep short; tokens are minted per request. */
  ttlSeconds?: number
}

export async function mintPostgrestToken(
  secret: string,
  input: PostgrestClaimsInput,
): Promise<string> {
  const ttl = input.ttlSeconds ?? 120
  return await new SignJWT({
    sub: input.userId,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(new TextEncoder().encode(secret))
}
