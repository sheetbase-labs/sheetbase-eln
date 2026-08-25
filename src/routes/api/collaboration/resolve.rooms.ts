/**
 * COLLAB: batch room resolution for Liveblocks resolveRoomsInfo callbacks.
 * Returns display names and deep links only for rooms the caller can access;
 * inaccessible rooms are omitted so the notification inbox never leaks.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getAppSession } from '#/lib/auth'
import { resolveRoomsForCaller } from '#/lib/collaboration/resolution.server'
import { requestErrorResponse } from '#/lib/request-auth'

const handler = async ({ request }: { request: Request }) => {
  const session = await getAppSession(request.headers)
  if (!session) {
    return requestErrorResponse(401, 'unauthenticated', 'Sign in required.')
  }
  const ids = new URL(request.url).searchParams.get('ids') ?? ''
  const rooms = await resolveRoomsForCaller(
    session.user.id,
    ids.split(',').filter(Boolean),
  )
  return Response.json({ rooms })
}

export const Route = createFileRoute('/api/collaboration/resolve/rooms')({
  server: {
    handlers: { GET: handler },
  },
})
