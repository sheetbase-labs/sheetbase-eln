/**
 * Better Auth server instance. Sign-in methods activate from configuration:
 * GitHub OAuth (both credentials), company OIDC single sign-on (issuer, client
 * id and secret) and email sign-in by one-time link (EMAIL_LOGIN_ENABLED plus
 * SMTP). Without any, the handler still mounts and the sign-in screen explains
 * that sign-in is not configured (docs/operations/authentication.md).
 *
 * Two-factor (TOTP) is available to every account and enforced on email-link
 * sign-in; GitHub and OIDC sign-ins rely on the provider's own MFA.
 */
import { betterAuth } from 'better-auth'
import type { BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins/two-factor'
import { eq } from 'drizzle-orm'
import { AsyncLocalStorage } from 'node:async_hooks'

import { db } from '#/db/client.server'
import { account, session, twoFactor, user, verification } from '#/db/schema'
import { env } from '#/env.server'
import type { OidcConfig } from '#/lib/auth-methods'
import {
  OIDC_PROVIDER_ID,
  mayCreateByEmailLink,
  parseAllowedDomains,
  readAuthMethods,
  readOidcConfig,
} from '#/lib/auth-methods'
import {
  createSmtpTransport,
  readSmtpConfig,
} from '#/lib/email-delivery.server'
import {
  bootstrapWorkspaceForUser,
  joinWorkspaceByEmailDomain,
} from '#/lib/bootstrap'
import { safeNextPath } from '#/lib/sign-in-redirect'
import { getDevSession, isDevAuthFreeEnabled } from '#/lib/dev-auth'
import type { AppSession } from '#/lib/dev-auth'

const authSchema = { user, session, account, verification, twoFactor }

// Only a spent independent authorization can establish this server-only scope.
// Better Auth generates and consumes its own reset token; no token reaches HTTP,
// an administrator, an outbox, or an application-owned password implementation.
const passwordRecovery = new AsyncLocalStorage<{
  userId: string
  email: string
  redeem: (token: string) => Promise<void>
}>()

/** Seams for tests and alternative deployments; production reads configuration. */
export interface AuthDeps {
  oidc?: OidcConfig | null
  emailLink?: boolean
  emailLinkAllowedDomains?: string[]
  sendEmail?: (message: {
    to: string
    subject: string
    body: string
  }) => Promise<void>
}

async function sendConfiguredEmail(message: {
  to: string
  subject: string
  body: string
}) {
  const config = readSmtpConfig()
  if (!config) return
  await (await createSmtpTransport(config)).send(message)
}

/** TOTP is the second factor for email-link sign-in; Better Auth's own gate covers password-style paths only. */
function twoFactorWithEmailLink() {
  const plugin = twoFactorPlugin({
    issuer: 'Sheetbase',
    // Accounts with a signing credential still confirm it before changing
    // their second factor; everyone else (SSO, GitHub, email link) does not
    // have one to confirm.
    allowPasswordless: true,
    // Better Auth's own gate (attempt counter plus lock) is the throttle.
    totpOptions: { digits: 6, period: 30 },
  })
  const challenge = plugin.hooks.after[0]
  return {
    ...plugin,
    hooks: {
      after: [
        ...plugin.hooks.after,
        {
          // Magic-link verification ends in a redirect, not a JSON reply. Run
          // the standard challenge (drops the half-open session and sets the
          // challenge cookie), then send the browser to the code prompt.
          matcher: (context: { path?: string }) =>
            context.path === '/magic-link/verify',
          handler: createAuthMiddleware(async (ctx) => {
            if (!ctx.context.newSession?.user.twoFactorEnabled) return
            const held = (await challenge.handler({
              ...ctx,
              returnHeaders: true,
            })) as unknown as { headers: Headers }
            const next = safeNextPath(ctx.query?.callbackURL)
            const redirect = ctx.redirect(
              `/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`,
            )
            const headers = new Headers(redirect.headers)
            for (const cookie of held.headers.getSetCookie()) {
              headers.append('set-cookie', cookie)
            }
            redirect.headers = headers
            throw redirect
          }),
        },
      ],
    },
  }
}

export function createAuth(database: typeof db = db, deps: AuthDeps = {}) {
  const socialProviders =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}

  const oidc = deps.oidc === undefined ? readOidcConfig(env) : deps.oidc
  const emailLink =
    deps.emailLink ??
    readAuthMethods({ ...env, SMTP_HOST: process.env.SMTP_HOST }).emailLink
  const allowedDomains =
    deps.emailLinkAllowedDomains ??
    parseAllowedDomains(env.EMAIL_LOGIN_ALLOWED_DOMAINS)
  const sendEmail = deps.sendEmail ?? sendConfiguredEmail

  const plugins: BetterAuthPlugin[] = [twoFactorWithEmailLink()]
  if (oidc) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            discoveryUrl: `${oidc.issuerUrl}/.well-known/openid-configuration`,
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: ['openid', 'email', 'profile'],
            pkce: true,
            requireIdTokenVerification: true,
          },
        ],
      }),
    )
  }
  if (emailLink) {
    plugins.push(
      magicLink({
        expiresIn: 60 * 10,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          // Answer the same whether or not the address may sign in, so the
          // form never reveals who has an account. A new address is only let
          // in from an allowed domain.
          const known = await database
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, email.toLowerCase()))
            .limit(1)
          if (
            known.length === 0 &&
            !mayCreateByEmailLink(email, allowedDomains)
          ) {
            return
          }
          await sendEmail({
            to: email,
            subject: 'Your Sheetbase sign-in link',
            body: [
              'Use this link to sign in to Sheetbase. It works once and expires in 10 minutes.',
              '',
              url,
              '',
              'If you did not ask to sign in, ignore this email; nothing was changed.',
            ].join('\n'),
          })
        },
      }),
    )
  }

  return betterAuth({
    plugins,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, { provider: 'pg', schema: authSchema }),
    socialProviders,
    // SET-03.3: the session expires after this much inactivity, and any activity within the
    // refresh window pushes the expiry back. Better Auth treats `expiresIn` as an idle window
    // when `updateAge` is smaller than it, which is what an unattended workstation needs: the
    // session ends because nobody used it, not because a fixed period elapsed. Failed
    // re-authentication is locked out separately, per DEC-04 (three attempts, fifteen minutes,
    // with an audit entry), by the signing step-up boundary.
    session: {
      expiresIn: 60 * 30,
      updateAge: 60 * 5,
    },
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
          // First successful sign-up joins the lab whose email domain they
          // use, or else bootstraps a personal workspace. Failure must not
          // orphan the user: if this throws, Better Auth rolls the user
          // creation back inside its own transaction.
          after: async (createdUser) => {
            await joinWorkspaceByEmailDomain(database, createdUser.id)
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
  if (isDevAuthFreeEnabled()) return getDevSession(headers)
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

/** The sign-in methods this environment offers, for the sign-in screen. */
export function getAuthMethods() {
  return readAuthMethods({ ...env, SMTP_HOST: process.env.SMTP_HOST })
}
