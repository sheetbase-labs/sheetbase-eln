import { useState, useSyncExternalStore } from 'react'
import type { ComponentProps } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { today } from '#/lib/absences'
import { Icon } from '#/components/icons'
import { ObjectLink } from '#/components/ui/object-link'
import { Tooltip } from '#/components/ui/tooltip'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import { toast } from '#/components/ui/sonner'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { recordSearch } from '#/components/record-picker/entity-options'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { experimentStatus } from '#/components/experiments/experiments-data'
import {
  addSeriesMember,
  memberProgress,
  moveSeriesMember,
  positionForMove,
  removeSeriesMember,
  seriesQueryKeys,
  setSeriesMemberDay,
  startSeries,
  useIsSeriesHead,
  useSeriesMembers,
  useSeriesRollup,
} from '#/lib/experiment-series'
import type { SeriesMember } from '#/lib/experiment-series'
import { formatSeriesDay } from '#/lib/series-dates'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { useExperimentRecord } from '../$expId'
import { t } from '#/copy'

const experimentSearch = recordSearch(['Experiment'])

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : t('projects.series.tab.failed')
}

/**
 * The Series tab of an experiment that heads a series: its experiments in
 * order with when each runs, who owns it and where it has got to, and what the
 * series adds up to. Each experiment keeps its own page, owner, review and
 * signature; this tab only groups them.
 */
const PHONE_QUERY = '(max-width: 767px)'

/** Whether the screen is phone-sized, so the table can drop its minor columns. */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE_QUERY)
      query.addEventListener('change', notify)

      return () => query.removeEventListener('change', notify)
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

