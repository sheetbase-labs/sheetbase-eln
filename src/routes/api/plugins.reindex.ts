import { createFileRoute } from '@tanstack/react-router'

import { handlePluginReindex } from '#/lib/extensions/reindex.server'

/**
 * POST /api/plugins/reindex: brings a plugin's search index up to date for
 * records saved before it was added. Owners and administrators only.
 */
export const Route = createFileRoute('/api/plugins/reindex')({
  server: {
    handlers: {
      POST: ({ request }) => handlePluginReindex(request),
    },
  },
})
