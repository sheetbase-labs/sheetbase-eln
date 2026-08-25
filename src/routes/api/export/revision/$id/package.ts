/**
 * DATA-02 revision evidence package route. GET returns a deterministic ZIP
 * (evidence.json + README.md + frozen Sheet grids + pinned file manifest +
 * sha256 manifest) built from the canonical api.revision_evidence_package
 * contract. Submitted revisions are immutable evidence; this export never
 * implies live state is frozen.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleRevisionEvidencePackage } from '#/lib/export/routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({
  request,
  params,
}: {
  request: Request
  params: { id: string }
}) => handleRevisionEvidencePackage(request, params.id, realSessionAuthDeps)

export const Route = createFileRoute('/api/export/revision/$id/package')({
  server: {
    handlers: { GET: handler },
  },
})
