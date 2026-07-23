/**
 * Better Auth server instance. GitHub OAuth activates when both credentials
 * are configured; without them the handler still mounts and the sign-in
 * screen explains that sign-in is not configured (docs/authentication.md).
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'

import * as schema from '#/db/schema'
import { account, session, user, verification } from '#/db/schema'
import { env } from '#/env.server'
import { bootstrapWorkspaceForUser } from '#/lib/bootstrap'

const authSchema = { user, session, account, verification }

export function createAuth(databaseUrl: string) {
  const db = drizzle(databaseUrl, { schema })

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
    databaseHooks: {
      user: {
        create: {
          // First successful sign-up bootstraps the personal workspace.
          // Failure must not orphan the user: if this throws, Better Auth
          // rolls the user creation back inside its own transaction.
          after: async (createdUser) => {
            await bootstrapWorkspaceForUser(db, {
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

export const auth = createAuth(env.DATABASE_URL)

export const isGithubConfigured = Boolean(
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
)
