/** The lab logo: `GET` serves it, `PUT` stores one, `DELETE` removes it. */
import { createFileRoute } from '@tanstack/react-router'

import {
  handleLogoDownload,
  handleLogoWrite,
} from '#/lib/workspace-logo-routes'
import { realSessionAuthDeps } from '#/lib/request-auth'

export const Route = createFileRoute('/api/workspace-logo')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleLogoDownload(request, realSessionAuthDeps),
      PUT: ({ request }: { request: Request }) =>
        handleLogoWrite(request, realSessionAuthDeps),
      DELETE: ({ request }: { request: Request }) =>
        handleLogoWrite(request, realSessionAuthDeps),
    },
  },
})
