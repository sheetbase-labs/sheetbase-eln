import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Layers } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { ConfigurationWorkspace } from '#/components/configuration/configuration-workspace'
import type { ConfigurationKind } from '#/components/configuration/configuration-workspace'
import { createDataClient } from '#/lib/data-client'
import type { WorkspaceRole } from '#/lib/workspace-admin'

export const Route = createFileRoute('/configure')({
  validateSearch: (search: Record<string, unknown>) => ({
    kind:
      search.kind === 'schema' || search.kind === 'promotion'
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
    breadcrumbs: [{ label: 'Configuration' }, { label: 'Governed schema' }],
    inspector: null,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Configuration</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Dense Model and Dataset Schema workspace for Data Stewards. SCI-010
          remains on Schemas as a compatibility editor.
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
