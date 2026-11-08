import { createFileRoute } from '@tanstack/react-router'

import { handlePluginUiFrame } from '#/lib/extensions/ui-frame.server'

/**
 * GET /api/plugins/<key>/ui/<id>?point=blocks|panels — the sandboxed document
 * of a plugin's UI bundle. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/$key/ui/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePluginUiFrame(request, params),
    },
  },
})
