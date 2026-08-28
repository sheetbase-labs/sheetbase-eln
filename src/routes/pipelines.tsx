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
} from '@tanstack/react-router'
import { Plus, Workflow } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { CreatePipelineDefinitionDialog } from '#/components/pipelines/create-pipeline-definition-dialog'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PipelinesRoute,
})

const dataClient = createDataClient()

function PipelinesRoute() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)

  const definitionsQuery = useQuery({
    queryKey: pipelineQueryKeys.definitions,
    queryFn: () => listPipelineDefinitions(dataClient),
    enabled: Boolean(workspaceId),
  })

  const definitions = definitionsQuery.data ?? []
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
    primaryAction:
      canManage && definitions.length > 0 ? (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> Create Pipeline
        </Button>
      ) : undefined,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PageHeader
          eyebrow={context.workspace?.name ?? undefined}
          title="Pipelines"
          description="Deterministic, versioned transformations over canonical Datasets — every run pins its definition version, inputs and parameters."
          className="border-0 pb-4"
        >
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create Pipeline
            </Button>
          )}
        </PageHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-8">
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
        {definitions.length === 0 ? (
          <Empty>
            <EmptyIcon>
              <Workflow className="size-8" />
            </EmptyIcon>
            <EmptyTitle>No Pipelines yet</EmptyTitle>
            <EmptyDescription>
              Create a versioned Pipeline Definition, publish a configuration
              that names its inputs, parameters and output Dataset, then run it
              manually or on a schedule.
            </EmptyDescription>
            {canManage && (
              <EmptyActions>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> Create Pipeline
                </Button>
              </EmptyActions>
            )}
          </Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {definitions.map((definition) => (
              <PipelineCard key={definition.id} definition={definition} />
            ))}
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

function PipelineCard({ definition }: { definition: PipelineDefinitionWire }) {
  return (
    <Link
      to="/pipelines/$definitionId"
      params={{ definitionId: definition.id }}
    >
      <Card className="h-full transition-colors hover:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            {definition.name}
            <Badge
              variant={
                definition.lifecycle === 'active' ? 'default' : 'secondary'
              }
            >
              {definition.lifecycle}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-1 text-sm">
          <p className="font-mono text-xs">{definition.key}</p>
          {definition.description && (
            <p className="line-clamp-2">{definition.description}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
