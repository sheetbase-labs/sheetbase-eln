import { createFileRoute, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
import { CanonicalSheetWorkspace } from '#/components/sheet/canonical-sheet-workspace'

export const Route = createFileRoute('/sheets/$instanceId')({
  validateSearch: (search: Record<string, unknown>) => ({
    projectId:
      typeof search.projectId === 'string' ? search.projectId : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ComposedSheetRoute,
})

function ComposedSheetRoute() {
  const { instanceId } = Route.useParams()
  const { projectId } = Route.useSearch()
  const { context } = Route.useRouteContext()
  useShell({
    fullBleed: true,
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Sheet' }],
  })

  return (
    <CanonicalSheetWorkspace
      instanceId={instanceId}
      projectId={projectId ?? null}
      readOnly={!projectId}
    />
  )
}
