import { createFileRoute } from '@tanstack/react-router'

import { eventStreamDeps } from '#/lib/provenance/event-stream-deps.server'
import { handleEventStream } from '#/lib/provenance/event-stream-requests.server'

/**
 * The replayable event stream: CloudEvents 1.0 as a JSON page or, when asked
 * for text/event-stream, a live stream. See docs/api/event-stream.md.
 */
export const Route = createFileRoute('/api/events_/stream')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleEventStream(request, eventStreamDeps),
    },
  },
})
