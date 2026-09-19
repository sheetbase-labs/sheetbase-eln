import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'

import { useShell } from '#/components/app-shell'
import { ConfigurationWorkspace } from '#/components/configuration/configuration-workspace'
import type { ConfigurationKind } from '#/components/configuration/configuration-workspace'
import { SchemaGraphExplorer } from '#/components/configuration/schema-graph-explorer'
import type { SchemaGraphNode } from '#/components/configuration/schema-graph-explorer'
import { Button, PageHeader } from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import type { WorkspaceRole } from '#/lib/workspace-admin'

export const Route = createFileRoute('/configure')({
  staticData: { shellFullBleed: true },
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
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: search.kind ? 'Models & schemas' : 'Schemas' }],
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
        <div className="border-b border-border/60 px-4 pt-4 md:px-6 md:pt-6">
          <PageHeader
            title="Schemas"
            description="Define record fields, dataset schemas and reusable structures."
            className="border-0 pb-4"
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: '/configure',
                    search: { kind: 'model', id: undefined, model: undefined },
                  })
                }
              >
                Manage fields
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: '/configure',
                    search: {
                      kind: 'schema',
                      id: undefined,
                      model: undefined,
                    },
                  })
                }
              >
                New schema
              </Button>
            </div>
          </PageHeader>
        </div>
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
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/60 px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          title="Models &amp; schemas"
          description="Define record fields, dataset schemas and reusable structures."
          className="border-0 pb-4"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
          >
            Schema graph
          </Button>
        </PageHeader>
      </div>
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
