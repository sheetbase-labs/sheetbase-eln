import { createFileRoute } from '@tanstack/react-router'

import { handlePluginConnections } from '#/lib/extensions/connections-route.server'

/**
 * GET /api/plugins/connections: what each plugin's connectors, publishers and
 * notification channels need set up and whether it is. POST sets or clears
 * values (secrets are sealed and never sent back). Owners and administrators
 * only. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/connections')({
  server: {
    handlers: {
      GET: ({ request }) => handlePluginConnections(request),
      POST: ({ request }) => handlePluginConnections(request),
    },
  },
})
