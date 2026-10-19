import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

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
import { TableBox } from '#/components/v3/ui/table'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import { NotFoundNotice } from '#/components/v3/ui/not-found-notice'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import { RunPromptPanel } from '#/components/v3/pipelines/run-prompt'
import { AddRunToNotebook } from '#/components/v3/pipelines/add-run-to-notebook'
import { RunDeliveriesPanel } from '#/components/v3/pipelines/run-deliveries'
import {
  answerPipelineRunPrompt,
  cancelPipelineRun,
} from '#/lib/pipelines/data'
import type { PipelineRunPromptAnswer } from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { runCitationLines } from '#/lib/pipelines/run-notebook'
import {
  pipelineDataQueryKeys,
  readDeliveryIds,
  runDuration,
  runStatus,
  usePipelineDefinition,
  usePipelineVersions,
  usePipelineRun,
  useRunDeliveries,
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
  type RunOutput = NonNullable<typeof outputs.data>[number]
  const outputColumns: RegistryColumn<RunOutput>[] = [
    { id: 'label', header: 'Label', cell: ({ row }) => row.original.label },
    {
      id: 'dataset',
      header: 'Dataset',
      cell: ({ row }) => (
        <Link
          to="/datasets/$datasetId/snapshots"
          params={{ datasetId: row.original.dataset_id }}
        >
          <span className="mono">{row.original.dataset_id.slice(0, 8)}</span>
        </Link>
      ),
    },
    {
      id: 'snapshot',
      header: 'Snapshot',
      cell: ({ row }) => (
        <span className="mono">
          {row.original.dataset_version_id.slice(0, 8)}
        </span>
      ),
    },
  ]
  const prompts = useRunPrompts(runId)
  const members = useWorkspaceMemberNames()
  const versions = usePipelineVersions(pipelineId)
  const definition = usePipelineDefinition(pipelineId)
  const deliveryIds = readDeliveryIds(run.data?.result ?? {})
  const deliveries = useRunDeliveries(runId, deliveryIds)
  const queryClient = useQueryClient()
  const answer = useMutation({
    mutationFn: (value: PipelineRunPromptAnswer) =>
      answerPipelineRunPrompt(runId, value),
    onSuccess: (_updated, value) => {
      toast(
        value.decision === 'stop'
          ? 'Answer recorded — the run stopped.'
          : value.decision === 'skip'
            ? 'Answer recorded — the run is resuming without the skipped step.'
            : 'Answer recorded — the run is resuming.',
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
        error instanceof Error ? error.message : 'Could not answer the run.',
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
      if (!r) throw new Error('This run is not loaded yet.')
      return cancelPipelineRun(notebookDataClient, {
        workspaceId: r.workspace_id,
        runId,
      })
    },
    onSuccess: () => {
      toast('Run cancelled', {
        description:
          'It stops at the next safe point; work already in flight finishes.',
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
        error instanceof Error ? error.message : 'Could not cancel the run.',
      ),
  })

  if (!r) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Pipelines', link: { to: '/pipelines' } }]}
          title={
            run.isLoading
              ? 'Loading run…'
              : run.isError
                ? 'Run could not be loaded'
                : 'Run not found'
          }
        />
        <div className="px-4 py-4 md:px-6">
          {run.isError ? (
            <ProjectListFailure
              error={run.error}
              what="this run"
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
                  Back to runs
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  const status = runStatus(r.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Pipelines', link: { to: '/pipelines' } },
          {
            label: 'Runs',
            link: {
              to: '/pipelines/$pipelineId/runs',
              params: { pipelineId },
            },
          },
          { label: r.id.slice(0, 8), mono: true },
        ]}
        title={`Run ${r.id.slice(0, 8)}${version ? ` · v${version.version}` : ''}`}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>{r.trigger_kind} trigger</span>
            <span>Started {r.started_at.slice(0, 16).replace('T', ' ')}</span>
            <span>Took {runDuration(r)}</span>
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
                      pipelineKey: `run ${r.id.slice(0, 8)}`,
                      version: currentPublished,
                      rerunOn: r,
                    })
                  }
                >
                  Retry on current version (v{currentPublished.version})
                </Button>
              ) : null}
              <Button
                size="sm"
                icon="play"
                disabled={!version || launcher.pending}
                onClick={() =>
                  version &&
                  launcher.launch({
                    pipelineKey: `run ${r.id.slice(0, 8)}`,
                    version,
                    retryOf: r,
                  })
                }
              >
                {canRerunOnCurrent
                  ? `Retry on v${version?.version ?? ''}`
                  : 'Retry this run'}
              </Button>
            </>
          ) : r.status === 'succeeded' ? (
            <AddRunToNotebook
              lines={runCitationLines(r, {
                pipelineKey: definition.data?.key ?? pipelineId.slice(0, 8),
                versionNumber: version?.version ?? null,
                outputs: outputs.data ?? [],
              })}
            />
          ) : r.status === 'running' ? (
            <ConfirmDialog>
              <ConfirmDialogTrigger>
                <Button size="sm" variant="quiet" disabled={cancel.isPending}>
                  Cancel run
                </Button>
              </ConfirmDialogTrigger>
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>Cancel this run?</ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    It stops at the next safe point; work already in flight
                    finishes. A cancelled run keeps what it already recorded and
                    cannot be resumed.
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel />
                  <ConfirmDialogAction
                    variant="danger-fill"
                    onClick={() => cancel.mutate()}
                  >
                    Cancel run
                  </ConfirmDialogAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </ConfirmDialog>
          ) : undefined
        }
      />

      {r.status === 'failed' ? (
        <Banner tone="bad" icon="warn" title={r.error_code ?? 'Run failed'}>
          {r.error_message ??
            'No error message was recorded for this run. The log below shows how far it got.'}{' '}
          <a href="#run-log" className="underline">
            See the log
          </a>
          . Retry runs it again on the same version with the same inputs
          {canRerunOnCurrent
            ? `; Retry on current version uses the same inputs on v${String(currentPublished.version)}`
            : ''}
          .
        </Banner>
      ) : null}

      {r.status === 'waiting' ? (
        <Banner tone="warn" icon="pause" title="This run is waiting for you.">
          {prompt && typeof prompt.form_schema.description === 'string'
            ? prompt.form_schema.description
            : 'It paused at its confirm step and will not change recorded data on its own.'}
        </Banner>
      ) : null}

      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto">
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
                    : 'Could not answer the run.'
                  : null
              }
            />
          ) : r.status === 'waiting' ? (
            // A waiting run always raises a prompt; if it is not here yet (or
            // not readable), say so rather than leave the banner's promise
            // without a control.
            <Notice tone="info">
              {prompts.isLoading
                ? 'Loading the decision prompt…'
                : 'This run is waiting for a decision, but no prompt could be read for it. Reload the page — if it stays empty, the run has no recorded prompt left to answer.'}
            </Notice>
          ) : null}

          {outputs.data?.length ? (
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                Outputs kept
              </h2>
              <TableBox>
                <RegistryGrid
                  label="Run outputs"
                  rows={outputs.data}
                  columns={outputColumns}
                  getRowId={(o) => o.id}
                  selectable={false}
                />
              </TableBox>
            </section>
          ) : (
            <Notice icon="info">
              This run kept no dataset snapshot; temporary tables were deleted
              when it ended.
            </Notice>
          )}

          <RunDeliveriesPanel
            deliveries={deliveries.data ?? []}
            runStatus={r.status}
            queuedCount={deliveryIds.length}
            isLoading={deliveries.isLoading && deliveryIds.length > 0}
          />

          <section id="run-log">
            <h2 className="mb-1.5 font-sans text-label font-semibold">Log</h2>
            {logs.data?.length ? (
              <ol className="m-0 flex list-none flex-col gap-1 rounded-md border border-border bg-surface p-3 font-mono text-caption">
                {logs.data.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="text-fg-muted">{l.at.slice(11, 19)}</span>
                    <span
                      className={
                        l.level === 'error'
                          ? 'text-danger-text'
                          : l.level === 'warning'
                            ? 'text-warning-text'
                            : undefined
                      }
                    >
                      {l.stage}
                    </span>
                    <span>{l.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Muted>No log lines recorded.</Muted>
            )}
          </section>
        </div>

        <Inspector aria-label="Run details" className="w-[320px]">
          {prompt ? (
            <InspectorSection title="Asked">
              {prompt.asked_user_ids.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                  {prompt.asked_user_ids.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ul>
              ) : (
                <Muted>No one was named.</Muted>
              )}
              <Muted className="mt-1.5">
                {prompt.answered_at
                  ? `Answered ${prompt.answered_at.slice(0, 16).replace('T', ' ')}`
                  : prompt.expires_at
                    ? `Expires ${prompt.expires_at.slice(0, 16).replace('T', ' ')}`
                    : 'No expiry set.'}
              </Muted>
            </InspectorSection>
          ) : null}
          <InspectorSection title="Inputs used">
            {Object.keys(r.input_versions).length ? (
              <DescriptionList
                labelWidth={90}
                items={Object.entries(r.input_versions).map(([k, v]) => [
                  k,
                  v.slice(0, 8),
                ])}
              />
            ) : (
              <Muted>No inputs pinned.</Muted>
            )}
          </InspectorSection>
          <InspectorSection title="Parameters">
            {Object.keys(r.parameters).length ? (
              <DescriptionList
                labelWidth={90}
                items={Object.entries(r.parameters).map(([k, v]) => [
                  k,
                  String(v),
                ])}
              />
            ) : (
              <Muted>No parameters.</Muted>
            )}
          </InspectorSection>
          <InspectorSection title="Traceability">
            <DescriptionList
              labelWidth={100}
              items={[
                ['Attempt', String(r.attempt)],
                ['Input digest', r.input_digest?.slice(0, 12) ?? '—'],
                [
                  'Retry of',
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
