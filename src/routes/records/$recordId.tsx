import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

/**
 * EXP-01.1 — the record page is a layout: the header and tabs live in the
 * child routes, and each tab is its own URL. The parent only resolves auth and
 * passes the context down.
 */
export const Route = createFileRoute('/records/$recordId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: RecordLayout,
})

function RecordLayout() {
  return <Outlet />
}
