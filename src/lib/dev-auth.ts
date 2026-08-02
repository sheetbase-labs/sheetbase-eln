import { env } from '#/env.server'
import {
  DEFAULT_DEV_USER_EMAIL,
  DEV_USER_NAME,
  devUserEmail,
} from '#/lib/dev-identity'

/** Stable identity used by the disposable auth-free development environment. */
export const DEV_SESSION_ID = 'dev-auth-free-session'
export { DEFAULT_DEV_USER_EMAIL as DEV_USER_EMAIL, DEV_USER_NAME }

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
 * Auth-free access is deliberately opt-in. Ordinary development uses the
 * development flag; PR previews use their separately named demo flag. The
 * deployment validator rejects either flag in the wrong environment as a
 * second boundary against accidentally publishing an open environment.
 */
export function isDevAuthFreeEnabled(): boolean {
  return (
    (env.SHEETBASE_ENV === 'development' && env.SHEETBASE_DEV_AUTH_FREE) ||
    (env.SHEETBASE_ENV === 'preview' && env.SHEETBASE_PREVIEW_DEMO)
  )
}

export function getDevSession(): AppSession {
  return {
    user: {
      id: env.SHEETBASE_DEV_USER_ID,
      name: DEV_USER_NAME,
      email: devUserEmail(env.SHEETBASE_DEV_USER_ID),
    },
    session: { id: DEV_SESSION_ID },
  }
}
