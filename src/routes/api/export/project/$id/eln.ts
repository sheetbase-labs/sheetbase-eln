import { createFileRoute } from '@tanstack/react-router'

import { handleProjectElnExport } from '#/lib/eln/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/export/project/$id/eln')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleProjectElnExport(request, params.id, realSessionAuthDeps),
    },
  },
})
