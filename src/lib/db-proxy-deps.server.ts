import { pickActiveMembership } from '#/lib/active-membership'
import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { resolveExternalToken } from '#/lib/external-token'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import type { ProxyDeps } from '#/lib/postgrest-proxy'

/**
 * What the data proxy needs from the app: who is signed in, which workspace
 * they work in, how to mint their short-lived PostgREST token and where
 * PostgREST is. `/api/db/*` and `/api/db-batch` both run on it, so a read
 * batched with others is authorised exactly like the same read sent alone.
 */
export const dbProxyDeps: ProxyDeps = {
  getSession: getAppSession,
  getWorkspaceForUser: async (userId) => {
    // Match `getCurrentContext`: honour the user's chosen workspace while
    // they are still a member, otherwise fall back to their first
    // membership. `findFirst` picked an arbitrary row, so the data layer
    // could scope to a different workspace than the UI context.
    const [preference, memberships] = await Promise.all([
      db.query.userPreferences.findFirst({
        where: eq(schema.userPreferences.userId, userId),
      }),
      db.query.workspaceMemberships.findMany({
        where: eq(schema.workspaceMemberships.userId, userId),
      }),
    ])

    const membership = pickActiveMembership(
      memberships,
      preference?.activeWorkspaceId,
    )

    return membership && !membership.suspendedAt
      ? { id: membership.workspaceId }
      : null
  },
  mintToken: (input) => mintPostgrestToken(env.PGRST_JWT_SECRET, input),
  resolveExternalToken: (token, method, path) =>
    resolveExternalToken(db, token, env.PGRST_JWT_SECRET, method, path),
  upstreamBaseUrl: env.POSTGREST_URL,
  guardWrite: async (input) => {
    // Loaded on the first write, so a lab with no plugin hooks pays for nothing.
    const { guardRecordWrite } =
      await import('#/lib/extensions/record-hooks.server')

    return guardRecordWrite(input)
  },
}
