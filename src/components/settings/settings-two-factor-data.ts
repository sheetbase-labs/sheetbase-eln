import { createServerFn } from '@tanstack/react-start'

export const twoFactorQueryKey = ['two-factor-status'] as const

/**
 * Whether the caller has two-factor on, and whether this deployment can offer it
 * at all. The auth-free development identity has no sign-in to protect, so the
 * panel says that instead of offering a control that cannot work.
 */
export interface TwoFactorStatus {
  available: boolean
  enabled: boolean
  /** Whether the account has a signing password, which enrolment then asks for. */
  needsPassword: boolean
  /** Whether an emailed sign-in link is offered, which is what two-factor protects. */
  emailLinkEnabled: boolean
}

export const getTwoFactorStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TwoFactorStatus> => {
    const [
      { getRequestHeaders },
      { getAppSession, getAuthMethods, isDevAuthFreeEnabled },
      { and, eq, isNotNull },
      { db },
      { account, user },
    ] = await Promise.all([
      import('@tanstack/react-start/server'),
      import('#/lib/auth'),
      import('drizzle-orm'),
      import('#/db/client.server'),
      import('#/db/schema'),
    ])

    const appSession = await getAppSession(getRequestHeaders())

    if (!appSession) throw new Error('Your session has ended. Sign in again.')
    const emailLinkEnabled = getAuthMethods().emailLink

    if (isDevAuthFreeEnabled()) {
      return {
        available: false,
        enabled: false,
        needsPassword: false,
        emailLinkEnabled,
      }
    }

    const [[row], credentials] = await Promise.all([
      db
        .select({ enabled: user.twoFactorEnabled })
        .from(user)
        .where(eq(user.id, appSession.user.id))
        .limit(1),
      db
        .select({ id: account.id })
        .from(account)
        .where(
          and(
            eq(account.userId, appSession.user.id),
            eq(account.providerId, 'credential'),
            isNotNull(account.password),
          ),
        )
        .limit(1),
    ])

    return {
      available: true,
      enabled: row.enabled,
      needsPassword: credentials.length > 0,
      emailLinkEnabled,
    }
  },
)
