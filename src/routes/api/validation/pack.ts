import { createFileRoute } from '@tanstack/react-router'

import { realSessionAuthDeps } from '#/lib/request-auth'
import { handleValidationPack } from '#/lib/validation/routes'

export const Route = createFileRoute('/api/validation/pack')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleValidationPack(request, realSessionAuthDeps),
    },
  },
})
