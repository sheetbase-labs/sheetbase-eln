/**
 * POST /api/connectors/intake — read a kept file through an instrument
 * connection, or try an intake problem again. Session-signed-in; the agent
 * uses /api/connectors/pickup. See src/lib/connectors/intake-routes.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleIntake } from '#/lib/connectors/intake-routes.server'

export const Route = createFileRoute('/api/connectors/intake')({
  server: {
    handlers: { POST: ({ request }) => handleIntake(request) },
  },
})
