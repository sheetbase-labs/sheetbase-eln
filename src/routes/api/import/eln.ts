import { createFileRoute } from '@tanstack/react-router'

import { handleElnImport } from '#/lib/eln/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/import/eln')({
  server: {
    handlers: {
      POST: ({ request }) => handleElnImport(request, realSessionAuthDeps),
    },
  },
})
