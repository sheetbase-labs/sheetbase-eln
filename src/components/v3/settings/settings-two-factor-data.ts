import { createServerFn } from '@tanstack/react-start'

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
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getAppSession, getAuthMethods, isDevAuthFreeEnabled } =
      await import('#/lib/auth')
    const { and, eq, isNotNull } = await import('drizzle-orm')
    const { db } = await import('#/db/client.server')
    const { account, user } = await import('#/db/schema')

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
