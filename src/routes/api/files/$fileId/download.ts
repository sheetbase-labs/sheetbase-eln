/**
 * SCI-003 download route (decision 0028). Thin wrapper around the testable
 * handler; see src/lib/file-routes.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleDownload } from '#/lib/file-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { fileId: string }
}) => handleDownload(request, params.fileId, realSessionAuthDeps)

export const Route = createFileRoute('/api/files/$fileId/download')({
  server: {
    handlers: { GET: handler },
  },
})
