import { createFileRoute } from '@tanstack/react-router'

import { handleAdoptChemistry } from '#/lib/chemistry-adopt-route.server'

/**
 * POST /api/plugins/adopt-chemistry: moves the lab's compound registries onto
 * the Chemistry plugin. Owners and administrators only.
 */
export const Route = createFileRoute('/api/plugins/adopt-chemistry')({
  server: {
    handlers: {
      POST: ({ request }) => handleAdoptChemistry(request),
    },
  },
})
