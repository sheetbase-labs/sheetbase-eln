import { createFileRoute, redirect } from '@tanstack/react-router'

import { RegistryEntryPage } from '#/components/v3/registry/registry-entry'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

export const Route = createFileRoute('/registry_/$entryId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: RegistryEntryRoute,
})

function RegistryEntryRoute() {
  const { context } = Route.useRouteContext()
  const { entryId } = Route.useParams()
  return (
    <RegistryEntryPage
      entryId={entryId}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
    />
  )
}
