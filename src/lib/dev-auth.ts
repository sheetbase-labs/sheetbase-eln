import { env } from '#/env.server'

/** Stable identity used by the disposable auth-free development environment. */
export const DEV_SESSION_ID = 'dev-auth-free-session'
export const DEV_USER_NAME = 'Fixture Owner'
export const DEV_USER_EMAIL = 'owner@sheetbase.test'

export interface AppSession {
  user: {
    id: string
    name: string
    email: string
  }
  session: {
    id: string
  }
}

/**
 * Auth-free access is deliberately opt-in and development-only. The
 * deployment validator rejects the flag in staging and production as a
 * second boundary against accidentally publishing an open environment.
 */
export function isDevAuthFreeEnabled(): boolean {
  return env.SHEETBASE_ENV === 'development' && env.SHEETBASE_DEV_AUTH_FREE
}

export function getDevSession(): AppSession {
  return {
    user: {
      id: env.SHEETBASE_DEV_USER_ID,
      name: DEV_USER_NAME,
      email: DEV_USER_EMAIL,
    },
    session: { id: DEV_SESSION_ID },
  }
}
