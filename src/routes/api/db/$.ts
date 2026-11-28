import { createFileRoute } from '@tanstack/react-router'

import { dbProxyDeps } from '#/lib/db-proxy-deps.server'
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
}) => handleProxyRequest(request, params._splat ?? '', dbProxyDeps)

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
