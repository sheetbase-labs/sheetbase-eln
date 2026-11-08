import { createFileRoute } from '@tanstack/react-router'

import { handleChannels } from '#/lib/extensions/channels-route.server'

/**
 * GET /api/plugins/channels: the notification channels plugins add and the
 * signed-in person's own choice for each. POST saves, removes or tests it.
 * See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/channels')({
  server: {
    handlers: {
      GET: ({ request }) => handleChannels(request),
      POST: ({ request }) => handleChannels(request),
    },
  },
})
