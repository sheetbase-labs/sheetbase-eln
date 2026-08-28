/**
 * AUTO-03 — Pipeline Definition detail: versions, configuration editor, run
 * history and schedules.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useShell } from '#/components/app-shell'
import { PipelineVersionEditor } from '#/components/pipelines/pipeline-version-editor'
import { PipelineRunHistory } from '#/components/pipelines/pipeline-run-history'
import { PipelineSchedules } from '#/components/pipelines/pipeline-schedules'
import {
  Badge,
  Button,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import { hasCapability } from '#/lib/capability'
import { validatePipelineConfig } from '#/lib/pipelines/config'
import type { PipelineConfig } from '#/lib/pipelines/config'
import {
  getPipelineDefinition,
  listPipelineDefinitionVersions,
  pipelineQueryKeys,
  publishPipelineDefinitionVersion,
  retirePipelineDefinitionVersion,
} from '#/lib/pipelines/data'

export const Route = createFileRoute('/pipelines/$definitionId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: PipelineDefinitionRoute,
})

const dataClient = createDataClient()

function PipelineDefinitionRoute() {
  const { definitionId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const [tab, setTab] = useState('editor')
  const queryClient = useQueryClient()

  const definitionQuery = useQuery({
    queryKey: pipelineQueryKeys.definition(definitionId),
    queryFn: () => getPipelineDefinition(dataClient, definitionId),
    enabled: Boolean(workspaceId),
  })
  const versionsQuery = useQuery({
    queryKey: pipelineQueryKeys.versions(definitionId),
    queryFn: () => listPipelineDefinitionVersions(dataClient, definitionId),
    enabled: Boolean(workspaceId),
  })

  const canManage = hasCapability(context.workspace?.role, 'pipelines.manage')
  const definition = definitionQuery.data
  const versions = versionsQuery.data ?? []

  const draft = versions.find((v) => v.lifecycle === 'draft') ?? null
  const latestPublished = useMemo(() => {
    const published = versions
      .filter((v) => v.lifecycle === 'published')
      .sort((a, b) => b.version - a.version)
    return published.at(0) ?? null
  }, [versions])

  const configForVersion = (versionId: string): PipelineConfig | null => {
    const version = versions.find((v) => v.id === versionId)
    if (!version) return null
    const errors = validatePipelineConfig(version.configuration)
    return errors.length === 0
      ? (version.configuration as unknown as PipelineConfig)
      : null
  }
  const latestConfig = latestPublished
    ? configForVersion(latestPublished.id)
    : null

  const publishMutation = useMutation({
    mutationFn: () =>
      publishPipelineDefinitionVersion(dataClient, {
        workspaceId,
        versionId: draft!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.versions(definitionId),
      })
    },
  })

  const retireMutation = useMutation({
    mutationFn: (versionId: string) =>
      retirePipelineDefinitionVersion(dataClient, {
        workspaceId,
        versionId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.versions(definitionId),
      })
    },
  })

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Pipelines', to: '/pipelines' },
      { label: definition?.name ?? 'Pipeline' },
    ],
  })

  if (definitionQuery.isLoading || versionsQuery.isLoading) {
    return <Skeleton className="m-4 h-40" />
  }
  if (!definition) {
    return (
      <p role="alert" className="text-destructive m-4 text-sm">
        Pipeline Definition not found.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4">
        <PageHeader
          eyebrow={definition.key}
          title={definition.name}
          description={definition.description ?? ''}
          className="border-0 pb-4"
        >
          <Badge
            variant={
              definition.lifecycle === 'active' ? 'default' : 'secondary'
            }
          >
            {definition.lifecycle}
          </Badge>
        </PageHeader>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-8">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Configuration</TabsTrigger>
            <TabsTrigger value="runs">Run history</TabsTrigger>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="max-w-3xl">
            <PipelineVersionEditor
              dataClient={dataClient}
              workspaceId={workspaceId}
              definitionId={definitionId}
              draft={draft}
              canManage={canManage}
            />
            {draft && canManage && (
              <div className="mt-4 flex items-center gap-2 border-t pt-4">
                <Button
                  disabled={publishMutation.isPending}
                  onClick={() => publishMutation.mutate()}
                >
                  Publish v{draft.version}
                </Button>
                <span className="text-muted-foreground text-xs">
                  Publishing freezes this version as the reproducible contract
                  runs pin.
                </span>
              </div>
            )}
            {!draft && canManage && (
              <p className="text-muted-foreground mt-4 text-xs">
                No draft yet — edit above to create the first draft version.
              </p>
            )}
          </TabsContent>

          <TabsContent value="runs" className="max-w-5xl">
            {latestPublished ? (
              <PipelineRunHistory
                dataClient={dataClient}
                workspaceId={workspaceId}
                version={latestPublished}
                config={latestConfig ?? emptyConfig()}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                Publish a version before running. Runs pin the exact published
                configuration that produced them.
              </p>
            )}
          </TabsContent>

          <TabsContent value="schedules" className="max-w-3xl">
            <PipelineSchedules
              dataClient={dataClient}
              workspaceId={workspaceId}
              definitionId={definitionId}
              config={latestConfig ?? emptyConfig()}
              canManage={canManage}
            />
          </TabsContent>

          <TabsContent value="versions" className="max-w-3xl">
            <div className="space-y-2">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      v{version.version}{' '}
                      <Badge
                        variant={
                          version.lifecycle === 'published'
                            ? 'default'
                            : version.lifecycle === 'draft'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="ml-2"
                      >
                        {version.lifecycle}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      revision {String(version.revision)} · created{' '}
                      {version.created_at.slice(0, 16).replace('T', ' ')}
                      {version.published_at
                        ? ` · published ${version.published_at.slice(0, 16).replace('T', ' ')}`
                        : ''}
                    </p>
                  </div>
                  {version.lifecycle === 'published' && canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retireMutation.mutate(version.id)}
                      disabled={retireMutation.isPending}
                    >
                      Retire
                    </Button>
                  )}
                </div>
              ))}
              {versions.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No versions yet.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function emptyConfig(): PipelineConfig {
  return {
    configVersion: 1,
    description: '',
    parameters: [],
    inputs: [{ name: 'input', required: true }],
    transform: { language: 'sql', statement: 'SELECT * FROM input' },
    output: {
      mode: 'create',
      schemaVersionId: '',
      datasetName: '',
      datasetLabel: 'pipeline output',
      fieldMapping: null,
    },
  }
}
