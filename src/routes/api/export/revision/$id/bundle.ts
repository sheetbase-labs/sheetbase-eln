/**
 * Signed export bundle for a submitted revision. GET returns a ZIP with the
 * evidence package, a manifest signed by the workspace's export key, every
 * trusted timestamp the revision's signatures have, and scripts that verify it
 * without Sheetbase.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleRevisionSignedBundle } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleRevisionSignedBundle(request, params.id, realSessionAuthDeps)

export const Route = createFileRoute('/api/export/revision/$id/bundle')({
  server: {
    handlers: { GET: handler },
  },
})
