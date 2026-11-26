import { createFileRoute } from '@tanstack/react-router'

import { handleProtocolsIoConnection } from '#/lib/extensions/protocols-io-connection.server'

/**
 * POST /api/plugins/protocols-io/test-connection: whether protocols.io accepts the token
 * the plugin would use. Owners and administrators only; app-only, never on a
 * token (it exists for the Settings → Plugins button).
 */
export const Route = createFileRoute(
  '/api/plugins/protocols-io/test-connection',
)({
  server: {
    handlers: {
      POST: ({ request }) => handleProtocolsIoConnection(request),
    },
  },
})
