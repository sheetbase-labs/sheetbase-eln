import { createServerFn } from '@tanstack/react-start'

/**
 * SET-03.2 — the caller's own sessions.
 *
 * Better Auth's HTTP `list-sessions` endpoint only knows about sessions it
 * minted, so an auth-free development deployment (fixed `SHEETBASE_DEV_USER_ID`
 * identity, no cookie) always gets a 401. This runs on the server instead, so
 * the panel can report the one session the development identity has and can
 * list real sessions once sign-in is configured.
 */
export interface MySession {
  id: string
  /** Absent for a deployment-identity session, which cannot be revoked. */
  token: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
  current: boolean
}

export const listMySessionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MySession[]> => {
    // Loaded inside the handler: `#/lib/auth` reads server-only env and the DB
    // client, and a static import would pull it into the browser bundle.
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getAppSession, isDevAuthFreeEnabled } = await import('#/lib/auth')
    const headers = getRequestHeaders()
    const appSession = await getAppSession(headers)
    if (!appSession) {
      throw new Error('Your session has ended. Sign in to manage your devices.')
    }
    if (isDevAuthFreeEnabled()) {
      // The fixed development identity has exactly one session and no sign-out
      // target, so it is reported as this device rather than invented history.
      const now = new Date()
      return [
        {
          id: appSession.session.id,
          token: null,
          ipAddress: null,
          userAgent: null,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
          current: true,
        },
      ]
    }
    const { auth } = await import('#/lib/auth')
    const sessions = await auth.api.listSessions({ headers })
    return sessions.map((session) => ({
      id: session.id,
      token: session.token,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      current: session.id === appSession.session.id,
    }))
  },
)
