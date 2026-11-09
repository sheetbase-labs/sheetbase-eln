import { createFileRoute, redirect } from '@tanstack/react-router'

import { RequestsPage } from '#/components/requests/requests-page'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'

type RequestTab = 'mine' | 'triage' | 'all'

/**
 * Requests: ask the lab for work through a form made from a model, and follow
 * it from asked to done (migration 0076).
 */
export const Route = createFileRoute('/requests')({
  validateSearch: (search: Record<string, unknown>): { tab?: RequestTab } => ({
    tab:
      search.tab === 'triage' || search.tab === 'all' || search.tab === 'mine'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: RequestsRoute,
})

function RequestsRoute() {
  const { context } = Route.useRouteContext()
  const { tab = 'mine' } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <RequestsPage
      userId={context.user.id}
      canWrite={hasCapability(context.workspace?.role, 'record.create')}
      canEditModels={hasCapability(context.workspace?.role, 'schema.edit')}
      tab={tab}
      onTabChange={(next) => void navigate({ search: { tab: next } })}
    />
  )
}
