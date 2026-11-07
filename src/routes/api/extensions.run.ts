import { createFileRoute } from '@tanstack/react-router'

import { handleExtensionRun } from '#/lib/extensions/run-route.server'

/**
 * POST /api/extensions/run — run an extension's assistant tool or analysis
 * kind as the signed-in person. See docs/api/extensions-api.md.
 */
export const Route = createFileRoute('/api/extensions/run')({
  server: {
    handlers: {
      POST: ({ request }) => handleExtensionRun(request),
    },
  },
})
