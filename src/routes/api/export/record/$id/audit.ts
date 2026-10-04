import { createFileRoute } from '@tanstack/react-router'

import { handleRecordAuditExport } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/export/record/$id/audit')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleRecordAuditExport(request, params.id, realSessionAuthDeps),
    },
  },
})
