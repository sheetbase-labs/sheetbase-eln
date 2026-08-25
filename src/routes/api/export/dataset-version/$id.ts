/**
 * DATA-02 Dataset Version export route (immutable snapshot). GET with:
 *   ?format=csv|tsv|json|ndjson|xlsx|parquet  (default csv)
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleDatasetExport } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleDatasetExport(request, params.id, realSessionAuthDeps, 'version')

export const Route = createFileRoute('/api/export/dataset-version/$id')({
  server: {
    handlers: { GET: handler },
  },
})
