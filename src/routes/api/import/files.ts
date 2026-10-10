/**
 * DSET-05.1 — `/api/import/files`: store the raw file (checksum first), parse
 * it on the server and recognise a registered parser. Thin wrapper around the
 * testable handler; see src/lib/import/server.ts for the contract.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleImportFileUpload } from '#/lib/import/server'

const handler = ({ request }: { request: Request }) =>
  handleImportFileUpload(request)

export const Route = createFileRoute('/api/import/files')({
  server: {
    handlers: { POST: handler },
  },
})
