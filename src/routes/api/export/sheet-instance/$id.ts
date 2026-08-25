/**
 * DATA-02 Sheet Instance export route. GET with:
 *   ?format=json|csv|tsv|xlsx|parquet  (default json)
 *
 * JSON carries the full live instance document; delimited formats render the
 * local grid (active localFields × localValues). Bound Dataset data is
 * exported through Dataset/Dataset Version exports.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleSheetInstanceExport } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleSheetInstanceExport(request, params.id, realSessionAuthDeps)

export const Route = createFileRoute('/api/export/sheet-instance/$id')({
  server: {
    handlers: { GET: handler },
  },
})
