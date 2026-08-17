import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

import { applySecurityHeaders } from '#/lib/security-headers'

// Preserve TanStack Start's default CSRF protection for server functions.
// Providing requestMiddleware replaces the framework default list, so CSRF
// must be declared here explicitly.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next()
    applySecurityHeaders(result.response.headers)
    return result
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}))
