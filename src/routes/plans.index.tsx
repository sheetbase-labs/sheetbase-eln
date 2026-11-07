import { createFileRoute, redirect } from '@tanstack/react-router'

import { PlansPage } from '#/components/planner/plans-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/plans/')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: Page,
})

function Page() {
  const { context } = Route.useRouteContext()
  return (
    <PlansPage
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
