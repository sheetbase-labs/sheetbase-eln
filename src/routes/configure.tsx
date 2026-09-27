import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { useShell } from '#/components/shell'
import { ConfigurationWorkspace } from '#/components/configuration/configuration-workspace'
import type { ConfigurationKind } from '#/components/configuration/configuration-workspace'
import { createDataClient } from '#/lib/data-client'
import type { WorkspaceRole } from '#/lib/workspace-admin'

export const Route = createFileRoute('/configure')({
  validateSearch: (search: Record<string, unknown>) => ({
    kind:
      search.kind === 'schema' ||
      search.kind === 'definition' ||
      search.kind === 'template' ||
      search.kind === 'promotion' ||
      search.kind === 'vocabulary'
        ? (search.kind as ConfigurationKind)
        : ('model' as const),
    id: typeof search.id === 'string' ? search.id : undefined,
    model: typeof search.model === 'string' ? search.model : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ConfigureRoute,
})

const dataClient = createDataClient()

function ConfigureRoute() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const role = context.workspace?.role as WorkspaceRole | undefined

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
    breadcrumbs: [{ label: 'Models & schemas' }],
    inspector: null,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Models &amp; schemas</h1>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Define record fields, dataset schemas and reusable structures.
        </p>
      </header>
      <ConfigurationWorkspace
        client={dataClient}
        workspaceId={context.workspace?.id ?? ''}
        role={role}
        search={search}
        onSearchChange={(next) =>
          void navigate({
            to: '/configure',
            search: {
              kind: next.kind,
              id: next.id,
              model: next.model,
            },
          })
        }
      />
    </div>
  )
}
