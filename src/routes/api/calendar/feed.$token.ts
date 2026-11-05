/**
 * GET /api/calendar/feed/<secret>.ics — a private calendar subscription.
 * The secret in the link is the credential; see src/lib/calendar-feed.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleFeedRequest } from '#/lib/calendar-feed.server'

export const Route = createFileRoute('/api/calendar/feed/$token')({
  server: {
    handlers: {
      GET: ({ params }: { params: { token: string } }) =>
        handleFeedRequest(params.token),
    },
  },
})
