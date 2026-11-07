/**
 * Run a notebook code cell, or run an earlier run again:
 * `POST { action: 'run' | 'reproduce', recordId, ... }`. See
 * src/lib/code-cells/run.server.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleCodeCell } from '#/lib/code-cells/run.server'

export const Route = createFileRoute('/api/notebook/code-cell')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => handleCodeCell(request),
    },
  },
})
