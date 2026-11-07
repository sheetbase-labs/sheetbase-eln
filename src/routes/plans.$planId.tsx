import { createFileRoute, redirect } from '@tanstack/react-router'

import { PlanView } from '#/components/planner/plan-view'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/plans/$planId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: Page,
})

function Page() {
  const { context } = Route.useRouteContext()
  const { planId } = Route.useParams()
  return (
    <PlanView
      planId={planId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
