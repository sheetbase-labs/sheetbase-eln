import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { user } from '#/db/schema'
import { env } from '#/env.server'
import {
  DEFAULT_DEV_USER_EMAIL,
  DEV_SESSION_ID,
  DEV_USER_NAME,
  devUserEmail,
} from '#/lib/dev-identity'

/** Stable identity used by the disposable auth-free development environment. */
export { DEV_SESSION_ID }
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
 * Auth-free access is deliberately opt-in for the disposable development
 * surface. The deployment validator rejects this flag outside development
 * as a second boundary against accidentally publishing an open environment.
 */
export function isDevAuthFreeEnabled(): boolean {
  return env.SHEETBASE_ENV === 'development' && env.SHEETBASE_DEV_AUTH_FREE
}

/**
 * The display name for the configured development identity. The app chrome and
 * the data-driven surfaces must name the same person the same way, so read the
 * name from the same `internal.user` row the RPCs resolve; an identity with no
 * row keeps the documented placeholder.
 */
async function devDisplayName(userId: string): Promise<string> {
  const row = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { name: true },
  })
  return row?.name.trim() || DEV_USER_NAME
}

export async function getDevSession(): Promise<AppSession> {
  const id = env.SHEETBASE_DEV_USER_ID
  return {
    user: {
      id,
      name: await devDisplayName(id),
      email: devUserEmail(id),
    },
    session: { id: DEV_SESSION_ID },
  }
}
