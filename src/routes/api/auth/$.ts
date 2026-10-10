import { createFileRoute } from '@tanstack/react-router'

import { handleAuthRequest } from '#/lib/auth'

// Better Auth owns sign-in, session lookup and sign-out; the HTTP boundary
// blocks password reset callbacks outside governed credential recovery.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleAuthRequest(request),
      POST: ({ request }: { request: Request }) => handleAuthRequest(request),
    },
  },
})
