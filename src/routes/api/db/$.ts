import { createFileRoute } from '@tanstack/react-router'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { auth } from '#/lib/auth'
import { resolveExternalToken } from '#/lib/external-token'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

// Same-origin data boundary: /api/db/projects → PostgREST /projects.
// Two auth paths share it:
//   - external bearer token (Authorization: Bearer <api_client jwt>),
//   - browser session (Better Auth cookies → short-lived authenticated jwt).
// The Better Auth session never reaches PostgREST directly.
const handler = ({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}) => {
  const db = drizzle(env.DATABASE_URL, { schema })
  return handleProxyRequest(request, params._splat ?? '', {
    getSession: (headers) => auth.api.getSession({ headers }),
    getWorkspaceForUser: async (userId) => {
      const membership = await db.query.workspaceMemberships.findFirst({
        where: eq(schema.workspaceMemberships.userId, userId),
      })
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
