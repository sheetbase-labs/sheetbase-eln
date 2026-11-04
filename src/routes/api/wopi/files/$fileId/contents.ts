/**
 * WOPI GetFile (GET) and PutFile (POST) for the browser editor. Thin wrapper;
 * see src/lib/wopi-routes.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from '#/env.server'
import { handleGetFile, handlePutFile } from '#/lib/wopi-routes'

const deps = () => ({
  secret: env.PGRST_JWT_SECRET,
  appOrigin: new URL(env.BETTER_AUTH_URL).origin,
})

export const Route = createFileRoute('/api/wopi/files/$fileId/contents')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleGetFile(request, params.fileId, deps()),
      POST: ({ request, params }) =>
        handlePutFile(request, params.fileId, deps()),
    },
  },
})
