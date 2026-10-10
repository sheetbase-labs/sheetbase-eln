import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Banner, Notice } from '#/components/v3/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  PageHeader,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import { RunPromptPanel } from '#/components/v3/pipelines/run-prompt'
import { answerPipelineRunPrompt } from '#/lib/pipelines/data'
import type { PipelineRunPromptAnswer } from '#/lib/pipelines/data'
import {
  pipelineDataQueryKeys,
  runDuration,
  runStatus,
  usePipelineVersions,
  usePipelineRun,
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
  const run = usePipelineRun(runId)
  const logs = useRunLogs(runId)
  const outputs = useRunOutputs(runId)
  const prompts = useRunPrompts(runId)
  const members = useWorkspaceMemberNames()
  const versions = usePipelineVersions(pipelineId)
  const queryClient = useQueryClient()
  const answer = useMutation({
    mutationFn: (value: PipelineRunPromptAnswer) =>
      answerPipelineRunPrompt(runId, value),
    onSuccess: () => {
      toast('Answer recorded — the run is resuming.')
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
  // The newest prompt is the one a waiting run is paused on.
  const promptList = prompts.data ?? []
  const prompt = promptList.length
    ? promptList[promptList.length - 1]
    : undefined
  const nameOf = (userId: string) => members.data?.[userId] ?? userId

  if (!r) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/pipelines" className="text-link">
              Pipelines
            </Link>
          }
          title={run.isLoading ? 'Loading run…' : 'Run not found'}
        />
      </div>
    )
  }

  const status = runStatus(r.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/pipelines" className="text-link">
              Pipelines
            </Link>{' '}
            /{' '}
            <Link
              to="/pipelines/$pipelineId/runs"
              params={{ pipelineId }}
              className="text-link"
            >
              Runs
            </Link>{' '}
            / <span className="mono">{r.id.slice(0, 8)}</span>
          </>
        }
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
      />

      {r.status === 'failed' && r.error_message ? (
        <Banner tone="bad" icon="warn" title={r.error_code ?? 'Run failed'}>
          {r.error_message}
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
          ) : null}

          {outputs.data?.length ? (
            <section>
              <h2 className="mb-1.5 font-sans text-label font-semibold">
                Outputs kept
              </h2>
              <TableBox>
                <Table aria-label="Run outputs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Dataset</TableHead>
                      <TableHead>Snapshot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outputs.data.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>{o.label}</TableCell>
                        <TableCell className="mono">
                          <Link
                            to="/datasets/$datasetId/snapshots"
                            params={{ datasetId: o.dataset_id }}
                          >
                            {o.dataset_id.slice(0, 8)}
                          </Link>
                        </TableCell>
                        <TableCell className="mono">
                          {o.dataset_version_id.slice(0, 8)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableBox>
            </section>
          ) : (
            <Notice icon="info">
              This run kept no dataset snapshot; temporary tables were deleted
              when it ended.
            </Notice>
          )}

          <section>
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
    </div>
  )
}
