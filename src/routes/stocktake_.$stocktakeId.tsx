import { createFileRoute, redirect } from '@tanstack/react-router'

import { StocktakeCount } from '#/components/stocktake/stocktake-count'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/stocktake_/$stocktakeId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: StocktakeCountPage,
})

function StocktakeCountPage() {
  const { context } = Route.useRouteContext()
  const { stocktakeId } = Route.useParams()

  return (
    <StocktakeCount
      stocktakeId={stocktakeId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
