import { createFileRoute } from '@tanstack/react-router'

import { auth } from '#/lib/auth'

// Better Auth owns every route under /api/auth/*: sign-in, callback,
// session lookup and sign-out.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => auth.handler(request),
      POST: ({ request }: { request: Request }) => auth.handler(request),
    },
  },
})
