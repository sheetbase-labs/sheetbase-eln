import { createFileRoute, redirect } from '@tanstack/react-router'

import { PlatesPage } from '#/components/plates/plates-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

/**
 * Plates: plate reads checked against their own controls, hits and potency,
 * and the worklists that move liquid for them (migration 0104).
 */
export const Route = createFileRoute('/plates')({
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    run: typeof search.run === 'string' && search.run ? search.run : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: PlatesRoute,
})

function PlatesRoute() {
  const { context } = Route.useRouteContext()
  const { run } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PlatesPage
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      workspaceId={context.workspace?.id ?? ''}
      runId={run}
      onOpenRun={(id) => void navigate({ search: { run: id } })}
    />
  )
}
