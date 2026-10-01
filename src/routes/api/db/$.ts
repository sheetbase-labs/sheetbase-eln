import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { getAppSession } from '#/lib/auth'
import { resolveExternalToken } from '#/lib/external-token'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

// Same-origin data boundary: /api/db/projects → PostgREST /projects.
// Two auth paths share it:
//   - external bearer token (Authorization: Bearer <api_client jwt>),
//   - browser session (Better Auth cookies → short-lived authenticated jwt).
// The Better Auth session never reaches PostgREST directly.
//
// The shared `db` instance from client.server.ts is reused so all requests
// share a single connection pool. Creating a new Drizzle instance per request
// opens a new pg.Pool each time, which exhausts PostgreSQL max_connections
// under concurrent load (e.g. a notebook page firing 100+ API calls).
const handler = ({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}) => {
  return handleProxyRequest(request, params._splat ?? '', {
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
      const membership =
        (preference?.activeWorkspaceId
          ? memberships.find(
              (item) => item.workspaceId === preference.activeWorkspaceId,
            )
          : undefined) ?? memberships.at(0)
      return membership ? { id: membership.workspaceId } : null
    },
    mintToken: (input) => mintPostgrestToken(env.PGRST_JWT_SECRET, input),
    resolveExternalToken: (token, method, path) =>
      resolveExternalToken(db, token, env.PGRST_JWT_SECRET, method, path),
    upstreamBaseUrl: env.POSTGREST_URL,
  })
}

export const Route = createFileRoute('/api/db/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
})
