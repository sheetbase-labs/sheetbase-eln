import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import {
  publishPipelineDefinitionVersion,
  startPipelineRun,
} from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  currentVersion,
  draftVersion,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline detail frame. */
export const Route = createFileRoute('/pipelines/$pipelineId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: PipelineLayout,
})

function PipelineLayout() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const matchRoute = useMatchRoute()
  const onRun = Boolean(
    matchRoute({ to: '/pipelines/$pipelineId/runs/$runId', fuzzy: true }),
  )
  const queryClient = useQueryClient()
  const definition = usePipelineDefinition(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const current = currentVersion(list)
  const draft = draftVersion(list)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const run = useMutation({
    mutationFn: () => {
      if (!current) throw new Error('This pipeline has no version to run.')
      return startPipelineRun(notebookDataClient, {
        workspaceId,
        definitionVersionId: current.id,
        triggerKind: 'manual',
      })
    },
    onSuccess: () => {
      void invalidate()
      toast('Run started', {
        description: 'Inputs are pinned to the latest snapshots.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not start the run', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const publish = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('There is no draft to publish.')
      return publishPipelineDefinitionVersion(notebookDataClient, {
        workspaceId,
        versionId: draft.id,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast('Draft published', {
        description:
          'New runs use it. Runs already going keep the old version.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not publish', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const d = definition.data
  if (onRun) return <Outlet />
  if (!d) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/pipelines" className="text-link">
              Pipelines
            </Link>
          }
          title={
            definition.isLoading ? 'Loading pipeline…' : 'Pipeline not found'
          }
        />
      </div>
    )
  }
  const params = { pipelineId: d.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/pipelines" className="text-link">
              Pipelines
            </Link>{' '}
            / <span className="mono">{d.key}</span>
          </>
        }
        title={d.name}
        meta={
          <>
            {draft ? (
              <Status tone="draft">Draft v{draft.version}</Status>
            ) : current ? (
              <Status tone={versionStatus(current.lifecycle).tone}>
                {versionStatus(current.lifecycle).label} v{current.version}
              </Status>
            ) : (
              <Status tone="draft">No version yet</Status>
            )}
            <span className="max-lg:hidden">{d.description}</span>
          </>
        }
        actions={
          <>
            <Button
              icon="play"
              disabled={
                !current || current.lifecycle === 'draft' || run.isPending
              }
              onClick={() => run.mutate()}
            >
              Run now
            </Button>
            {draft ? (
              <Button
                variant="primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                Publish draft
              </Button>
            ) : null}
          </>
        }
        tabs={
          <LinkTabs
            tabs={[
              {
                label: 'Overview',
                link: {
                  to: '/pipelines/$pipelineId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: 'Runs',
                count: runs.data?.length,
                link: { to: '/pipelines/$pipelineId/runs', params },
              },
              {
                label: 'Steps',
                link: { to: '/pipelines/$pipelineId/steps', params },
              },
              {
                label: 'Triggers',
                link: { to: '/pipelines/$pipelineId/triggers', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
