import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { resolveIdentifierParam } from '#/lib/identifier-resolution'

/**
 * EXP-01.1 — the record page is a layout: the header and tabs live in the
 * child routes, and each tab is its own URL. The parent only resolves auth and
 * passes the context down.
 */
export const Route = createFileRoute('/records/$recordId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    await resolveIdentifierParam({
      entity: 'record',
      ref: params.recordId,
      href: location.href,
    })
    return { context }
  },
  component: RecordLayout,
})

function RecordLayout() {
  return <Outlet />
}
