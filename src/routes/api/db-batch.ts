import { createFileRoute } from '@tanstack/react-router'

import { dbProxyDeps } from '#/lib/db-proxy-deps.server'
import { handleBatchRequest } from '#/lib/postgrest-batch'

// Read batching: reads the browser started together, answered in one response.
// Each one runs through the same data proxy as /api/db/*; see postgrest-batch.ts.
export const Route = createFileRoute('/api/db-batch')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) =>
        handleBatchRequest(request, dbProxyDeps),
    },
  },
})
