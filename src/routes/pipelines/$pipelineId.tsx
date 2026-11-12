import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'

import { useMemo } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { PageHeader } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { PublishButton } from '#/components/pipelines/activity/publish-button'
import { usePublishApproval } from '#/components/pipelines/activity/use-publish-approval'
import { Status } from '#/components/ui/status'
import { Button } from '#/components/ui/button'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { RunDialog } from '#/components/pipelines/run-dialog'
import { StepInspector } from '#/components/pipelines/step-list/inspector'
import { PipelineMenu } from '#/components/pipelines/step-list/pipeline-menu'
import {
  PipelineEditorProvider,
  usePipelineEditorModel,
} from '#/components/pipelines/step-list/use-pipeline-editor'
import { NotFoundNotice } from '#/components/ui/not-found-notice'
import { ProjectListFailure } from '#/components/projects/project-list'
import { useRunLauncher } from '#/components/pipelines/use-run-launcher'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import {
  useWorkspaceMemberNames,
  versionStatus,
} from '#/components/pipelines/pipelines-data'

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

function usePipelineLayout() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const matchRoute = useMatchRoute()

  const onRun = Boolean(
    matchRoute({ to: '/pipelines/$pipelineId/runs/$runId', fuzzy: true }),
  )

  const onSteps = Boolean(matchRoute({ to: '/pipelines/$pipelineId/steps' }))
  const editor = usePipelineEditorModel(pipelineId, workspaceId)
  const members = useWorkspaceMemberNames()
  const navigate = useNavigate()

  const onRunStarted = (started: PipelineRunWire) => {
    void navigate({
      to: '/pipelines/$pipelineId/runs/$runId',
      params: { pipelineId, runId: started.id },
    })
  }

  const run = useRunLauncher(workspaceId, onRunStarted)

  const versionList = useMemo(
    () => editor.versions.data ?? [],
    [editor.versions.data],
  )

  const approval = usePublishApproval(
    versionList,
    {
      workspaceId,
      role: context.workspace?.role,
      userId: context.user.id,
    },
    editor.ensureDraft,
  )

  return {
    pipelineId,
    editor,
    approval,
    versionList,
    members: members.data ?? {},
    onRun,
    onSteps,
    run,
  }
}

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the layout owns the header, tabs, trial and publish dialogs that share one editor model.
function PipelineLayout() {
  const model = usePipelineLayout()
  const { editor, approval, versionList, members, onRun, onSteps, run } = model
  const { definition, current, draft } = editor
  const d = definition.data

  if (onRun) return <Outlet />

  if (!d) {
    return <PipelineUnavailable definition={definition} />
  }

  const params = { pipelineId: d.id }

  // What publishing would make: the saved draft, or the version after the published one.
  const nextVersion = draft?.version ?? (current ? current.version + 1 : 1)
  const canPublish = editor.canSave && (editor.dirty || Boolean(draft))
  const owner = d.created_by_user_id ? members[d.created_by_user_id] : undefined
  const mode = editor.config?.mode ?? 'standard'

  return (
    <PipelineEditorProvider value={editor}>
      <div className="flex min-h-0 min-w-0 flex-1">
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
                  <Status tone="draft">
                    {t('data.pipelinePage.versionYet')}
                  </Status>
                )}
                {current?.lifecycle === 'published' && current.published_at ? (
                  <span>
                    {t('data.pipelineHeader.publishedOn', {
                      version: current.version,
                      when: formatNotebookDateTime(current.published_at, {
                        zone: true,
                      }),
                    })}
                  </span>
                ) : (
                  <span>{t('data.pipelinePage.publishVersionEnableRuns')}</span>
                )}
                {owner ? (
                  <span>{t('data.pipelineHeader.owner', { name: owner })}</span>
                ) : null}
                <span
                  className="inline-flex items-center gap-1 text-fg-muted"
                  title={t('data.pipelineHeader.modeTitle')}
                >
                  <Icon name="pipeline" size={12} />
                  <b className="font-medium text-fg">
                    {t(`data.pipelineHeader.mode.${mode}`)}
                  </b>
                </span>
              </>
            }
            actions={
              <>
                <FavouriteToggle kind="pipeline" objectId={d.id} />
                <Button
                  icon="play"
                  disabled={
                    editor.tryDraft.isPending ||
                    !editor.canSave ||
                    !editor.shown
                  }
                  onClick={editor.startTrial}
                >
                  {editor.tryDraft.isPending
                    ? t('data.pipelineSteps.trying')
                    : t('data.pipelineHeader.tryDraft')}
                </Button>
                <PublishButton
                  pipelineId={d.id}
                  version={nextVersion}
                  draftId={draft?.id}
                  versions={versionList}
                  approval={approval}
                  disabled={!canPublish}
                  title={
                    editor.errors.length
                      ? t('data.pipelinePage.finishDraftStepsTab', {
                          message: editor.errors[0].message,
                        })
                      : undefined
                  }
                />
                <PipelineMenu
                  canRun={current?.lifecycle === 'published' && !run.pending}
                  onRun={() =>
                    current &&
                    run.launch({ pipelineName: d.name, version: current })
                  }
                />
              </>
            }
            tabs={
              <Tabs
                mode="url"
                label={t('data.pipelinePage.pipelineSections')}
                items={[
                  {
                    label: t('data.pipelinePage.steps'),
                    count: editor.config?.steps.length,
                    link: { to: '/pipelines/$pipelineId/steps', params },
                  },
                  {
                    label: t('data.pipelineHeader.startsAndRuns'),
                    count: editor.runs.data?.length,
                    link: { to: '/pipelines/$pipelineId/starts', params },
                  },
                  {
                    label: t('data.pipelineHeader.activity'),
                    link: { to: '/pipelines/$pipelineId/activity', params },
                  },
                ]}
              />
            }
          />
          <div className="flex min-h-0 flex-1">
            <Outlet />
          </div>
          {run.dialog}
          {editor.trialDialog ? (
            <RunDialog
              trial
              pipelineName={d.name}
              version={editor.draftAsVersion}
              initial={editor.trialDetails ?? undefined}
              busy={editor.tryDraft.isPending}
              onClose={() => editor.setTrialDialog(false)}
              onSubmit={editor.submitTrial}
            />
          ) : null}
        </div>
        {onSteps && mode !== 'simple' ? <StepInspector /> : null}
      </div>
    </PipelineEditorProvider>
  )
}

function PipelineUnavailable({
  definition,
}: Pick<ReturnType<typeof usePipelineLayout>['editor'], 'definition'>) {
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
