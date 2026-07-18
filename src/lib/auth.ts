/**
 * Better Auth server instance. GitHub OAuth activates when both credentials
 * are configured; without them the handler still mounts and the sign-in
 * screen explains that sign-in is not configured (docs/authentication.md).
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'

import { account, session, user, verification } from '#/db/schema'
import { env } from '#/env.server'

const authSchema = { user, session, account, verification }

export function createAuth(databaseUrl: string) {
  const db = drizzle(databaseUrl)

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
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    socialProviders,
    advanced: {
      // Secure cookies only where HTTPS exists; SameSite=Lax allows the
      // OAuth callback round-trip while blocking cross-site POSTs.
      useSecureCookies: process.env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },
    onAPIError: {
      // Callback and provider failures land on the sign-in screen, which
      // maps the error to an understandable recovery message.
      errorURL: '/sign-in',
    },
  })
}

export const auth = createAuth(env.DATABASE_URL)

export const isGithubConfigured = Boolean(
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
)
