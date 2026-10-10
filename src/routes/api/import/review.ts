/**
 * DSET-05.4 — `/api/import/review`: compute planned/new/flagged/skipped
 * outcomes server-side without writing. Thin wrapper around the testable
 * handler; see src/lib/import/server.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleImportReview } from '#/lib/import/server'

const handler = ({ request }: { request: Request }) =>
  handleImportReview(request)

export const Route = createFileRoute('/api/import/review')({
  server: {
    handlers: { POST: handler },
  },
})
