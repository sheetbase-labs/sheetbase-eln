/**
 * DSET-05.4 — `/api/import/commit`: commit the mapped rows through the one
 * canonical Dataset batch writer, take exactly one snapshot and record exactly
 * one import receipt. Thin wrapper around the testable handler; see
 * src/lib/import/server.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleImportCommit } from '#/lib/import/server'

const handler = ({ request }: { request: Request }) =>
  handleImportCommit(request)

export const Route = createFileRoute('/api/import/commit')({
  server: {
    handlers: { POST: handler },
  },
})
