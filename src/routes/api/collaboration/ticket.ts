/**
 * COLLAB: who the person is and what they may do in a room. The bundled
 * co-editing server (scripts/lib/collab-server.mjs) calls this with the
 * browser's own cookies for every connection, so a room is guarded by exactly
 * the session, membership and per-object permissions the rest of Sheetbase
 * uses. A client never supplies its own identity, workspace or permissions.
 */
import { createFileRoute } from '@tanstack/react-router'

import {
  realCollaborationAuthDeps,
  resolveRoomAccess,
} from '#/lib/collaboration/access.server'
import { canWriteInRoom } from '#/lib/collaboration/permissions'
import { requestErrorResponse } from '#/lib/request-auth'

const handler = async ({ request }: { request: Request }) => {
  const room = new URL(request.url).searchParams.get('room')

  const resolved = await resolveRoomAccess(
    request.headers,
    room,
    realCollaborationAuthDeps,
  )

  if (!resolved.ok) {
    return requestErrorResponse(
      resolved.status,
      resolved.code,
      resolved.message,
    )
  }

  return Response.json(
    {
      userId: resolved.userId,
      name: resolved.userInfo.name,
      avatar: resolved.userInfo.avatar,
      canWrite: canWriteInRoom(resolved.permissions.permissions),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export const Route = createFileRoute('/api/collaboration/ticket')({
  server: {
    handlers: { GET: handler },
  },
})
