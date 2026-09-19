/**
 * AUTO-03 — Pipelines workspace surface (`/pipelines`).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
  Outlet,
} from '@tanstack/react-router'
import { Plus, Workflow } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { CreatePipelineDefinitionDialog } from '#/components/pipelines/create-pipeline-definition-dialog'
import {
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  PageHeader,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import {
  listPipelineDefinitions,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { PipelineDefinitionWire } from '#/lib/pipelines/types'

export const Route = createFileRoute('/pipelines')({
  staticData: { shellFullBleed: true },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PipelinesRoute,
})

const dataClient = createDataClient()

function PipelinesRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return pathname.replace(/\/$/, '') === '/pipelines' ? (
    <PipelinesIndexRoute />
  ) : (
    <Outlet />
  )
}

function PipelinesIndexRoute() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const definitionsQuery = useQuery({
    queryKey: pipelineQueryKeys.definitions,
    queryFn: () => listPipelineDefinitions(dataClient),
    enabled: Boolean(workspaceId),
  })

  const definitions = definitionsQuery.data ?? []
  const filtered = definitions.filter((definition) =>
    `${definition.name} ${definition.key} ${definition.description ?? ''}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  )
  const canManage = hasCapability(context.workspace?.role, 'pipelines.manage')

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Pipelines' }],
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          compact
          title="Pipelines"
          description="Automate analysis and repeatable lab workflows."
          className="border-0 pb-4"
        >
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create pipeline
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-6">
        {!canManage && (
          <p className="text-muted-foreground mb-4 text-sm">
            You can view Pipelines and their runs; only owners, admins and
            stewards create or configure them.
          </p>
        )}
        {definitionsQuery.error instanceof Error && (
          <p role="alert" className="text-destructive mb-4 text-sm">
            {definitionsQuery.error.message}
          </p>
        )}
        {definitionsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : definitionsQuery.isError && definitions.length === 0 ? (
          <Button variant="outline" onClick={() => definitionsQuery.refetch()}>
            Try again
          </Button>
        ) : definitions.length === 0 ? (
          <Empty>
            <EmptyIcon>
              <Workflow className="size-8" />
            </EmptyIcon>
            <EmptyTitle>No pipelines yet</EmptyTitle>
            <EmptyDescription>
              Build repeatable analysis or ELN actions. Publish a version, then
              run it manually, on a schedule or from a webhook.
            </EmptyDescription>
            {canManage && (
              <EmptyActions>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Create pipeline
                </Button>
              </EmptyActions>
            )}
          </Empty>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                aria-label="Find pipelines"
                placeholder="Find pipelines…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="w-full sm:max-w-xs"
              />
              <span role="status" className="text-sm text-muted-foreground">
                {filtered.length} of {definitions.length} pipelines
              </span>
              {filter && (
                <Button size="sm" variant="ghost" onClick={() => setFilter('')}>
                  Clear filter
                </Button>
              )}
            </div>
            <div className="overflow-x-auto border-y">
              <Table variant="quiet" className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Pipeline</TableHead>
                    <TableHead className="w-44">Key</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((definition) => (
                    <PipelineRow key={definition.id} definition={definition} />
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No pipelines match your search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <CreatePipelineDefinitionDialog
        dataClient={dataClient}
        workspaceId={workspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(definitionId) =>
          navigate({ to: '/pipelines/$definitionId', params: { definitionId } })
        }
      />
    </div>
  )
}

function PipelineRow({ definition }: { definition: PipelineDefinitionWire }) {
  return (
    <TableRow>
      <TableCell>
        <Link
          className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          to="/pipelines/$definitionId"
          params={{ definitionId: definition.id }}
        >
          {definition.name}
        </Link>
        {definition.description && (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {definition.description}
          </p>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {definition.key}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{definition.lifecycle}</Badge>
      </TableCell>
    </TableRow>
  )
}
