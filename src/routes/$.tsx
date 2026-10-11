import { createFileRoute, redirect } from '@tanstack/react-router'

import { NotFound } from '#/components/v3/shell/not-found'

/**
 * R5-SURF-03: the catch-all under the app shell. An unmatched URL with a
 * signed-in session renders the product's own not-found screen inside the v3
 * shell (`/$` is in the root route's ported-route list); a signed-out visitor
 * is sent to sign-in exactly as the other protected routes are, so an unknown
 * URL never leaks the app's page structure.
 */
export const Route = createFileRoute('/$')({
  beforeLoad: async ({ context }) => {
    if (!context.auth) throw redirect({ to: '/sign-in' })
  },
  component: NotFound,
})
