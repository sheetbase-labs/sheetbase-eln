import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '#/db/schema'
import { env } from '#/env.server'
import { auth } from '#/lib/auth'
import { handleSseRequest } from '#/lib/sse-events'
import { readChangeEvents, subscribeToChangeEvents } from '#/lib/sse-subscribe'

/**
 * LIVE-002: authenticated, workspace-scoped SSE endpoint at /api/events.
 * Replays durable change events after `Last-Event-ID` and then streams
 * live events as they are emitted. See src/lib/sse-events.ts for the
 * handler contract and src/lib/sse-subscribe.ts for the real deps.
 *
 * The browser's native `EventSource` reconnect carries the resume cursor
 * in `Last-Event-ID` automatically; no client-side state is required.
 */
const handler = ({ request }: { request: Request }) => {
  const db = drizzle(env.DATABASE_URL, { schema })
  return handleSseRequest(request, {
    getSession: (headers) => auth.api.getSession({ headers }),
    getWorkspaceForUser: async (userId) => {
      const membership = await db.query.workspaceMemberships.findFirst({
        where: eq(schema.workspaceMemberships.userId, userId),
      })
      return membership ? { id: membership.workspaceId } : null
    },
    readEvents: (workspaceId, afterSeq, limit) =>
      readChangeEvents(workspaceId, afterSeq, limit),
    subscribe: (workspaceId, onEvent) =>
      subscribeToChangeEvents(workspaceId, onEvent),
    isSessionValid: async (headers) => {
      const session = await auth.api.getSession({ headers })
      return !!session
    },
    now: () => Date.now(),
  })
}

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
