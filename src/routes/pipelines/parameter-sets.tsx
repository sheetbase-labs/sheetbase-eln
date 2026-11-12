import { createFileRoute, redirect } from '@tanstack/react-router'

import { ParameterSetsPage } from '#/components/pipelines/parameter-sets/parameter-sets-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** The reusable parameter sets a version file includes by name. */
export const Route = createFileRoute('/pipelines/parameter-sets')({
  beforeLoad: ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) throw redirect(signInRedirect(location))

    return { context }
  },
  component: ParameterSetsRoute,
})

function ParameterSetsRoute() {
  const { context } = Route.useRouteContext()

  return (
    <ParameterSetsPage
      workspaceId={context.workspace?.id ?? ''}
      canManage={hasCapability(context.workspace?.role, 'pipelines.manage')}
    />
  )
}
