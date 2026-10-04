/**
 * Better Auth server instance. GitHub OAuth activates when both credentials
 * are configured; without them the handler still mounts and the sign-in
 * screen explains that sign-in is not configured (docs/operations/authentication.md).
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { AsyncLocalStorage } from 'node:async_hooks'

import { db } from '#/db/client.server'
import { account, session, user, verification } from '#/db/schema'
import { env } from '#/env.server'
import { bootstrapWorkspaceForUser } from '#/lib/bootstrap'
import { getDevSession, isDevAuthFreeEnabled } from '#/lib/dev-auth'
import type { AppSession } from '#/lib/dev-auth'

const authSchema = { user, session, account, verification }

// Only a spent independent authorization can establish this server-only scope.
// Better Auth generates and consumes its own reset token; no token reaches HTTP,
// an administrator, an outbox, or an application-owned password implementation.
const passwordRecovery = new AsyncLocalStorage<{
  userId: string
  email: string
  redeem: (token: string) => Promise<void>
}>()

export function createAuth(database: typeof db = db) {
  const socialProviders =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, { provider: 'pg', schema: authSchema }),
    socialProviders,
    emailAndPassword: {
      enabled: false,
      resetPasswordTokenExpiresIn: 300,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: target, token }) => {
        const operation = passwordRecovery.getStore()
        if (
          !operation ||
          operation.userId !== target.id ||
          operation.email !== target.email
        ) {
          throw new Error(
            'Independent password recovery authorization required',
          )
        }
        await operation.redeem(token)
      },
    },
    // Signing credentials use the governed enrollment/step-up boundary.
    // Better Auth still mounts verification and password writes when email
    // sign-in is disabled; direct HTTP calls would bypass those gates.
    // Its trusted server APIs remain available to that boundary.
    disabledPaths: [
      '/verify-password',
      '/change-password',
      '/request-password-reset',
      '/reset-password',
      '/sign-in/email',
      '/sign-up/email',
    ],
    databaseHooks: {
      user: {
        create: {
          // First successful sign-up bootstraps the personal workspace.
          // Failure must not orphan the user: if this throws, Better Auth
          // rolls the user creation back inside its own transaction.
          after: async (createdUser) => {
            await bootstrapWorkspaceForUser(database, {
              id: createdUser.id,
              name: createdUser.name,
            })
          },
        },
      },
    },
    advanced: {
      // app.sheetbase.co.uk serves HTTPS via Cloudflare Tunnel. The GitHub
      // OAuth callback is a cross-site top-level navigation, so the state
      // cookie needs SameSite=None + Secure to survive the redirect.
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
      },
    },
    onAPIError: {
      // Callback and provider failures land on the sign-in screen, which
      // maps the error to an understandable recovery message.
      errorURL: '/sign-in',
    },
  })
}

export const auth = createAuth()

/** Call only after the independently authorized OOB grant has been committed spent. */
export async function recoverSigningPassword(
  input: { userId: string; email: string; newPassword: string },
  instance = auth,
): Promise<void> {
  const outcome = { completed: false }
  await passwordRecovery.run(
    {
      userId: input.userId,
      email: input.email,
      redeem: async (token) => {
        await instance.api.resetPassword({
          body: { token, newPassword: input.newPassword },
        })
        outcome.completed = true
      },
    },
    async () => {
      await instance.api.requestPasswordReset({ body: { email: input.email } })
    },
  )
  if (!outcome.completed) throw new Error('Password recovery did not complete')
}

/** HTTP-only guard: disabledPaths cannot match a dynamic reset-token path. */
export function handleAuthRequest(
  request: Request,
  instance: Pick<typeof auth, 'handler'> = auth,
): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname).replace(
      /\/+/g,
      '/',
    )
  } catch {
    return Promise.resolve(new Response(null, { status: 404 }))
  }
  if (pathname.startsWith('/api/auth/reset-password/')) {
    return Promise.resolve(new Response(null, { status: 404 }))
  }
  return instance.handler(request)
}

/**
 * Resolve the application session, or the fixed seeded development identity
 * when the explicitly opt-in auth-free mode is active.
 */
export async function getAppSession(
  headers: Headers,
): Promise<AppSession | null> {
  if (isDevAuthFreeEnabled()) return getDevSession()
  const appSession = await auth.api.getSession({ headers })
  if (!appSession) return null
  return {
    user: {
      id: appSession.user.id,
      name: appSession.user.name,
      email: appSession.user.email,
    },
    session: { id: appSession.session.id },
  }
}

export { isDevAuthFreeEnabled }
export const isGithubConfigured = Boolean(
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
)
