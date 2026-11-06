import { createFileRoute } from '@tanstack/react-router'

import { realSessionAuthDeps } from '#/lib/request-auth'
import { handleValidationRun } from '#/lib/validation/routes'

export const Route = createFileRoute('/api/validation/run')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) =>
        handleValidationRun(request, realSessionAuthDeps),
    },
  },
})
