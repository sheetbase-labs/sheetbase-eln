import { createFileRoute } from '@tanstack/react-router'

import { handleExtensionData } from '#/lib/extensions/data-route.server'

/**
 * POST /api/plugins/data — read a file, pull data in, write a file, preview a
 * file or run a check with a plugin, as the signed-in person. See
 * docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/data')({
  server: {
    handlers: {
      POST: ({ request }) => handleExtensionData(request),
    },
  },
})
