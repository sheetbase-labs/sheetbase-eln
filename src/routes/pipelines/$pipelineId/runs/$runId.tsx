import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { Banner, Notice } from '#/components/v3/ui/alert'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from '#/components/v3/ui/confirm-dialog'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  PageHeader,
} from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { NotFoundNotice } from '#/components/v3/ui/not-found-notice'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import { RunPromptPanel } from '#/components/v3/pipelines/run-prompt'
import { AddRunToNotebook } from '#/components/v3/pipelines/add-run-to-notebook'
import { RunDeliveriesPanel } from '#/components/v3/pipelines/run-deliveries'
import { RunLog } from '#/components/v3/pipelines/run-log'
import { RunStepsRail } from '#/components/v3/pipelines/run-steps-rail'
import { RunResult } from '#/components/v3/pipelines/run-result'
import { explainRunError } from '#/lib/pipelines/run-errors'
import {
  answerPipelineRunPrompt,
  cancelPipelineRun,
} from '#/lib/pipelines/data'
import type { PipelineRunPromptAnswer } from '#/lib/pipelines/data'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import { triggerLabel } from '#/lib/pipeline-schedule-form'
import { runCitation } from '#/lib/pipelines/run-notebook'
import { runSteps } from '#/lib/pipelines/run-steps'
import { countOf } from '#/lib/plural'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  pipelineDataQueryKeys,
  readDeliveryIds,
  useDatasetNames,
  useRunInputs,
  runDuration,
  runStatus,
  usePipelineDefinition,
  usePipelineVersions,
  usePipelineRun,
  useRunDeliveries,
  useRunNumbers,
  useRunLogs,
  useRunOutputs,
  useRunPrompts,
  useWorkspaceMemberNames,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): a pipeline run's record — status, log, inputs
 * used and outputs kept; a `waiting` run also shows its confirm prompt and the
 * controls that answer it (PIPE-02.4). */
export const Route = createFileRoute('/pipelines/$pipelineId/runs/$runId')({
  component: RunPage,
})

