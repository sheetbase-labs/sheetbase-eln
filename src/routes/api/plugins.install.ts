import { createFileRoute } from '@tanstack/react-router'

import { handlePluginInstall } from '#/lib/extensions/install.server'

/**
 * POST /api/plugins/install: an owner or administrator checks or installs a
 * `.sbplugin` file. See docs/api/plugins-api.md.
 */
export const Route = createFileRoute('/api/plugins/install')({
  server: {
    handlers: { POST: ({ request }) => handlePluginInstall(request) },
  },
})
