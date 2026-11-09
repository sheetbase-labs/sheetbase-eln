import { useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { toast } from '#/components/ui/sonner'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  describeNotMade,
  describeRepeat,
  endRepeat,
  setRepeatPaused,
} from '#/lib/recurring'
import type { RepeatKind } from '#/lib/recurring'
import { describeCalendarError } from '#/lib/calendar'
import { t } from '#/copy'
import { recurringQueryKeys, useRepeatRows } from './recurring-data'
import type { RepeatRow } from './recurring-data'

const TONE: Record<RepeatRow['schedule']['status'], Tone> = {
  active: 'ok',
  paused: 'warn',
  ended: 'draft',
}

/** Only the first few refusals are listed under a repeat; the rest are counted. */
const SHOWN_NOT_MADE = 3

/**
 * The repeats of one kind: what each repeats, how many it has made, what it
 * could not make and why, with pause, resume and stop. Opens from the Schedule
 * (bookings) and the experiments list (experiments).
 */
export function RepeatingDialog({
  kind,
  workspaceId,
  names,
  actions,
}: {
  kind: RepeatKind
  workspaceId: string | undefined
  /** What each repeat is for: an instrument's or a template's name, by id. */
  names?: ReadonlyMap<string, string>
  /** Extra buttons in the footer, e.g. "Start on a schedule". */
  actions?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rows = useRepeatRows(workspaceId, kind, open)
  const queryClient = useQueryClient()

  const noun = t(
    kind === 'booking'
      ? 'projects.recurring.dialog.bookings'
      : 'projects.recurring.dialog.experiments',
  )

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: recurringQueryKeys.list(workspaceId ?? 'none', kind),
      }),
      queryClient.invalidateQueries({ queryKey: ['schedule'] }),
    ])

  const act = async (work: () => Promise<string>) => {
    try {
      toast(await work())
      await refresh()
    } catch (error) {
      toast(describeCalendarError(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Icon name="repeat" size={12} />
        {t('projects.recurring.dialog.open')}
      </Button>
      <DialogContent className="w-[min(860px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.recurring.dialog.title', { kind: noun })}
        />
        <DialogBody className="gap-3">
          {rows.isError ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {t('projects.recurring.dialog.loadError', { kind: noun })}
            </p>
          ) : null}
          <TableBox>
            <Table
              caption={t('projects.recurring.dialog.title', { kind: noun })}
            >
              <TableHeader>
                <tr>
                  <TableHead>
                    {t('projects.recurring.dialog.columns.name')}
                  </TableHead>
                  <TableHead>
                    {t('projects.recurring.dialog.columns.repeats')}
                  </TableHead>
                  <TableHead>
                    {t('projects.recurring.dialog.columns.made')}
                  </TableHead>
                  <TableHead>
                    {t('projects.recurring.dialog.columns.status')}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common.actions.more')}</span>
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody
                colSpan={5}
                loading={rows.isPending && open}
                empty={
                  <span>
                    {t('projects.recurring.dialog.empty')}.{' '}
                    {t(
                      kind === 'booking'
                        ? 'projects.recurring.dialog.emptyBookings'
                        : 'projects.recurring.dialog.emptyExperiments',
                    )}
                  </span>
                }
              >
                {(rows.data ?? []).map((row) => (
                  <RepeatTableRow
                    key={row.schedule.id}
                    row={row}
                    forName={
                      names?.get(
                        row.schedule.resourceId ??
                          row.schedule.notebookTemplateId ??
                          '',
                      ) ?? null
                    }
                    onPause={(paused) =>
                      act(async () => {
                        await setRepeatPaused(
                          notebookDataClient,
                          row.schedule.id,
                          paused,
                        )

                        return t(
                          paused
                            ? 'projects.recurring.dialog.paused'
                            : 'projects.recurring.dialog.resumed',
                        )
                      })
                    }
                    onStop={(cancelUpcoming) =>
                      act(async () => {
                        const { cancelled } = await endRepeat(
                          notebookDataClient,
                          row.schedule.id,
                          cancelUpcoming,
                        )

                        return cancelUpcoming
                          ? t('projects.recurring.dialog.stoppedCancelled', {
                              count: cancelled,
                            })
                          : t('projects.recurring.dialog.stopped')
                      })
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </TableBox>
        </DialogBody>
        <DialogFooter>
          {actions}
          <DialogClose render={<Button />}>
            {t('common.actions.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RepeatTableRow({
  row,
  forName,
  onPause,
  onStop,
}: {
  row: RepeatRow
  forName: string | null
  onPause: (paused: boolean) => void
  onStop: (cancelUpcoming: boolean) => void
}) {
  const { schedule } = row
  const live = schedule.status !== 'ended'

  const clock =
    schedule.startTime && schedule.endTime
      ? `${schedule.startTime}–${schedule.endTime}`
      : null

  const hidden = row.notMade.length - SHOWN_NOT_MADE

  return (
    <>
      <TableRow>
        <TableCell className="whitespace-normal">
          <div className="font-medium text-fg">{schedule.title}</div>
          {forName ? (
            <div className="text-label text-fg-muted">{forName}</div>
          ) : null}
        </TableCell>
        <TableCell className="whitespace-normal">
          <div>{describeRepeat(schedule, formatDate)}</div>
          {clock ? (
            <div className="text-label text-fg-muted">{clock}</div>
          ) : null}
        </TableCell>
        <TableCell>
          <div>{t('projects.recurring.dialog.made', { count: row.made })}</div>
          {row.next && live ? (
            <div className="text-label text-fg-muted">
              {t('projects.recurring.dialog.next', {
                date: formatDate(row.next),
              })}
            </div>
          ) : null}
        </TableCell>
        <TableCell>
          <Status tone={TONE[schedule.status]}>
            {t(`projects.recurring.dialog.status.${schedule.status}`)}
          </Status>
        </TableCell>
        <TableCell align="right">
          {live ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={t('projects.recurring.dialog.actionsFor', {
                      name: schedule.title,
                    })}
                  />
                }
              >
                <Icon name="more" size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => onPause(schedule.status === 'active')}
                >
                  {schedule.status === 'active'
                    ? t('projects.recurring.dialog.pause')
                    : t('projects.recurring.dialog.resume')}
                </DropdownMenuItem>
                <DropdownMenuItem danger onClick={() => onStop(false)}>
                  {t('projects.recurring.dialog.stop')}
                </DropdownMenuItem>
                {schedule.kind === 'booking' ? (
                  <DropdownMenuItem danger onClick={() => onStop(true)}>
                    {t('projects.recurring.dialog.stopAndCancel')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </TableCell>
      </TableRow>
      {row.notMade.length > 0 ? (
        <tr>
          <td
            colSpan={5}
            className="border-b border-border-subtle bg-warning-wash px-2.5 py-1.5 text-label text-fg first:pl-6 max-md:first:pl-3"
          >
            <span className="font-medium">
              {t('projects.recurring.dialog.notMade')}
            </span>
            {': '}
            {row.notMade.slice(0, SHOWN_NOT_MADE).map((o, i) => (
              <span key={o.on}>
                {i > 0 ? '; ' : ''}
                {t('projects.recurring.dialog.notMadeOn', {
                  date: formatDate(o.on, { year: false }),
                  reason: describeNotMade(o.message),
                })}
              </span>
            ))}
            {hidden > 0 ? (
              <>
                {'; '}
                {t('projects.recurring.dialog.moreNotMade', { count: hidden })}
              </>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}
