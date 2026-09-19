import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
import { ConfigurationWorkspace } from '#/components/configuration/configuration-workspace'
import type { ConfigurationKind } from '#/components/configuration/configuration-workspace'
import { SchemaGraphExplorer } from '#/components/configuration/schema-graph-explorer'
import type { SchemaGraphNode } from '#/components/configuration/schema-graph-explorer'
import { createDataClient } from '#/lib/data-client'
import type { WorkspaceRole } from '#/lib/workspace-admin'

export const Route = createFileRoute('/configure')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    kind: ConfigurationKind | undefined
    id: string | undefined
    model: string | undefined
  } => ({
    kind:
      search.kind === 'model' ||
      search.kind === 'schema' ||
      search.kind === 'definition' ||
      search.kind === 'template' ||
      search.kind === 'promotion' ||
      search.kind === 'vocabulary'
        ? search.kind
        : undefined,
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
    breadcrumbs: [
      { label: search.kind ? 'Models & schemas' : 'Schemas' },
    ],
    inspector: null,
  })

  const openSchemaNode = (node: SchemaGraphNode) => {
    void navigate({
      to: '/configure',
      search:
        node.kind === 'model'
          ? { kind: 'model' as const, id: undefined, model: node.key }
          : { kind: 'schema' as const, id: node.key, model: undefined },
    })
  }

  if (!search.kind) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SchemaGraphExplorer
          client={dataClient}
          workspaceId={context.workspace?.id ?? ''}
          onOpenNode={openSchemaNode}
          onNewSchema={() =>
            void navigate({
              to: '/configure',
              search: { kind: 'schema', id: undefined, model: undefined },
            })
          }
          onManage={() =>
            void navigate({
              to: '/configure',
              search: { kind: 'model', id: undefined, model: undefined },
            })
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-headline font-heading tracking-tight">
            Models &amp; schemas
          </h1>
          <button
            type="button"
            onClick={() =>
              void navigate({
                to: '/configure',
                search: {
                  kind: undefined,
                  id: undefined,
                  model: undefined,
                },
              })
            }
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Schema graph
          </button>
        </div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Define record fields, dataset schemas and reusable structures.
        </p>
      </header>
      <ConfigurationWorkspace
        client={dataClient}
        workspaceId={context.workspace?.id ?? ''}
        role={role}
        search={{ kind: search.kind, id: search.id, model: search.model }}
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
