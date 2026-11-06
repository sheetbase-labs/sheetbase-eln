import { createFileRoute } from '@tanstack/react-router'

import { handleStructuresRequest } from '#/lib/structures-api.server'

export const Route = createFileRoute('/api/structures/$action')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleStructuresRequest(request, params.action),
    },
  },
})
