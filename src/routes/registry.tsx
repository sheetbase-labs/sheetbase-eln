import { createFileRoute, redirect } from '@tanstack/react-router'

import { RegistryList } from '#/components/registry/registry-list'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Registries: record models ticked as a registry, each entry with a number that
 * never changes, a duplicate check and lineage (migration 0070).
 */
export const Route = createFileRoute('/registry')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: RegistryPage,
})

function RegistryPage() {
  const { context } = Route.useRouteContext()

  return (
    <RegistryList
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      canEditModels={hasCapability(context.workspace?.role, 'schema.edit')}
    />
  )
}
