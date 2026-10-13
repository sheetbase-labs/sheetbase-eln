/** Shared identity rules for the disposable, auth-free development surface. */
export const DEFAULT_DEV_USER_ID = '00000000-0000-4000-8000-000000000001'
export const DEV_USER_NAME = 'Fixture Owner'
export const DEFAULT_DEV_USER_EMAIL = 'owner@sheetbase.test'

/**
 * The session the auth-free development surface presents on every request.
 * Session-gated RPCs (submission, signing) look the id up in
 * `internal.session`, so the development seed has to carry the matching row —
 * see `fixtureSteps` in `src/db/seed/run.ts`.
 */
export const DEV_SESSION_ID = 'dev-auth-free-session'

export function resolveDevUserId(configuredId?: string): string {
  return configuredId?.trim() || DEFAULT_DEV_USER_ID
}

/**
 * Keep custom development identities from colliding with the stable fixture
 * email. The default remains the familiar fixture identity.
 */
export function devUserEmail(userId: string): string {
  if (userId === DEFAULT_DEV_USER_ID) return DEFAULT_DEV_USER_EMAIL
  return `owner+${userId.replaceAll('-', '').slice(0, 12)}@sheetbase.test`
}

export function resolveDevUserIdentity(configuredId?: string) {
  const id = resolveDevUserId(configuredId)
  return { id, name: DEV_USER_NAME, email: devUserEmail(id) }
}
