import { createFileRoute, redirect } from '@tanstack/react-router'

import { ShipmentsPage } from '#/components/shipments/shipments-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Shipments: samples and materials leaving the lab or arriving at it, each with
 * a manifest, followed from packing to received (migration 0077).
 */
export const Route = createFileRoute('/shipments')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ShipmentsRoute,
})

function ShipmentsRoute() {
  const { context } = Route.useRouteContext()

  return (
    <ShipmentsPage
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
