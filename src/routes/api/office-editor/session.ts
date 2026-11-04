/**
 * Starts a browser-editor session for a file. Thin wrapper; see
 * src/lib/office-editor-routes.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleEditorSession } from '#/lib/office-editor-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/office-editor/session')({
  server: {
    handlers: {
      POST: ({ request }) => handleEditorSession(request, realSessionAuthDeps),
    },
  },
})
