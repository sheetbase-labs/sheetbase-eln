import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Notice } from '#/components/v3/ui/alert'
import { Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Button } from '#/components/v3/ui/button'
import {
  runDuration,
  runStatus,
  useScheduleActivity,
  useScheduleRuns,
} from '#/components/v3/pipelines/pipelines-data'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type {
  PipelineScheduleActivityKind,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'

/** Each way a trigger can decline to run, in words, and how serious it is. */
export const ACTIVITY_LABELS: Record<
  PipelineScheduleActivityKind,
  { label: string; tone: 'stored' | 'warn' | 'bad' }
> = {
  skipped_missed: {
    label: t('data.scheduleHistory.missedSkipped'),
    tone: 'warn',
  },
  skipped_unchanged: {
    label: t('data.scheduleHistory.nothingNew'),
    tone: 'stored',
  },
  skipped_overlap: {
    label: t('data.scheduleHistory.stillRunning'),
    tone: 'warn',
  },
  skipped_no_version: {
    label: t('data.scheduleHistory.publishedVersion'),
    tone: 'warn',
  },
  input_unresolved: {
    label: t('data.scheduleHistory.inputReady'),
    tone: 'warn',
  },
  start_failed: { label: t('data.scheduleHistory.couldStart'), tone: 'bad' },
}

/**
 * One trigger's history: the runs it started and, beside them, the times it
 * chose not to run and why — so "nothing happened at 09:00" has an answer on
 * the page rather than in a log.
 */
export function ScheduleHistoryDialog({
  open,
  onOpenChange,
  schedule,
  title,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: PipelineScheduleWire
  /** The trigger in words, for the heading. */
  title: string
}) {
  const runs = useScheduleRuns(schedule.id, open)
  const activity = useScheduleActivity(schedule.id, open)
  const runRows = runs.data ?? []
  const activityRows = activity.data ?? []
  const watermarks = Object.entries(schedule.input_watermarks)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader
          title={t('data.scheduleHistory.triggerHistory')}
          description={title}
        />
        <DialogBody>
          <section
            aria-label={t('data.scheduleHistory.ariaRunsTriggerStarted')}
          >
            <h3 className="m-0 mb-2 text-label font-medium text-fg">
              {t('data.scheduleHistory.runsStarted')}
            </h3>
            {runs.isLoading ? (
              <Muted>{t('data.scheduleHistory.loadingRuns')}</Muted>
            ) : runRows.length === 0 ? (
              <Muted>{t('data.scheduleHistory.triggerHasStartedRun')}</Muted>
            ) : (
              <TableBox>
                <Table
                  caption={t('data.scheduleHistory.ariaRunsTriggerStarted')}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('data.scheduleHistory.started')}</TableHead>
                      <TableHead>{t('data.scheduleHistory.outcome')}</TableHead>
                      <TableHead>{t('data.scheduleHistory.took')}</TableHead>
                      <TableHead>{t('data.scheduleHistory.attempt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runRows.map((run) => {
                      const status = runStatus(run.status)
                      return (
                        <TableRow key={run.id}>
                          <TableCell>
                            <Link
                              to="/pipelines/runs/$runId"
                              params={{ runId: run.id }}
                              className="text-accent hover:underline"
                            >
                              {formatNotebookDateTime(run.started_at, {
                                zone: true,
                              })}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Status tone={status.tone}>{status.label}</Status>
                          </TableCell>
                          <TableCell>{runDuration(run)}</TableCell>
                          <TableCell>
                            {run.attempt > 1
                              ? t('data.scheduleHistory.retry', {
                                  attempt: run.attempt,
                                })
                              : t('data.scheduleHistory.first')}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableBox>
            )}
          </section>

          <section
            aria-label={t('data.scheduleHistory.ariaTimesTriggerDidRun')}
          >
            <h3 className="m-0 mb-2 text-label font-medium text-fg">
              {t('data.scheduleHistory.timesDidRun')}
            </h3>
            {activity.isLoading ? (
              <Muted>{t('common.states.loading')}</Muted>
            ) : activityRows.length === 0 ? (
              <Muted>{t('data.scheduleHistory.nothingHasBeenSkipped')}</Muted>
            ) : (
              <div className="flex flex-col gap-2">
                {activityRows.map((row) => {
                  const kind = ACTIVITY_LABELS[row.kind]
                  const count = Number(row.detail.count ?? 1)
                  return (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body"
                    >
                      <Status tone={kind.tone}>{kind.label}</Status>
                      <span className="text-fg-muted">
                        {formatNotebookDateTime(row.occurred_at, {
                          zone: true,
                        })}
                        {count > 1
                          ? t('data.scheduleHistory.times', { count })
                          : ''}
                      </span>
                      <span>{row.message}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {watermarks.length > 0 ? (
            <Notice tone="info">
              {t('data.scheduleHistory.incrementalInputsResumeAfter')}
            </Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
