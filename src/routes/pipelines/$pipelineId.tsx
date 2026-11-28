import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'

import { useMemo } from 'react'

import { t } from '#/copy'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { PageHeader } from '#/components/ui/layout'
import { RecordPage } from '#/components/record-page/record-page'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { PublishButton } from '#/components/pipelines/activity/publish-button'
import { usePublishApproval } from '#/components/pipelines/activity/use-publish-approval'
import { Button } from '#/components/ui/button'
import { RunDialog } from '#/components/pipelines/run-dialog'
import { VersionFileSidebar } from '#/components/pipelines/advanced/version-file-sidebar'
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
import { useWorkspaceMemberNames } from '#/components/pipelines/pipelines-data'

import {
  pipelineFacts,
  pipelineStatus,
  pipelineTabs,
} from './-pipeline-header-data'

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
  const startingTemplate = useSearch({ strict: false }).template
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
  const { simple } = editor

  // Something new to publish: a saved draft, or edits not saved yet.
  const changed = Boolean(draft) || (simple ? simple.dirty : editor.dirty)

  const canPublish = changed && (simple ? simple.complete : editor.canSave)

  const owner = d.created_by_user_id ? members[d.created_by_user_id] : undefined

  // A pipeline started from a template is Simple until it has a version of its own.
  const mode =
    !current && !draft && startingTemplate
      ? 'simple'
      : (editor.config?.mode ?? 'standard')

  return (
    <PipelineEditorProvider value={editor}>
      <div className="flex min-h-0 min-w-0 flex-1">
        <RecordPage
          recordId={null}
          trail={[
            {
              label: t('data.pipelinePage.pipelines'),
              link: { to: '/pipelines' },
            },
            { label: d.display_id ?? d.key, mono: true },
          ]}
          title={d.name}
          identifier={d.display_id ?? d.key}
          status={pipelineStatus(current, draft)}
          facts={pipelineFacts({ current, owner, mode })}
          actionsOwnMenu
          actions={
            <>
              <FavouriteToggle kind="pipeline" objectId={d.id} />
              <Button
                icon="play"
                disabled={
                  editor.tryDraft.isPending || !editor.canSave || !editor.shown
                }
                onClick={editor.startTrial}
              >
                {editor.tryDraft.isPending
                  ? t('data.pipelineSteps.trying')
                  : changed
                    ? t('data.pipelineHeader.tryDraft')
                    : t('data.pipelineHeader.tryIt')}
              </Button>
              {changed ? (
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
              ) : null}
              <PipelineMenu
                canRun={current?.lifecycle === 'published' && !run.pending}
                onRun={() =>
                  current &&
                  run.launch({ pipelineName: d.name, version: current })
                }
              />
            </>
          }
          stateLine={
            current?.lifecycle === 'published' ? null : (
              <RecordStateLine tone="info">
                {t('data.pipelineHeader.notPublishedLine')}
              </RecordStateLine>
            )
          }
          tabs={pipelineTabs({
            params,
            steps: editor.config?.steps.length,
            runs: editor.runs.data?.length,
          })}
          overlays={
            <>
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
            </>
          }
          fill
        >
          <Outlet />
        </RecordPage>
        {onSteps && mode !== 'simple' ? (
          editor.advanced ? (
            <VersionFileSidebar />
          ) : (
            <StepInspector />
          )
        ) : null}
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
