/** A workspace member's profile photo. */
import { createFileRoute } from '@tanstack/react-router'

import { handleAvatarDownload } from '#/lib/avatar-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/avatars/$userId')({
  server: {
    handlers: {
      GET: ({
        request,
        params,
      }: {
        request: Request
        params: { userId: string }
      }) => handleAvatarDownload(request, params.userId, realSessionAuthDeps),
    },
  },
})
