import { createFileRoute } from '@tanstack/react-router'

import { handlePluginRuntime } from '#/lib/extensions/runtime-settings-route.server'

/**
 * GET /api/plugins/runtime: each plugin's Python packages, approved hosts, run
 * limits and where its packages stand. POST changes the limits or installs the
 * packages again. Owners and administrators only. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/runtime')({
  server: {
    handlers: {
      GET: ({ request }) => handlePluginRuntime(request),
      POST: ({ request }) => handlePluginRuntime(request),
    },
  },
})
