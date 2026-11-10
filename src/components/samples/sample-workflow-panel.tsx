import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { DataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import { sampleQueryKeys } from '#/lib/samples'
import {
  advanceRun,
  enrolSample,
  fetchSampleRuns,
  fetchSampleWorkflowEvents,
  fetchStartableWorkflows,
  leaveRun,
} from '#/lib/sample-workflows'
import type { WorkflowEvent, WorkflowRun } from '#/lib/sample-workflows'
import { useState } from 'react'
import { t } from '#/copy'
import { dueSummary } from './sample-workflow-due'

function errorMessage(error: Error): string {
  return error instanceof Error
    ? error.message
    : t('settings.sampleWorkflows.databaseRefused')
}

/**
 * Where a sample is in the workflows the lab has set up for it: the step it is
 * at, when it is due, the steps it can move to, and what happened on the way.
 * With no workflow yet it offers the ones that fit the sample's type.
 */
export function SampleWorkflowPanel({
  sampleId,
  sampleType,
  canMove,
  client = notebookDataClient,
}: {
  sampleId: string
  sampleType: string | null
  /** Whether this person may move samples (the same right as other sample work). */
  canMove: boolean
  client?: DataClient
}) {
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState('')

  const runs = useQuery({
    queryKey: ['sample-workflow-runs', sampleId],
    queryFn: () => fetchSampleRuns(client, sampleId),
  })

  const events = useQuery({
    queryKey: ['sample-workflow-events', sampleId],
    queryFn: () => fetchSampleWorkflowEvents(client, sampleId),
  })

  const open = (runs.data ?? []).filter((run) => !run.completedAt)
  const done = (runs.data ?? []).filter((run) => run.completedAt)

  const startable = useQuery({
    queryKey: ['sample-workflows-startable', sampleType],
    queryFn: () => fetchStartableWorkflows(client, sampleType),
    enabled: canMove,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['sample-workflow-runs', sampleId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['sample-workflow-events', sampleId],
      }),
      // Automations can change the sample itself.
      queryClient.invalidateQueries({
        queryKey: sampleQueryKeys.detail(sampleId),
      }),
    ])
  }

  const move = useMutation({
    mutationFn: (args: { run: WorkflowRun; to: string; name: string }) =>
      advanceRun(client, args.run.id, args.to),
    onSuccess: async (result, args) => {
      const failed = result.automation.filter((a) => a.outcome === 'failed')

      if (failed.length)
        toast.error(
          t('settings.sampleWorkflows.onSample.automationFailed', {
            step: args.name,
            reason: failed[0].message,
          }),
        )
      else
        toast(t('settings.sampleWorkflows.onSample.moved', { step: args.name }))
      await refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const leave = useMutation({
    mutationFn: (run: WorkflowRun) => leaveRun(client, run.id),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  })

  const start = useMutation({
    mutationFn: (workflowId: string) =>
      enrolSample(client, sampleId, workflowId),
    onSuccess: async () => {
      setChoice('')
      await refresh()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (runs.isLoading)
    return <Muted>{t('settings.sampleWorkflows.loading')}</Muted>

  const options = (startable.data ?? []).filter(
    (w) => !open.some((run) => run.workflowId === w.id),
  )

  if (
    open.length === 0 &&
    done.length === 0 &&
    options.length === 0 &&
    !events.data?.length
  )
    return <Muted>{t('settings.sampleWorkflows.onSample.none')}</Muted>

  return (
    <div className="flex flex-col gap-3">
      {open.map((run) => {
        const due = dueSummary(run.dueAt)

        return (
          <div key={run.id} className="flex flex-col gap-1.5">
            <span className="text-label text-fg-muted">{run.workflowName}</span>
            <span className="text-body font-medium text-fg">
              {run.stageName}
            </span>
            <Status tone={due.tone}>{due.text}</Status>
            {canMove && run.moves.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {run.moves.map((next) => (
                  <Button
                    key={next.id}
                    size="sm"
                    disabled={move.isPending}
                    onClick={() =>
                      move.mutate({ run, to: next.id, name: next.name })
                    }
                  >
                    {t('settings.sampleWorkflows.onSample.moveTo', {
                      step: next.name,
                    })}
                  </Button>
                ))}
              </div>
            ) : null}
            {canMove ? (
              <div>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={leave.isPending}
                  onClick={() => leave.mutate(run)}
                >
                  {t('settings.sampleWorkflows.onSample.takeOut')}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      {done.map((run) => (
        <Status key={run.id} tone="ok">
          {t('settings.sampleWorkflows.onSample.finished', {
            workflow: run.workflowName,
            date: formatDate(run.completedAt),
          })}
        </Status>
      ))}
      {canMove && options.length > 0 ? (
        <div className="flex gap-2">
          <Select
            aria-label={t('settings.sampleWorkflows.onSample.chooseWorkflow')}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">
              {t('settings.sampleWorkflows.onSample.chooseWorkflow')}
            </option>
            {options.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button
            disabled={!choice || start.isPending}
            onClick={() => start.mutate(choice)}
          >
            {t('settings.sampleWorkflows.onSample.start')}
          </Button>
        </div>
      ) : null}
      {events.data && events.data.length > 0 ? (
        <WorkflowHistory events={events.data} />
      ) : null}
    </div>
  )
}

function WorkflowHistory({ events }: { events: WorkflowEvent[] }) {
  return (
    <TableBox>
      <Table caption={t('settings.sampleWorkflows.onSample.history')}>
        <TableHeader>
          <tr>
            <TableHead>
              {t('settings.sampleWorkflows.onSample.stepCol')}
            </TableHead>
            <TableHead>
              {t('settings.sampleWorkflows.onSample.whenCol')}
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const failed = event.automation.filter(
              (a) => a.outcome === 'failed',
            )

            return (
              <TableRow key={event.id}>
                <TableCell>
                  <span className="block" title={event.notes ?? undefined}>
                    {event.to ??
                      t('settings.sampleWorkflows.onSample.leftWorkflow')}
                  </span>
                  {failed.map((a, i) => (
                    <span key={i} className="block text-label text-danger-text">
                      {a.message}
                    </span>
                  ))}
                </TableCell>
                <TableCell className="num whitespace-nowrap text-fg-muted">
                  {formatDate(event.at)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableBox>
  )
}
