import { createFileRoute } from '@tanstack/react-router'

import { handleScimRequest } from '#/lib/scim.server'

// SCIM 2.0: an identity provider keeps people and groups in step. The bearer
// token is made in Settings; nothing here reads a session or a cookie.
const handle = ({
  request,
  params,
}: {
  request: Request
  params: { _splat?: string }
}) => handleScimRequest(request, params._splat ?? '')

export const Route = createFileRoute('/api/scim/v2/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
