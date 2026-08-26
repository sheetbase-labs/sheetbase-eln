/**
 * COLLAB: mention suggestions. Backs the @-composer in comment threads.
 * Returns active members of the requested room's workspace only — never a
 * global user directory.
 */
import { createFileRoute } from '@tanstack/react-router'

import { getAppSession } from '#/lib/auth'
import { mentionSuggestionsForRoom } from '#/lib/collaboration/resolution.server'
import { requestErrorResponse } from '#/lib/request-auth'

const handler = async ({ request }: { request: Request }) => {
  const session = await getAppSession(request.headers)
  if (!session) {
    return requestErrorResponse(401, 'unauthenticated', 'Sign in required.')
  }
  const url = new URL(request.url)
  const room = url.searchParams.get('room') ?? ''
  if (!room) {
    return requestErrorResponse(400, 'invalid_room', 'A room id is required.')
  }
  const userIds = await mentionSuggestionsForRoom(
    session.user.id,
    room,
    url.searchParams.get('text') ?? '',
  )
  return Response.json({ userIds })
}

export const Route = createFileRoute('/api/collaboration/mentions')({
  server: {
    handlers: { GET: handler },
  },
})
