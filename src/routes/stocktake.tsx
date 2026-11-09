import { createFileRoute, redirect } from '@tanstack/react-router'

import { StocktakeList } from '#/components/stocktake/stocktake-list'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Stocktake: walk a freezer, shelf, rack or box with the scanner and confirm
 * what is really there against what the records say (migration 0063).
 */
export const Route = createFileRoute('/stocktake')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: StocktakePage,
})

function StocktakePage() {
  const { context } = Route.useRouteContext()

  return (
    <StocktakeList
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
