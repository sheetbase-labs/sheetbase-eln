/**
 * Whether the browser editor is switched on. Thin wrapper; see
 * src/lib/office-editor-routes.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { handleEditorStatus } from '#/lib/office-editor-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/office-editor/status')({
  server: {
    handlers: {
      GET: ({ request }) => handleEditorStatus(request, realSessionAuthDeps),
    },
  },
})
