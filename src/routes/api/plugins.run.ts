import { createFileRoute } from '@tanstack/react-router'

import { handleExtensionRun } from '#/lib/extensions/run-route.server'

/**
 * POST /api/plugins/run — run a plugin's operation or analysis
 * kind as the signed-in person. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/run')({
  server: {
    handlers: {
      POST: ({ request }) => handleExtensionRun(request),
    },
  },
})
