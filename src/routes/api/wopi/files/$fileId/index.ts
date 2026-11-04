/**
 * WOPI CheckFileInfo (GET) and lock operations (POST) for the browser editor.
 * Thin wrapper; see src/lib/wopi-routes.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from '#/env.server'
import { handleCheckFileInfo, handleLockOperation } from '#/lib/wopi-routes'

const deps = () => ({
  secret: env.PGRST_JWT_SECRET,
  appOrigin: new URL(env.BETTER_AUTH_URL).origin,
})

export const Route = createFileRoute('/api/wopi/files/$fileId/')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleCheckFileInfo(request, params.fileId, deps()),
      POST: ({ request, params }) =>
        handleLockOperation(request, params.fileId, deps()),
    },
  },
})
