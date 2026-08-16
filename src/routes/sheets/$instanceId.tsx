import { createFileRoute, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
import { ComposedSheetWorkspace } from '#/components/sheet/composed-sheet-workspace'

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
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Composed Sheet' }],
  })

  if (!projectId) {
    return (
      <p role="alert" className="p-4 text-sm">
        A projectId search parameter is required to create or link Records.
      </p>
    )
  }

  return (
    <ComposedSheetWorkspace instanceId={instanceId} projectId={projectId} />
  )
}
