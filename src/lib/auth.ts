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
import { authOutcome } from './auth-outcome'
import { logger } from './logger'
import { annotateRequest } from './request-log'
import { passkey as passkeyPlugin } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import type { BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { sso } from '@better-auth/sso'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins/two-factor'
import { eq, sql } from 'drizzle-orm'
import { AsyncLocalStorage } from 'node:async_hooks'

import { db } from '#/db/client.server'
import {
  account,
  passkey,
  session,
  ssoProvider,
  twoFactor,
  user,
  verification,
} from '#/db/schema'
import { env } from '#/env.server'
import type { OidcConfig, SamlConfig } from '#/lib/auth-methods'
import {
  OIDC_PROVIDER_ID,
  SAML_PROVIDER_ID,
  mayCreateByEmailLink,
  parseAllowedDomains,
  readAuthMethods,
  readOidcConfig,
  readSamlConfig,
} from '#/lib/auth-methods'
import { applyIdpGroups } from '#/lib/idp-groups.server'
import { samlPluginOptions } from '#/lib/saml-config'
import {
  createSmtpTransport,
  readSmtpConfig,
} from '#/lib/email-delivery.server'
import {
  bootstrapWorkspaceForUser,
  joinWorkspaceByEmailDomain,
} from '#/lib/bootstrap'
import { safeNextPath } from '#/lib/sign-in-redirect'
import {
  DEFAULT_GROUPS_CLAIM,
  groupsFromProfile,
  holdGroups,
  takeGroups,
} from '#/lib/idp-groups'
import {
  REGULATED_IDLE_SECONDS,
  WORKING_DAY_IDLE_SECONDS,
  sessionIdleSeconds,
} from '#/lib/session-idle'
import { getDevSession, isDevAuthFreeEnabled } from '#/lib/dev-auth'
import type { AppSession } from '#/lib/dev-auth'

const authSchema = {
  user,
  session,
  account,
  verification,
  twoFactor,
  passkey,
  ssoProvider,
}

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
  saml?: SamlConfig | null
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

  const plugins: BetterAuthPlugin[] = [
    twoFactorWithEmailLink(),
    // Passkeys belong to the address people reach the app on, so the relying
    // party is that address's host and the only accepted origin is its origin.
    passkeyPlugin({
      rpID: new URL(env.BETTER_AUTH_URL).hostname,
      rpName: 'Sheetbase',
      origin: new URL(env.BETTER_AUTH_URL).origin,
    }),
  ]
  if (oidc) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            discoveryUrl: `${oidc.issuerUrl}/.well-known/openid-configuration`,
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: ['openid', 'email', 'profile', ...(oidc.extraScopes ?? [])],
            pkce: true,
            requireIdTokenVerification: true,
            // Groups come with the profile and are applied once the sign-in
            // has a person to apply them to (the after hook below).
            mapProfileToUser: (profile) => {
              const groups = groupsFromProfile(
                profile,
                oidc.groupsClaim ?? DEFAULT_GROUPS_CLAIM,
              )
              if (groups && typeof profile.email === 'string') {
                holdGroups(profile.email, groups)
              }
              return {}
            },
          },
        ],
      }),
    )
  }
  const saml = deps.saml === undefined ? readSamlConfig(env) : deps.saml
  if (saml) {
    plugins.push(
      sso(
        samlPluginOptions(saml, {
          baseUrl: env.BETTER_AUTH_URL,
          // Groups come with the assertion; apply them once the person exists.
          // Never allowed to fail the sign-in itself.
          applyGroups: (userId, groups) =>
            applyIdpGroups(database, userId, groups),
        }),
      ),
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
    // Better Auth's own diagnostics go through the shared logger so they carry
    // the same redaction, level and request correlation as everything else.
    logger: {
      level: 'warn',
      log: (level, message) => {
        logger[level]('better-auth', { detail: message })
      },
    },
    hooks: {
      // One line of context on every auth call: which flow, and how it ended.
      after: createAuthMiddleware(async (ctx) => {
        // Single sign-on groups decide roles in the workspaces that map them.
        // Never allowed to fail the sign-in itself.
        if (
          ctx.path.startsWith('/callback/') &&
          ctx.params?.id === OIDC_PROVIDER_ID &&
          ctx.context.newSession
        ) {
          const { id, email } = ctx.context.newSession.user
          const groups = takeGroups(email)
          if (groups) await applyIdpGroups(database, id, groups)
        }
        // Adding or removing a passkey is announced to the person's
        // workspaces (webhooks, activity). Never allowed to fail the call.
        if (
          ctx.path === '/passkey/verify-registration' ||
          ctx.path === '/passkey/delete-passkey'
        ) {
          try {
            const result: unknown = ctx.context.returned
            const failed =
              result instanceof Error ||
              (typeof result === 'object' &&
                result !== null &&
                'statusCode' in result)
            const added = ctx.path === '/passkey/verify-registration'
            const body = (ctx.body ?? {}) as { id?: unknown }
            const made = (
              typeof result === 'object' && result !== null ? result : {}
            ) as { id?: unknown; name?: unknown; userId?: unknown }
            const userId = ctx.context.session?.user.id ?? made.userId
            const passkeyId = added ? made.id : body.id
            if (
              !failed &&
              typeof userId === 'string' &&
              typeof passkeyId === 'string'
            ) {
              await database.execute(
                sql`select internal.record_passkey_event(${userId}, ${added ? 'added' : 'removed'}, ${passkeyId}, ${typeof made.name === 'string' ? made.name : null})`,
              )
            }
          } catch (error) {
            logger.warn('passkey event could not be recorded', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        const returned: unknown = ctx.context.returned
        annotateRequest({
          auth_flow: {
            path: ctx.path,
            outcome: authOutcome(returned),
          },
          ...(ctx.context.newSession
            ? { user: { id: ctx.context.newSession.user.id } }
            : {}),
        })
      }),
    },
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
    // The idle window follows the lab: 30 minutes when the person belongs to a regulated lab,
    // a working day otherwise (`sessionIdleSeconds`). Better Auth is configured with the long
    // window and the hooks below shorten it, so a regulated session keeps exactly the expiry
    // it always had.
    session: {
      expiresIn: WORKING_DAY_IDLE_SECONDS,
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
      // Sign-in providers are set in configuration, never registered by a
      // signed-in person: these would let anyone add an identity provider.
      '/sso/register',
      '/sso/providers',
      '/sso/get-provider',
      '/sso/update-provider',
      '/sso/delete-provider',
      '/sso/request-domain-verification',
      '/sso/verify-domain',
      '/verify-password',
      '/change-password',
      '/request-password-reset',
      '/reset-password',
      '/sign-in/email',
      '/sign-up/email',
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (created) => ({
            data: {
              ...created,
              expiresAt: new Date(
                Date.now() +
                  (await sessionIdleSeconds(database, created.userId)) * 1000,
              ),
            },
          }),
        },
        update: {
          // A refresh pushes the expiry back by the idle window; keep it the lab's window.
          // The refresh does not name the person, so read them from the session being
          // refreshed, and fall back to the short window when that is not known.
          before: async (changes, context) => {
            const refreshed = (
              context?.context as
                { session?: { session?: { userId?: string } } } | undefined
            )?.session?.session
            if (!(changes as { expiresAt?: unknown }).expiresAt) return
            const seconds = refreshed?.userId
              ? await sessionIdleSeconds(database, refreshed.userId)
              : REGULATED_IDLE_SECONDS
            return {
              data: {
                ...changes,
                expiresAt: new Date(Date.now() + seconds * 1000),
              },
            }
          },
        },
      },
      user: {
        create: {
          // A SAML sign-in may only create an account for an address in the
          // domains the provider speaks for. Runs in the same transaction as
          // the sign-in, so a refusal leaves nothing behind.
          before: async (created, context) => {
            const path = (context as { path?: string } | null | undefined)?.path
            if (!saml || !path?.startsWith('/sso/saml2/sp/acs/')) return
            if (!mayCreateByEmailLink(created.email, saml.emailDomains)) {
              throw new APIError('FORBIDDEN', {
                code: 'saml_domain_not_allowed',
                message: 'That address is not one this sign-in speaks for.',
              })
            }
          },
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

/**
 * Single sign-on routes the plugin mounts that a configured identity provider
 * needs: starting a sign-in with the configured provider, its response
 * address and our metadata. Everything else under `/sso` stays closed, and
 * every route answers only for the one provider in configuration.
 */
async function isAllowedSsoRequest(
  request: Request,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/auth/sign-in/sso') {
    if (request.method !== 'POST') return false
    try {
      const body: unknown = await request.clone().json()
      return (
        typeof body === 'object' &&
        body !== null &&
        (body as { providerId?: unknown }).providerId === SAML_PROVIDER_ID
      )
    } catch {
      return false
    }
  }
  if (!pathname.startsWith('/api/auth/sso/')) return true
  if (pathname === '/api/auth/sso/saml2/sp/acs/' + SAML_PROVIDER_ID) {
    return request.method === 'POST'
  }
  if (pathname === '/api/auth/sso/saml2/sp/metadata') {
    return (
      request.method === 'GET' &&
      new URL(request.url).searchParams.get('providerId') === SAML_PROVIDER_ID
    )
  }
  return false
}

/** HTTP-only guard: disabledPaths cannot match a dynamic reset-token path. */
export async function handleAuthRequest(
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
    return new Response(null, { status: 404 })
  }
  if (pathname.startsWith('/api/auth/reset-password/')) {
    return new Response(null, { status: 404 })
  }
  if (!(await isAllowedSsoRequest(request, pathname))) {
    return new Response(null, { status: 404 })
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
  if (isDevAuthFreeEnabled()) {
    const devSession = await getDevSession(headers)
    annotateRequest({ user: { id: devSession.user.id } })
    return devSession
  }
  const appSession = await auth.api.getSession({ headers })
  if (!appSession) return null
  annotateRequest({ user: { id: appSession.user.id } })
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
