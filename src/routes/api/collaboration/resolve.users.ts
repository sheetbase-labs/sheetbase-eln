/**
 * COLLAB: batch user resolution for Liveblocks resolveUsers callbacks.
 * Only users sharing a workspace with the caller are ever returned.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getAppSession } from '#/lib/auth'
import { resolveUsersForCaller } from '#/lib/collaboration/resolution.server'
import { requestErrorResponse } from '#/lib/request-auth'

const handler = async ({ request }: { request: Request }) => {
  const session = await getAppSession(request.headers)
  if (!session) {
    return requestErrorResponse(401, 'unauthenticated', 'Sign in required.')
  }
  const ids = new URL(request.url).searchParams.get('ids') ?? ''
  const users = await resolveUsersForCaller(
    session.user.id,
    ids.split(',').filter(Boolean),
  )
  return Response.json({ users })
}

export const Route = createFileRoute('/api/collaboration/resolve/users')({
  server: {
    handlers: { GET: handler },
  },
})
