/**
 * Upload the next version of a file. Thin wrapper around the testable handler;
 * see src/lib/file-routes.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleUploadVersion } from '#/lib/file-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { fileId: string }
}) => handleUploadVersion(request, params.fileId, realSessionAuthDeps)

export const Route = createFileRoute('/api/files/$fileId/version')({
  server: {
    handlers: { PUT: handler },
  },
})