function RunPage() {
  const { pipelineId, runId } = Route.useParams()
  const navigate = useNavigate()
  const run = usePipelineRun(runId)
  const logs = useRunLogs(runId)
  const outputs = useRunOutputs(runId)
  const datasetNames = useDatasetNames(
    (outputs.data ?? []).map((o) => o.dataset_id),
  )
  const runInputs = useRunInputs(Object.values(run.data?.input_versions ?? {}))
  // Re-render when the person's time zone is applied or changed.
  useDisplayTimeZone()
  const prompts = useRunPrompts(runId)
  const members = useWorkspaceMemberNames()
  const versions = usePipelineVersions(pipelineId)
  const definition = usePipelineDefinition(pipelineId)
  const numbers = useRunNumbers(versions.data ?? [])
  const deliveryIds = readDeliveryIds(run.data?.result ?? {})
  const deliveries = useRunDeliveries(runId, deliveryIds)
  const queryClient = useQueryClient()
  const answer = useMutation({
    mutationFn: (value: PipelineRunPromptAnswer) =>
      answerPipelineRunPrompt(runId, value),
    onSuccess: (_updated, value) => {
      toast(
        value.decision === 'stop'
          ? t('data.pipelineRun.answerRecordedRunStopped')
          : value.decision === 'skip'
            ? t('data.pipelineRun.answerRecordedRunResuming')
            : t('data.pipelineRun.answerRecordedRunResuming2'),
      )
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.run(runId),
      })
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.runPrompts(runId),
      })
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.runLogs(runId),
      })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineRun.couldAnswerRun'),
      ),
  })
  const version = (versions.data ?? []).find(
    (v) => v.id === run.data?.definition_version_id,
  )
  const r = run.data
  // A retry is pinned to the version the run failed on. When the pipeline has
  // since published a newer version, the same inputs can be run on that one.
  const currentPublished = (versions.data ?? []).find(
    (v) => v.lifecycle === 'published',
  )
  const canRerunOnCurrent =
    !!r &&
    (r.status === 'failed' || r.status === 'cancelled') &&
    !!currentPublished &&
    currentPublished.id !== r.definition_version_id
  // The newest prompt is the one a waiting run is paused on.
  const promptList = prompts.data ?? []
  const prompt = promptList.length
    ? promptList[promptList.length - 1]
    : undefined
  const launcher = useRunLauncher(
    r?.workspace_id ?? '',
    (started) =>
      void navigate({
        to: '/pipelines/$pipelineId/runs/$runId',
        params: { pipelineId, runId: started.id },
      }),
  )
  const nameOf = (userId: string) => members.data?.[userId] ?? userId
  // A running run is stopped through api.cancel_pipeline_run; a waiting run is
  // moved on by answering its prompt (a Stop decision cancels it there).
  const cancel = useMutation({
    mutationFn: () => {
      if (!r) throw new Error(t('data.pipelineRun.runLoadedYet'))
      return cancelPipelineRun(notebookDataClient, {
        workspaceId: r.workspace_id,
        runId,
      })
    },
    onSuccess: () => {
      toast(t('data.pipelineRun.runCancelled'), {
        description: t('data.pipelineRun.stopsNextSafePoint'),
      })
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.run(runId),
      })
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.runLogs(runId),
      })
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.list,
      })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineRun.couldCancelRun'),
      ),
  })

  if (!r) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('data.pipelineRun.pipelines'),
              link: { to: '/pipelines' },
            },
          ]}
          title={
            run.isLoading
              ? t('data.pipelineRun.loadingRun')
              : run.isError
                ? t('data.pipelineRun.runCouldLoaded')
                : t('data.pipelineRun.runFound')
          }
        />
        <div className="px-4 py-4 md:px-6">
          {run.isError ? (
            <ProjectListFailure
              error={run.error}
              what={t('data.pipelineRun.thisRun')}
              onRetry={() => void run.refetch()}
            />
          ) : run.isLoading ? null : (
            <NotFoundNotice
              what="run"
              action={
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to="/pipelines/$pipelineId/runs"
                      params={{ pipelineId }}
                    />
                  }
                >
                  {t('data.pipelineRun.backRuns')}
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  const status = runStatus(r.status)
  const guidance = explainRunError(r.error_code)
  // What the run's own log said at the point it stopped, when it said anything.
  const failureLine = [...(logs.data ?? [])]
    .reverse()
    .find((entry) => entry.level === 'error')?.message
  const number = numbers.data?.get(r.id)
  const runLabel = number ? `#${number}` : r.id.slice(0, 8)
  const steps = runSteps(
    version?.configuration ?? {},
    r,
    logs.data ?? [],
    prompt,
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('data.pipelineRun.pipelines'),
            link: { to: '/pipelines' },
          },
          {
            label:
              definition.data?.display_id ??
              definition.data?.name ??
              t('data.pipelineRun.pipeline'),
            mono: Boolean(definition.data?.display_id),
            link: { to: '/pipelines/$pipelineId', params: { pipelineId } },
          },
          {
            label: t('data.pipelineRun.runs'),
            link: {
              to: '/pipelines/$pipelineId/runs',
              params: { pipelineId },
            },
          },
          { label: runLabel, mono: true },
        ]}
        title={t('data.pipelineRun.run', {
          runLabel,
          value: definition.data?.name ?? 'Pipeline',
        })}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>
              {t('data.pipelineRun.started')}{' '}
              {triggerLabel(r.trigger_kind).toLowerCase()}
            </span>
            <span>
              {t('data.pipelineRun.started2', {
                value: formatNotebookDateTime(r.started_at, { zone: true }),
              })}
            </span>
            <span>
              {t('data.pipelineRun.took')} {runDuration(r)}
            </span>
            {version ? (
              <span>
                {t('data.pipelineRun.version')} {version.version}
              </span>
            ) : null}
          </>
        }
        actions={
          r.status === 'failed' || r.status === 'cancelled' ? (
            <>
              {canRerunOnCurrent ? (
                <Button
                  size="sm"
                  icon="play"
                  disabled={launcher.pending}
                  onClick={() =>
                    launcher.launch({
                      pipelineName:
                        definition.data?.name ??
                        t('data.pipelineRun.thisPipeline'),
                      version: currentPublished,
                      rerunOn: r,
                    })
                  }
                >
                  {t('data.pipelineRun.retryCurrentVersionV', {
                    version: currentPublished.version,
                  })}
                </Button>
              ) : null}
              {guidance.fix ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to="/pipelines/$pipelineId/steps"
                      params={{ pipelineId }}
                    />
                  }
                >
                  {t('data.pipelineRun.editPipeline')}
                </Button>
              ) : null}
              {guidance.retryHelps || r.status === 'cancelled' ? (
                <Button
                  size="sm"
                  icon="play"
                  disabled={!version || launcher.pending}
                  onClick={() =>
                    version &&
                    launcher.launch({
                      pipelineName:
                        definition.data?.name ??
                        t('data.pipelineRun.thisPipeline'),
                      version,
                      retryOf: r,
                    })
                  }
                >
                  {canRerunOnCurrent
                    ? t('data.pipelineRun.retryV', {
                        value: version?.version ?? '',
                      })
                    : t('data.pipelineRun.retryRun')}
                </Button>
              ) : null}
            </>
          ) : r.status === 'succeeded' ? (
            <AddRunToNotebook
              paragraphs={runCitation(r, {
                pipeline: {
                  id: pipelineId,
                  name: definition.data?.name ?? 'pipeline',
                },
                versionNumber: version?.version ?? null,
                inputs: Object.entries(r.input_versions).map(
                  ([name, versionId]) => ({
                    name,
                    datasetVersionId: versionId,
                    datasetId: runInputs.data?.[versionId]?.datasetId,
                    datasetName: runInputs.data?.[versionId]?.datasetName,
                    versionLabel: runInputs.data?.[versionId]?.versionLabel,
                  }),
                ),
                outputs: (outputs.data ?? []).map((output) => ({
                  label: output.label,
                  datasetVersionId: output.dataset_version_id,
                  datasetId: output.dataset_id,
                  datasetName: datasetNames.data?.[output.dataset_id],
                })),
              })}
            />
          ) : r.status === 'running' ? (
            <ConfirmDialog>
              <ConfirmDialogTrigger>
                <Button size="sm" variant="quiet" disabled={cancel.isPending}>
                  {t('data.pipelineRun.cancelRun')}
                </Button>
              </ConfirmDialogTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    {t('data.pipelineRun.cancelRun2')}
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    {t('data.pipelineRun.stopsNextSafePoint2')}
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel />
                  <ConfirmDialogAction
                    variant="danger-fill"
                    onClick={() => cancel.mutate()}
                  >
                    {t('data.pipelineRun.cancelRun')}
                  </ConfirmDialogAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </ConfirmDialog>
          ) : undefined
        }
      />

      {r.status === 'failed' ? (
        <Banner tone="bad" icon="warn" title={guidance.title}>
          {r.error_message
            ? `${r.error_message.replace(/[.\s]+$/, '')}.`
            : t('data.pipelineRun.errorMessageRecordedRun')}{' '}
          {guidance.hint}{' '}
          <a href="#run-log" className="underline">
            {t('data.pipelineRun.seeLog')}
          </a>
          .
          {canRerunOnCurrent
            ? t('data.pipelineRun.retryCurrentVersionRuns', {
                value: String(currentPublished.version),
              })
            : ''}
        </Banner>
      ) : null}

      {r.status === 'waiting' ? (
        <Banner
          tone="warn"
          icon="pause"
          title={t('data.pipelineRun.runWaiting')}
        >
          {prompt && typeof prompt.form_schema.description === 'string'
            ? prompt.form_schema.description
            : t('data.pipelineRun.pausedConfirmStepChange')}
        </Banner>
      ) : null}

      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto">
        <RunStepsRail steps={steps} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-5">
          {prompt ? (
            <RunPromptPanel
              prompt={prompt}
              canAnswer={r.status === 'waiting'}
              nameOf={nameOf}
              onAnswer={(value) => answer.mutate(value)}
              submitting={answer.isPending}
              error={
                answer.isError
                  ? answer.error instanceof Error
                    ? answer.error.message
                    : t('data.pipelineRun.couldAnswerRun')
                  : null
              }
            />
          ) : r.status === 'waiting' ? (
            // A waiting run always raises a prompt; if it is not here yet (or
            // not readable), say so rather than leave the banner's promise
            // without a control.
            <Notice tone="info">
              {prompts.isLoading
                ? t('data.pipelineRun.loadingDecisionPrompt')
                : t('data.pipelineRun.runWaitingDecisionBut')}
            </Notice>
          ) : null}

          {r.status === 'failed' && failureLine ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border bg-surface p-3">
                <h3 className="m-0 font-sans text-label font-semibold">
                  {t('data.pipelineRun.likelyCause')}
                </h3>
                <p className="m-0 mt-1 text-label text-fg-muted">
                  {failureLine}
                </p>
              </div>
              <div className="rounded-md border border-border bg-surface p-3">
                <h3 className="m-0 font-sans text-label font-semibold">
                  {t('data.pipelineRun.waysFix')}
                </h3>
                <p className="m-0 mt-1 text-label text-fg-muted">
                  {guidance.hint}
                </p>
              </div>
            </div>
          ) : null}

          {r.status === 'succeeded' ? (
            <RunResult
              run={r}
              pipelineId={pipelineId}
              outputs={outputs.data ?? []}
              datasetNames={datasetNames.data ?? {}}
            />
          ) : null}

          <RunDeliveriesPanel
            deliveries={deliveries.data ?? []}
            runStatus={r.status}
            queuedCount={deliveryIds.length}
            isLoading={deliveries.isLoading && deliveryIds.length > 0}
          />

          <section
            id="run-log"
            className="flex flex-col gap-2 border-t border-border pt-4"
          >
            <h2 className="m-0 font-sans text-label font-semibold">
              {t('data.pipelineRun.executionLog')}
            </h2>
            <Muted>
              {t('data.pipelineRun.recordedStagesDiagnosticsAttempt')}
            </Muted>
            <RunLog logs={logs.data ?? []} />
          </section>
        </div>

        <Inspector
          aria-label={t('data.pipelineRun.ariaRunDetails')}
          className="w-[320px]"
        >
          {prompt ? (
            <InspectorSection title={t('data.pipelineRun.asked')}>
              {prompt.asked_user_ids.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                  {prompt.asked_user_ids.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ul>
              ) : (
                <Muted>{t('data.pipelineRun.oneNamed')}</Muted>
              )}
              <Muted className="mt-1.5">
                {prompt.answered_at
                  ? t('data.pipelineRun.answered', {
                      value: formatNotebookDateTime(prompt.answered_at, {
                        zone: true,
                      }),
                    })
                  : prompt.expires_at
                    ? t('data.pipelineRun.expires', {
                        value: formatNotebookDateTime(prompt.expires_at, {
                          zone: true,
                        }),
                      })
                    : t('data.pipelineRun.expirySet')}
              </Muted>
            </InspectorSection>
          ) : null}
          <InspectorSection title={t('data.pipelineRun.inputsUsed')}>
            {Object.keys(r.input_versions).length ? (
              <DescriptionList
                labelWidth={90}
                items={Object.entries(r.input_versions).map(([k, v]) => {
                  const info = runInputs.data?.[v]
                  return [
                    k,
                    info ? (
                      <Link
                        key={k}
                        to="/datasets/$datasetId/snapshots"
                        params={{ datasetId: info.datasetId }}
                        className="underline"
                      >
                        {info.datasetName} · {info.versionLabel}
                      </Link>
                    ) : (
                      v.slice(0, 8)
                    ),
                  ]
                })}
              />
            ) : (
              <Muted>{t('data.pipelineRun.inputsPinned')}</Muted>
            )}
          </InspectorSection>
          <InspectorSection title={t('data.pipelineRun.kept')}>
            {(outputs.data ?? []).length ? (
              <Muted>
                {(outputs.data ?? []).length === 1
                  ? t('data.pipelineRun.n1DatasetSaved')
                  : `${countOf((outputs.data ?? []).length, 'dataset')} saved`}
              </Muted>
            ) : (
              <Muted>{t('data.pipelineRun.nothing')}</Muted>
            )}
          </InspectorSection>
          <InspectorSection title={t('data.pipelineRun.parameters')}>
            {Object.keys(r.parameters).length ? (
              <DescriptionList
                labelWidth={90}
                items={Object.entries(r.parameters).map(([k, v]) => [
                  k,
                  String(v),
                ])}
              />
            ) : (
              <Muted>{t('data.pipelineRun.noParameters')}</Muted>
            )}
          </InspectorSection>
          <InspectorSection title={t('data.pipelineRun.traceability')}>
            <DescriptionList
              labelWidth={100}
              items={[
                [t('data.pipelineRun.attempt'), String(r.attempt)],
                [
                  t('data.pipelineRun.inputDigest'),
                  r.input_digest?.slice(0, 12) ?? '—',
                ],
                [
                  t('data.pipelineRun.retryOf'),
                  r.retry_of_run_id ? r.retry_of_run_id.slice(0, 8) : '—',
                ],
              ]}
            />
          </InspectorSection>
        </Inspector>
      </div>
      {launcher.dialog}
    </div>
  )
}
