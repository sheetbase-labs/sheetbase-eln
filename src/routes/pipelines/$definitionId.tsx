/**
 * AUTO-03 — Pipeline Definition detail: versions, configuration editor, run
 * history and schedules.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useShell } from '#/components/shell'
import { PipelineVersionEditor } from '#/components/pipelines/pipeline-version-editor'
import { PipelineRunHistory } from '#/components/pipelines/pipeline-run-history'
import { PipelineWebhookTrigger } from '#/components/pipelines/pipeline-webhook-trigger'
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
  const [editorDirty, setEditorDirty] = useState(false)
  const [runVersionId, setRunVersionId] = useState('')
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
  const runVersion =
    versions.find(
      (version) => version.id === runVersionId && version.lifecycle !== 'draft',
    ) ??
    latestPublished ??
    versions.find((version) => version.lifecycle === 'retired') ??
    null
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
    fullBleed: true,
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <PageHeader
          compact
          title={definition.name}
          description={definition.description ?? ''}
          className="border-0 pb-4"
        >
          <Badge className="self-start" variant={'secondary'}>
            {definition.lifecycle}
          </Badge>
        </PageHeader>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-6 md:px-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Build</TabsTrigger>
            <TabsTrigger value="runs">Run history</TabsTrigger>
            <TabsTrigger value="schedules">Triggers</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>

          <TabsContent
            forceMount
            value="editor"
            className={tab === 'editor' ? 'max-w-6xl' : 'hidden'}
          >
            <p className="mb-4 text-sm text-muted-foreground">
              {latestPublished
                ? `Published v${latestPublished.version} is available to run. Save a new draft to change what happens next.`
                : 'Set up the steps and output, save a draft, then publish it to enable runs and triggers.'}
            </p>
            <PipelineVersionEditor
              key={`${draft?.id ?? 'new'}:${draft?.revision ?? latestPublished?.id ?? 'first'}`}
              initialConfiguration={latestPublished?.configuration}
              onDirtyChange={setEditorDirty}
              dataClient={dataClient}
              workspaceId={workspaceId}
              definitionId={definitionId}
              draft={draft}
              canManage={canManage}
            />
            {draft && canManage && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  disabled={publishMutation.isPending || editorDirty}
                  onClick={() => publishMutation.mutate()}
                >
                  Publish v{draft.version}
                </Button>
                <span className="text-muted-foreground text-xs">
                  {editorDirty
                    ? 'Save your changes before publishing.'
                    : 'Publish this saved draft to make it available for runs.'}
                </span>
              </div>
            )}
            {publishMutation.isError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                Could not publish this draft. Check its configuration and try
                again.
              </p>
            )}
            {publishMutation.isSuccess && !draft && (
              <p role="status" className="mt-3 text-sm">
                Version published.{' '}
                <Button variant="link" onClick={() => setTab('runs')}>
                  Run this pipeline
                </Button>
              </p>
            )}
          </TabsContent>

          <TabsContent value="runs" className="max-w-5xl">
            {runVersion ? (
              <>
                <label className="mb-3 flex items-center gap-2 text-xs">
                  Version
                  <select
                    className="h-8 rounded-md border bg-background px-2"
                    aria-label="Run history version"
                    value={runVersion.id}
                    onChange={(e) => setRunVersionId(e.target.value)}
                  >
                    {versions
                      .filter((version) => version.lifecycle !== 'draft')
                      .map((version) => (
                        <option key={version.id} value={version.id}>
                          v{version.version}
                          {version.lifecycle === 'retired' ? ' · retired' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <PipelineRunHistory
                  key={runVersion.id}
                  dataClient={dataClient}
                  workspaceId={workspaceId}
                  version={runVersion}
                  config={configForVersion(runVersion.id) ?? emptyConfig()}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Publish your first version in Build, then choose Run to supply
                inputs and start it.
              </p>
            )}
          </TabsContent>

          <TabsContent value="schedules" className="max-w-5xl">
            {latestPublished ? (
              <div className="space-y-6">
                <PipelineSchedules
                  dataClient={dataClient}
                  workspaceId={workspaceId}
                  definitionId={definitionId}
                  config={latestConfig ?? emptyConfig()}
                  canManage={canManage}
                />
                <PipelineWebhookTrigger
                  definitionId={definitionId}
                  canManage={canManage}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Publish a version in Build before adding triggers.
              </p>
            )}
          </TabsContent>

          <TabsContent value="versions" className="max-w-5xl">
            {retireMutation.isError && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                Could not retire this version. Try again.
              </p>
            )}
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
