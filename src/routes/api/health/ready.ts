import { createFileRoute } from '@tanstack/react-router'

import { readinessResponse, runReadiness } from '#/lib/health'

/**
 * API-006: readiness. Probes the database and PostgREST admin /ready in
 * parallel; returns 503 with a structured body if either dependency is not
 * ready. The body reports each dependency separately so an operator can see
 * which one is broken.
 */
export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        readinessResponse(request, await runReadiness()),
    },
  },
})
