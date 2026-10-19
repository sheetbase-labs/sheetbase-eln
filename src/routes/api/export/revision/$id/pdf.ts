/**
 * Internal PDF of a signed revision: its frozen content, a signature page and
 * the integrity digest, rendered from the server evidence package.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleRevisionPdf } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleRevisionPdf(request, params.id, realSessionAuthDeps)

export const Route = createFileRoute('/api/export/revision/$id/pdf')({
  server: {
    handlers: { GET: handler },
  },
})
