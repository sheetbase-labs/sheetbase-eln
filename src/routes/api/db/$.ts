import { createFileRoute } from '@tanstack/react-router'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { auth } from '#/lib/auth'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

// Same-origin data boundary: /api/db/projects → PostgREST /projects.
// The application session is verified here and exchanged for a short-lived
// PostgREST JWT; Better Auth cookies never reach PostgREST.
const handler = ({ request, params }: { request: Request; params: { _splat?: string } }) =>
  handleProxyRequest(request, params._splat ?? '', {
    getSession: (headers) => auth.api.getSession({ headers }),
    getWorkspaceForUser: async (userId) => {
      const db = drizzle(env.DATABASE_URL, { schema })
      const membership = await db.query.workspaceMemberships.findFirst({
        where: eq(schema.workspaceMemberships.userId, userId),
      })
      return membership ? { id: membership.workspaceId } : null
    },
    mintToken: (input) => mintPostgrestToken(env.PGRST_JWT_SECRET, input),
    upstreamBaseUrl: env.POSTGREST_URL,
  })

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