export function ExperimentSeries({
  expId,
  canWrite,
}: {
  expId: string
  canWrite: boolean
}) {
  const record = useExperimentRecord(expId)
  const head = record.data
  const isHead = useIsSeriesHead(expId)
  const members = useSeriesMembers(expId)
  const rollup = useSeriesRollup(expId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [planning, setPlanning] = useState<SeriesMember | null>(null)
  const [removing, setRemoving] = useState<SeriesMember | null>(null)
  const rows = members.data ?? []

  const { userLabel } = useUserNames(
    rows.flatMap((row) =>
      [row.owner_user_id, row.reviewer_user_id].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  )

  // A series follows what is on its page: an approved or archived head is
  // read-only, as the database also enforces.
  const canEdit =
    canWrite && Boolean(head) && !head?.locked_at && !head?.archived_at

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: seriesQueryKeys.all })
  }

  const run = useMutation({
    mutationFn: (job: () => Promise<unknown>) => job(),
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(errorText(error)),
  })

  const move = (index: number, to: number) => {
    const positions = rows.map((row) => row.position)
    run.mutate(
      () =>
        // A move lands halfway between its new neighbours.
        moveSeriesMember(
          notebookDataClient,
          rows[index].member_record_id,
          positionForMove(positions, index, to),
        ),
      { onSuccess: () => toast(t('projects.series.tab.moved')) },
    )
  }

  const isPhone = useIsPhone()

  const allColumns: RegistryColumn<SeriesMember>[] = [
    {
      id: 'id',
      header: t('projects.series.tab.columns.id'),
      cell: ({ row }) => (
        <Link
          to="/experiments/$expId/notebook"
          params={{ expId: row.original.member_record_id }}
          className="mono text-link"
        >
          {row.original.identifier}
        </Link>
      ),
    },
    {
      id: 'experiment',
      header: t('projects.series.tab.columns.experiment'),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.member_number}. {row.original.title}
          {isPhone ? (
            <span className="block text-label font-normal text-fg-muted">
              <ObjectLink
                kind="experiment"
                id={row.original.member_record_id}
                identifier={row.original.identifier}
              />
              {' · '}
              {userLabel(row.original.owner_user_id)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'when',
      header: t('projects.series.tab.columns.when'),
      cell: ({ row }) => {
        const { planned_on, day_offset } = row.original

        if (!planned_on) {
          return (
            <span className="text-fg-muted">
              {t('projects.series.tab.noDate')}
            </span>
          )
        }

        return (
          <span>
            {t('projects.series.tab.day', { day: day_offset ?? 0 })}
            {' · '}
            <span className="text-fg-muted">{formatSeriesDay(planned_on)}</span>
          </span>
        )
      },
    },
    {
      id: 'owner',
      header: t('projects.series.tab.columns.owner'),
      cell: ({ row }) => userLabel(row.original.owner_user_id),
    },
    {
      id: 'status',
      header: t('projects.series.tab.columns.status'),
      cell: ({ row }) => {
        const member = row.original
        const progress = memberProgress(member, rows[member.member_number - 2])
        const status = experimentStatus(member.status)
        let tone: ComponentProps<typeof Status>['tone'] = status.tone
        let full: string = status.label
        let short: string = status.label
        let muted = false

        if (progress.kind === 'active') {
          tone = 'progress'
          short = t('projects.series.tab.short.inProgress')
          full =
            progress.step && progress.steps
              ? t('projects.series.tab.stepOf', {
                  step: progress.step,
                  steps: progress.steps,
                })
              : short
        } else if (progress.kind === 'review') {
          tone = 'review'
          short = t('projects.series.tab.short.inReview')
          full = member.reviewer_user_id
            ? t('projects.series.tab.inReviewBy', {
                name: userLabel(member.reviewer_user_id),
              })
            : short
        } else if (progress.kind === 'waiting' && progress.waitingFor) {
          tone = 'none'
          muted = true
          short = t('projects.series.tab.short.waiting')
          full = t('projects.series.tab.waitingFor', {
            title: progress.waitingTitle ?? progress.waitingFor,
          })
        }

        // On a phone the cell is a short word and the detail is in a tooltip.
        const text = isPhone ? short : full

        const detail =
          progress.kind === 'waiting' && progress.waitingFor
            ? t('projects.series.tab.waitingForTip', {
                identifier: progress.waitingFor,
                title: progress.waitingTitle ?? '',
              })
            : full

        const label = muted ? (
          <span className="text-fg-muted">{text}</span>
        ) : (
          text
        )

        return (
          <Tooltip content={detail}>
            <span className="inline-flex">
              <Status tone={tone}>{label}</Status>
            </span>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: () => (
        <span className="sr-only">
          {t('projects.series.tab.columns.actions')}
        </span>
      ),
      cell: ({ row }) => {
        const member = row.original
        const index = member.member_number - 1

        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label={t('projects.series.tab.menu.label', {
                    identifier: member.identifier,
                  })}
                />
              }
            >
              <Icon name="more" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuItem
                onClick={() =>
                  void navigate({
                    to: '/experiments/$expId/notebook',
                    params: { expId: member.member_record_id },
                  })
                }
              >
                {t('projects.series.tab.menu.open')}
              </DropdownMenuItem>
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    {t('projects.series.tab.menu.moveUp')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    {t('projects.series.tab.menu.moveDown')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPlanning(member)}>
                    {t('projects.series.tab.menu.plan')}
                  </DropdownMenuItem>
                  {member.planned_on ? (
                    <DropdownMenuItem
                      onClick={() =>
                        run.mutate(
                          () =>
                            setSeriesMemberDay(
                              notebookDataClient,
                              member.member_record_id,
                              null,
                            ),
                          {
                            onSuccess: () =>
                              toast(t('projects.series.tab.planned')),
                          },
                        )
                      }
                    >
                      {t('projects.series.tab.menu.clearDay')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onClick={() => setRemoving(member)}>
                    {t('projects.series.tab.menu.remove')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
      meta: rightAligned<SeriesMember>().meta,
    },
  ]

  // On a phone the ID and owner go under the title and the table is three
  // columns, so it fits the screen and needs no sideways scroll.
  const phoneWidths: Record<string, number> = {
    experiment: 120,
    status: 84,
    actions: 40,
  }

  const columns = isPhone
    ? allColumns
        .filter(
          (column) =>
            column.id !== 'id' && column.id !== 'when' && column.id !== 'owner',
        )
        .map((column) => {
          const width = phoneWidths[column.id ?? '']

          return width ? { ...column, size: width, minSize: width } : column
        })
    : allColumns

  const nextDue = rollup.data?.next

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      {members.isError ? (
        <Notice icon="warn" title={t('projects.series.tab.loadFailed')} />
      ) : null}
      <Section
        title={t('projects.series.tab.title')}
        count={rows.length > 0 ? rows.length : undefined}
        action={
          canEdit && head ? (
            <>
              <Button
                size="sm"
                icon="plus"
                onClick={() => setAdding(true)}
                data-testid="series-add-existing"
              >
                {t('projects.series.tab.addExisting')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/new"
                    search={{
                      series: head.id,
                      ...(head.project_id ? { project: head.project_id } : {}),
                      returnTo: `/experiments/${head.id}/series`,
                    }}
                  />
                }
              >
                {t('projects.series.tab.newMember')}
              </Button>
            </>
          ) : null
        }
      >
        <p className="m-0 text-body text-fg-muted">
          {t('projects.series.tab.description')}
        </p>
        {rows.length === 0 && !members.isLoading ? (
          <EmptyState
            icon="link"
            title={t('projects.series.tab.empty')}
            description={t('projects.series.tab.emptyHint')}
            action={
              canEdit && !isHead.data ? (
                <Button
                  size="sm"
                  onClick={() =>
                    run.mutate(() => startSeries(notebookDataClient, expId), {
                      onSuccess: () => toast(t('projects.series.start.done')),
                    })
                  }
                >
                  {t('projects.series.start.submit')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableBox>
            <RegistryGrid
              label={t('projects.series.tab.table')}
              rows={rows}
              columns={columns}
              getRowId={(row) => row.member_record_id}
              selectable={false}
              sortable={false}
              isLoading={members.isLoading}
            />
          </TableBox>
        )}
      </Section>

      {rollup.data && rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <RollupCard label={t('projects.series.tab.rollup.approved')}>
            {t('projects.series.tab.rollup.approvedValue', {
              approved: rollup.data.approved,
              total: rollup.data.total,
            })}
          </RollupCard>
          <RollupCard label={t('projects.series.tab.rollup.samples')}>
            {rollup.data.samples}
          </RollupCard>
          <RollupCard label={t('projects.series.tab.rollup.nextDue')}>
            {nextDue ? (
              nextDue.due_on ? (
                <span
                  className={
                    nextDue.due_on < today() ? 'text-danger-text' : undefined
                  }
                >
                  {t('projects.series.tab.rollup.nextDueValue', {
                    title: nextDue.title,
                    date: formatSeriesDay(nextDue.due_on),
                  })}
                  {nextDue.due_on < today()
                    ? ` · ${t('projects.series.tab.rollup.overdue')}`
                    : ''}
                </span>
              ) : (
                t('projects.series.tab.rollup.nextDueUndated', {
                  title: nextDue.title,
                })
              )
            ) : (
              t('projects.series.tab.rollup.allDone')
            )}
          </RollupCard>
        </div>
      ) : null}

      {adding && head ? (
        <AddMemberDialog
          seriesId={head.id}
          onClose={() => setAdding(false)}
          onDone={(identifier) => {
            setAdding(false)
            refresh()
            toast(t('projects.series.tab.added', { identifier }))
          }}
        />
      ) : null}
      {planning ? (
        <PlanDayDialog
          member={planning}
          onClose={() => setPlanning(null)}
          onDone={() => {
            setPlanning(null)
            refresh()
            toast(t('projects.series.tab.planned'))
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('projects.series.remove.title', {
                identifier: removing?.identifier ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('projects.series.remove.body')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => {
                if (!removing) return
                const gone = removing
                setRemoving(null)
                run.mutate(
                  () =>
                    removeSeriesMember(
                      notebookDataClient,
                      gone.member_record_id,
                    ),
                  {
                    onSuccess: () =>
                      toast(
                        t('projects.series.tab.removed', {
                          identifier: gone.identifier,
                        }),
                      ),
                  },
                )
              }}
            >
              {t('projects.series.remove.submit')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function RollupCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <div className="text-label text-fg-muted">{label}</div>
      <div className="num mt-0.5 text-section">{children}</div>
    </div>
  )
}

function AddMemberDialog({
  seriesId,
  onClose,
  onDone,
}: {
  seriesId: string
  onClose: () => void
  onDone: (identifier: string) => void
}) {
  const [memberId, setMemberId] = useState('')
  const [chosen, setChosen] = useState<PickerOption | null>(null)
  const [plannedOn, setPlannedOn] = useState('')

  const add = useMutation({
    mutationFn: () =>
      addSeriesMember(notebookDataClient, {
        seriesId,
        memberId,
        plannedOn: plannedOn || null,
      }),
    onSuccess: () => onDone(chosen?.identifier ?? ''),
    onError: (error: unknown) => toast.error(errorText(error)),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.series.add.title')}
          description={t('projects.series.add.description')}
        />
        <DialogBody>
          <Field label={t('projects.series.add.experiment')} required>
            <PickerSelect
              noun="experiment"
              value={memberId}
              selected={chosen}
              search={experimentSearch}
              onChange={(id, option) => {
                setMemberId(id)
                setChosen(option)
              }}
            />
          </Field>
          <Field
            label={t('projects.series.add.plannedOn')}
            hint={t('projects.series.add.plannedOnHint')}
          >
            <Input
              type="date"
              value={plannedOn}
              onChange={(event) => setPlannedOn(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!memberId || add.isPending}
            onClick={() => add.mutate()}
          >
            {t('projects.series.add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlanDayDialog({
  member,
  onClose,
  onDone,
}: {
  member: SeriesMember
  onClose: () => void
  onDone: () => void
}) {
  const [day, setDay] = useState(member.planned_on ?? '')

  const save = useMutation({
    mutationFn: () =>
      setSeriesMemberDay(
        notebookDataClient,
        member.member_record_id,
        day || null,
      ),
    onSuccess: onDone,
    onError: (error: unknown) => toast.error(errorText(error)),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader
          title={t('projects.series.plan.title', {
            identifier: member.identifier,
          })}
        />
        <DialogBody>
          <Field label={t('projects.series.plan.field')}>
            <Input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('projects.series.plan.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
