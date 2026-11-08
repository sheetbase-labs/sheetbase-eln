import { createFileRoute } from '@tanstack/react-router'

import { handlePluginHost } from '#/lib/extensions/host-route.server'

/**
 * POST /api/plugins/host: a plugin screen uses any MCP tool, under its MCP
 * name, as the signed-in person. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/host')({
  server: {
    handlers: {
      POST: ({ request }) => handlePluginHost(request),
    },
  },
})
