import { createFileRoute } from '@tanstack/react-router'

import { handlePluginOperationApi } from '#/lib/extensions/api-route.server'

/**
 * POST /api/plugins/<key>/<operation>: call an operation an installed plugin
 * declares, as the signed-in person or with a personal API token. The route is
 * generated from the plugin's manifest; see docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/$key/$id')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePluginOperationApi(request, { key: params.key, id: params.id }),
    },
  },
})
