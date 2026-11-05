/** Your own profile photo: `PUT` stores one, `DELETE` removes it. */
import { createFileRoute } from '@tanstack/react-router'

import { handleMyAvatar } from '#/lib/avatar-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

const handler = ({ request }: { request: Request }) =>
  handleMyAvatar(request, realSessionAuthDeps)

export const Route = createFileRoute('/api/avatars/me')({
  server: {
    handlers: { PUT: handler, DELETE: handler },
  },
})
