import { Link } from '@tanstack/react-router'

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
  skipped_missed: { label: 'Missed and skipped', tone: 'warn' },
  skipped_unchanged: { label: 'Nothing new', tone: 'stored' },
  skipped_overlap: { label: 'Still running', tone: 'warn' },
  skipped_no_version: { label: 'No published version', tone: 'warn' },
  input_unresolved: { label: 'Input not ready', tone: 'warn' },
  start_failed: { label: 'Could not start', tone: 'bad' },
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
        <DialogHeader title="Trigger history" description={title} />
        <DialogBody>
          <section aria-label="Runs this trigger started">
            <h3 className="m-0 mb-2 text-label font-medium text-fg">
              Runs started
            </h3>
            {runs.isLoading ? (
              <Muted>Loading runs…</Muted>
            ) : runRows.length === 0 ? (
              <Muted>This trigger has not started a run yet.</Muted>
            ) : (
              <TableBox>
                <Table caption="Runs this trigger started">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Took</TableHead>
                      <TableHead>Attempt</TableHead>
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
                            {run.attempt > 1 ? `Retry ${run.attempt}` : 'First'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableBox>
            )}
          </section>

          <section aria-label="Times this trigger did not run">
            <h3 className="m-0 mb-2 text-label font-medium text-fg">
              Times it did not run
            </h3>
            {activity.isLoading ? (
              <Muted>Loading…</Muted>
            ) : activityRows.length === 0 ? (
              <Muted>Nothing has been skipped.</Muted>
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
                        {count > 1 ? ` · ${count} times` : ''}
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
              Incremental inputs resume after the last Dataset Version this
              trigger ran on, so a run only happens when there is a newer one.
            </Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
