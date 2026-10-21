import { createFileRoute } from '@tanstack/react-router'

import { handleRecordElnExport } from '#/lib/eln/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/export/record/$id/eln')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleRecordElnExport(request, params.id, realSessionAuthDeps),
    },
  },
})
