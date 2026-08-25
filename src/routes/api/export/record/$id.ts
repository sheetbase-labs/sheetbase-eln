/**
 * DATA-02 Record (Notebook) export route. GET with ?format=json (only JSON is
 * supported; the canonical notebook document is not tabular).
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleRecordExport } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleRecordExport(request, params.id, realSessionAuthDeps)

export const Route = createFileRoute('/api/export/record/$id')({
  server: {
    handlers: { GET: handler },
  },
})
