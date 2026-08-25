/**
 * SCI-003 upload authorization route (decision 0028). Thin wrapper around the
 * testable handler; see src/lib/file-routes.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleUploadAuthorize } from '#/lib/file-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({ request }: { request: Request }) =>
  handleUploadAuthorize(request, realSessionAuthDeps)

export const Route = createFileRoute('/api/files/upload-authorize')({
  server: {
    handlers: { POST: handler },
  },
})
