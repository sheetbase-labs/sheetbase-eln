/**
 * DATA-02 Dataset / Dataset Version export route. GET with:
 *   ?format=csv|tsv|json|ndjson|xlsx|parquet  (default csv)
 *   &version=<datasetVersionId>               (frozen version export)
 *
 * Live exports stream the canonical `query_dataset_rows` contract; version
 * exports stream `query_dataset_version_rows`. See src/lib/export/routes.ts.
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
}) => handleDatasetExport(request, params.id, realSessionAuthDeps, 'live')

export const Route = createFileRoute('/api/export/dataset/$id')({
  server: {
    handlers: { GET: handler },
  },
})
