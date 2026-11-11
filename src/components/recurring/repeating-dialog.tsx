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
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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

  const forName = (row: RepeatRow) =>
    names?.get(
      row.schedule.resourceId ?? row.schedule.notebookTemplateId ?? '',
    ) ?? null

  const columns: RegistryColumn<RepeatRow>[] = [
    {
      id: 'name',
      header: t('projects.recurring.dialog.columns.name'),
      accessorFn: (row) => row.schedule.title,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">
            {row.original.schedule.title}
          </span>
          {forName(row.original) ? (
            <span className="text-label text-fg-muted">
              {forName(row.original)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'repeats',
      header: t('projects.recurring.dialog.columns.repeats'),
      enableSorting: false,
      cell: ({ row }) => {
        const { schedule } = row.original

        const clock =
          schedule.startTime && schedule.endTime
            ? `${schedule.startTime}–${schedule.endTime}`
            : null

        return (
          <span className="flex flex-col">
            <span>{describeRepeat(schedule, formatDate)}</span>
            {clock ? (
              <span className="text-label text-fg-muted">{clock}</span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'made',
      header: t('projects.recurring.dialog.columns.made'),
      accessorFn: (row) => row.made,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>
            {t('projects.recurring.dialog.made', { count: row.original.made })}
          </span>
          {row.original.notMade.length > 0 ? (
            <span
              className="block max-w-72 truncate text-label text-warning-text"
              title={notMadeLine(row.original)}
            >
              {notMadeLine(row.original)}
            </span>
          ) : row.original.next && row.original.schedule.status !== 'ended' ? (
            <span className="text-label text-fg-muted">
              {t('projects.recurring.dialog.next', {
                date: formatDate(row.original.next),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('projects.recurring.dialog.columns.status'),
      accessorFn: (row) => row.schedule.status,
      cell: ({ row }) => (
        <Status tone={TONE[row.original.schedule.status]}>
          {t(
            `projects.recurring.dialog.status.${row.original.schedule.status}`,
          )}
        </Status>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions.more'),
      enableHiding: false,
      cell: ({ row }) => (
        <RepeatActions
          row={row.original}
          onPause={(paused) =>
            act(async () => {
              await setRepeatPaused(
                notebookDataClient,
                row.original.schedule.id,
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
                row.original.schedule.id,
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
      ),
    },
  ]

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
            <RegistryGrid
              label={t('projects.recurring.dialog.title', { kind: noun })}
              rows={rows.data ?? []}
              columns={columns}
              getRowId={(row) => row.schedule.id}
              selectable={false}
              rowHeight={48}
              isLoading={rows.isPending && open}
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
            />
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

/** The not-made line a repeat carries, in the one line the table has for it. */
function notMadeLine(row: RepeatRow): string {
  const hidden = row.notMade.length - SHOWN_NOT_MADE

  const shown = row.notMade
    .slice(0, SHOWN_NOT_MADE)
    .map((o) =>
      t('projects.recurring.dialog.notMadeOn', {
        date: formatDate(o.on, { year: false }),
        reason: describeNotMade(o.message),
      }),
    )
    .join('; ')

  return `${t('projects.recurring.dialog.notMade')}: ${shown}${
    hidden > 0
      ? `; ${t('projects.recurring.dialog.moreNotMade', { count: hidden })}`
      : ''
  }`
}

function RepeatActions({
  row,
  onPause,
  onStop,
}: {
  row: RepeatRow
  onPause: (paused: boolean) => void
  onStop: (cancelUpcoming: boolean) => void
}) {
  const { schedule } = row

  if (schedule.status === 'ended') return null

  return (
    <span className="flex justify-end">
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
    </span>
  )
}
