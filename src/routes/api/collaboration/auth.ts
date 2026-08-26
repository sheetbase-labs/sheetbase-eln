/**
 * COLLAB: Liveblocks room authentication. The browser's Liveblocks client
 * calls this endpoint with the room it wants to join; access is decided
 * entirely server-side from the Sheetbase session and PostgreSQL membership
 * (see src/lib/collaboration/access.server.ts). A client never supplies its
 * own identity, workspace or permissions.
 */
import { createFileRoute } from '@tanstack/react-router'
import { Liveblocks } from '@liveblocks/node'

import { env } from '#/env.server'
import {
  realCollaborationAuthDeps,
  resolveRoomAccess,
} from '#/lib/collaboration/access.server'
import { requestErrorResponse } from '#/lib/request-auth'

const handler = async ({ request }: { request: Request }) => {
  let room: unknown
  try {
    const body = (await request.json()) as { room?: unknown }
    room = body.room
  } catch {
    return requestErrorResponse(400, 'invalid_body', 'JSON body required.')
  }

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

  const liveblocks = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY! })
  const session = liveblocks.prepareSession(resolved.userId, {
    userInfo: {
      name: resolved.userInfo.name,
      avatar: resolved.userInfo.avatar ?? undefined,
    },
  })
  // Grant exactly this room; scopes carry no storage or feed access.
  session.allow(room as string, [...resolved.permissions.permissions])
  const { status, body } = await session.authorize()
  return new Response(body, { status })
}

export const Route = createFileRoute('/api/collaboration/auth')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
