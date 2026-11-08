import { createFileRoute } from '@tanstack/react-router'

import { handleBuiltInPlugins } from '#/lib/extensions/built-in-route.server'

/**
 * POST /api/plugins/built-in: installs or updates the plugins that ship with
 * Sheetbase (sequence tools, chemistry) in the signed-in administrator's
 * workspace. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/built-in')({
  server: {
    handlers: { POST: ({ request }) => handleBuiltInPlugins(request) },
  },
})
