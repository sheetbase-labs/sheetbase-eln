import { createFileRoute } from '@tanstack/react-router'

import { livenessResponse } from '#/lib/health'

/**
 * API-006: liveness. The process is running; no dependency checks. Cheap
 * enough to hit every second. Returns 200 immediately.
 */
export const Route = createFileRoute('/api/health/live')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => livenessResponse(request),
    },
  },
})
