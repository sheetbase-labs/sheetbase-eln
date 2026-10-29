import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { publishPipelineDefinitionVersion } from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  currentVersion,
  draftVersion,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'
import { NotFoundNotice } from '#/components/v3/ui/not-found-notice'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { validatePipelineConfig } from '#/lib/pipelines/config'

/** UI port (roadmap-4/ui-app3): the pipeline detail frame. */
export const Route = createFileRoute('/pipelines/$pipelineId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'pipeline',
      ref: params.pipelineId,
      href: location.href,
    })
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
  const onSteps = Boolean(matchRoute({ to: '/pipelines/$pipelineId/steps' }))
  const queryClient = useQueryClient()
  const definition = usePipelineDefinition(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const current = currentVersion(list)
  const draft = draftVersion(list)

  // A draft that the contract would refuse cannot be published; say why.
  const draftProblems = draft ? validatePipelineConfig(draft.configuration) : []

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const navigate = useNavigate()
  const run = useRunLauncher(
    workspaceId,
    (started) =>
      void navigate({
        to: '/pipelines/$pipelineId/runs/$runId',
        params: { pipelineId, runId: started.id },
      }),
  )

  const publish = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error(t('data.pipelinePage.thereDraftPublish'))
      return publishPipelineDefinitionVersion(notebookDataClient, {
        workspaceId,
        versionId: draft.id,
      })
    },
    onSuccess: () => {
      void invalidate()
      toast(t('data.pipelinePage.draftPublished'), {
        description: t('data.pipelinePage.newRunsUseRuns'),
      })
    },
    onError: (error: unknown) =>
      toast(t('data.pipelinePage.couldPublish'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.pipelinePage.databaseRefused'),
      }),
  })

  const d = definition.data
  if (onRun) return <Outlet />
  if (!d) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('data.pipelinePage.pipelines'),
              link: { to: '/pipelines' },
            },
          ]}
          title={
            definition.isLoading
              ? t('data.pipelinePage.loadingPipeline')
              : definition.isError
                ? t('data.pipelinePage.pipelineCouldLoaded')
                : t('data.pipelinePage.pipelineFound')
          }
        />
        <div className="px-4 py-4 md:px-6">
          {definition.isError ? (
            <ProjectListFailure
              error={definition.error}
              what={t('data.pipelinePage.thisPipeline')}
              onRetry={() => void definition.refetch()}
            />
          ) : definition.isLoading ? null : (
            <NotFoundNotice
              what="pipeline"
              action={
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/pipelines" />}
                >
                  {t('data.pipelinePage.backPipelines')}
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }
  const params = { pipelineId: d.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('data.pipelinePage.pipelines'),
            link: { to: '/pipelines' },
          },
          { label: d.display_id ?? d.key, mono: true },
        ]}
        title={d.name}
        meta={
          <>
            {draft ? (
              <Status tone="draft">
                {t('data.pipelinePage.draftV')}
                {draft.version}
              </Status>
            ) : current ? (
              <Status tone={versionStatus(current.lifecycle).tone}>
                {versionStatus(current.lifecycle).label} v{current.version}
              </Status>
            ) : (
              <Status tone="draft">{t('data.pipelinePage.versionYet')}</Status>
            )}
            <span>
              {current?.lifecycle === 'published'
                ? t('data.pipelinePage.runsUsePublishedV', {
                    version: current.version,
                  })
                : t('data.pipelinePage.publishVersionEnableRuns')}
            </span>
            <span className="max-lg:hidden">{d.description}</span>
          </>
        }
        actions={
          <>
            <Button
              icon="play"
              disabled={
                !current || current.lifecycle !== 'published' || run.pending
              }
              title={
                current?.lifecycle === 'published'
                  ? t('data.pipelinePage.runPublishedV', {
                      version: current.version,
                    })
                  : t('data.pipelinePage.publishVersionEnableRuns')
              }
              onClick={() =>
                current &&
                run.launch({ pipelineName: d.name, version: current })
              }
            >
              {t('data.pipelinePage.runNow')}
            </Button>
            {draft && !onSteps ? (
              <Button
                variant="primary"
                disabled={publish.isPending || draftProblems.length > 0}
                title={
                  draftProblems.length
                    ? t('data.pipelinePage.finishDraftStepsTab', {
                        message: draftProblems[0].message,
                      })
                    : undefined
                }
                onClick={() => publish.mutate()}
              >
                {t('data.pipelinePage.publishSavedDraft')}
              </Button>
            ) : null}
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('data.pipelinePage.pipelineSections')}
            items={[
              {
                label: t('data.pipelinePage.overview'),
                link: {
                  to: '/pipelines/$pipelineId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: t('data.pipelinePage.steps'),
                link: { to: '/pipelines/$pipelineId/steps', params },
              },
              {
                label: t('data.pipelinePage.runs'),
                count: runs.data?.length,
                link: { to: '/pipelines/$pipelineId/runs', params },
              },
              {
                label: t('data.pipelinePage.triggersOutputs'),
                link: { to: '/pipelines/$pipelineId/triggers', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
      {run.dialog}
    </div>
  )
}
