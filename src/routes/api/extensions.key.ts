import { createFileRoute } from '@tanstack/react-router'

import { handleExtensionAdmin } from '#/lib/extensions/admin.server'

/**
 * POST /api/extensions/key — an administrator makes (or replaces) the signing
 * key an extension's webhook runner checks, or lists which installs have one.
 */
export const Route = createFileRoute('/api/extensions/key')({
  server: {
    handlers: { POST: ({ request }) => handleExtensionAdmin(request) },
  },
})
