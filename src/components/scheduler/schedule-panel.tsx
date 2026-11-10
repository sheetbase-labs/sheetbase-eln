/**
 * The schedule of an experiment that runs in parts: what each part needs, a
 * proposed plan the server works out, and accepting it to book the instruments.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import { formatDate, formatTime } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import type { PartSummary } from '#/lib/experiment-parts'
import {
  acceptProposal,
  dismissProposal,
  fetchPartPlans,
  fetchProposals,
  isWaiting,
  proposalReference,
  requestProposal,
  savePartPlan,
  scheduleQueryKeys,
  slipPart,
} from '#/lib/scheduler'
import type {
  PartNeedWire,
  PartPlanWire,
  ScheduleProposalWire,
} from '#/lib/scheduler'
import type { Conflict, PlanItem } from '#/lib/scheduler/plan'
import { useUserNames } from '#/lib/user-names'

const client = notebookDataClient

interface InstrumentOption {
  id: string
  name: string
}

function useInstrumentOptions() {
  return useQuery({
    queryKey: ['scheduler', 'instrument-options'],
    queryFn: () =>
      client.list<InstrumentOption>(
        'instruments',
        '?select=id,name&retired_at=is.null&order=name.asc&limit=500',
      ),
    staleTime: 60_000,
  })
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A mutation failure is a caught throw, untyped by definition; Error supplies its message and anything else falls back.
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function SchedulePanel({
  recordId,
  parts,
  canWrite,
}: {
  recordId: string
  parts: readonly PartSummary[]
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const instruments = useInstrumentOptions()
  const [editing, setEditing] = useState<PartSummary | null>(null)
  const [slipping, setSlipping] = useState<PartSummary | null>(null)
  const partIds = useMemo(() => parts.map((p) => p.partId), [parts])

  const plans = useQuery({
    queryKey: [...scheduleQueryKeys.plans(recordId), partIds],
    queryFn: () => fetchPartPlans(client, partIds),
    staleTime: 10_000,
  })

  const proposals = useQuery({
    queryKey: scheduleQueryKeys.proposals(recordId),
    queryFn: () => fetchProposals(client, recordId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((p) => isWaiting(p.status)) ? 2_000 : false,
    staleTime: 2_000,
  })

  const latest = proposals.data?.at(0) ?? null
  const planned = (plans.data?.needs.length ?? 0) > 0

  const plan = useMutation({
    mutationFn: () => requestProposal(client, recordId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.all }),
    onError: (e) =>
      toast.error(messageOf(e, t('automation.schedule.couldNotPlan'))),
  })

  const names = instruments.data ?? []

  const nameOf = useCallback(
    (id: string) => instruments.data?.find((n) => n.id === id)?.name ?? '—',
    [instruments.data],
  )

  const planOf = useCallback(
    (partId: string) => plans.data?.plans.find((p) => p.part_id === partId),
    [plans.data],
  )

  const needsOf = useCallback(
    (partId: string) =>
      (plans.data?.needs ?? []).filter((n) => n.part_id === partId),
    [plans.data],
  )

  const columns = useMemo<RegistryColumn<PartSummary>[]>(
    () => [
      {
        id: 'part',
        header: t('automation.schedule.plans.part'),
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.number}. {row.original.title}
          </span>
        ),
      },
      {
        id: 'handsOn',
        header: t('automation.schedule.plans.handsOn'),
        size: 110,
        cell: ({ row }) => (
          <span className="num">
            {t('automation.schedule.plans.minutes', {
              count: planOf(row.original.partId)?.hands_on_minutes ?? 60,
            })}
          </span>
        ),
      },
      {
        id: 'wait',
        header: t('automation.schedule.plans.wait'),
        size: 110,
        cell: ({ row }) => {
          const wait = planOf(row.original.partId)?.wait_after_minutes ?? 0

          return (
            <span className="num text-fg-muted">
              {wait > 0
                ? t('automation.schedule.plans.minutes', { count: wait })
                : t('automation.schedule.plans.none')}
            </span>
          )
        },
      },
      {
        id: 'instruments',
        header: t('automation.schedule.plans.instruments'),
        cell: ({ row }) => {
          const list = needsOf(row.original.partId)

          return (
            <span className="truncate text-fg-muted">
              {list.length === 0
                ? t('automation.schedule.plans.none')
                : list
                    .map((n) =>
                      t('automation.schedule.plans.instrumentMinutes', {
                        name: nameOf(n.resource_id),
                        minutes: n.minutes,
                      }),
                    )
                    .join(', ')}
            </span>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        size: 170,
        cell: ({ row }) =>
          canWrite ? (
            <span className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="quiet"
                onClick={(event) => {
                  event.stopPropagation()
                  setEditing(row.original)
                }}
              >
                {t('automation.schedule.plans.edit')}
              </Button>
              {row.original.status !== 'done' ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSlipping(row.original)
                  }}
                >
                  {t('automation.schedule.plans.late')}
                </Button>
              ) : null}
            </span>
          ) : null,
      },
    ],
    [canWrite, plans.data, instruments.data, nameOf, needsOf, planOf],
  )

  return (
    <Section
      title={t('automation.schedule.title')}
      action={
        canWrite ? (
          <Tooltip
            content={planned ? undefined : t('automation.schedule.needsPlans')}
          >
            <span>
              <Button
                size="sm"
                variant="primary"
                disabled={
                  !planned ||
                  plan.isPending ||
                  (latest !== null && isWaiting(latest.status))
                }
                onClick={() => plan.mutate()}
              >
                {plan.isPending || (latest && isWaiting(latest.status))
                  ? t('automation.schedule.planning')
                  : t('automation.schedule.plan')}
              </Button>
            </span>
          </Tooltip>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-body text-fg-muted">
          {t('automation.schedule.explain')}
        </p>
        <TableBox>
          <RegistryGrid
            label={t('automation.schedule.plans.tableLabel')}
            rows={[...parts]}
            columns={columns}
            getRowId={(r) => r.partId}
            isLoading={plans.isPending}
          />
        </TableBox>
        {latest ? (
          <ProposalView
            proposal={latest}
            canWrite={canWrite}
            onChanged={() =>
              void queryClient.invalidateQueries({
                queryKey: scheduleQueryKeys.all,
              })
            }
          />
        ) : null}
      </div>
      {editing ? (
        <PartPlanDialog
          part={editing}
          plan={planOf(editing.partId)}
          needs={needsOf(editing.partId)}
          instruments={names}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {slipping ? (
        <SlipDialog
          key={slipping.partId}
          part={slipping}
          onClose={() => setSlipping(null)}
        />
      ) : null}
    </Section>
  )
}

const DECIDED_STATUSES = ['accepted', 'dismissed', 'superseded'] as const

type DecidedStatus = (typeof DECIDED_STATUSES)[number]

/** The outcome a decided proposal states; nothing until it is decided. */
function decidedStatus(
  status: ScheduleProposalWire['status'],
): DecidedStatus | null {
  return DECIDED_STATUSES.find((candidate) => candidate === status) ?? null
}

function conflictText(conflict: Conflict): string {
  const key = `automation.schedule.conflicts.${conflict.code}` as const

  return t(key)
}

function ProposalView({
  proposal,
  canWrite,
  onChanged,
}: {
  proposal: ScheduleProposalWire
  canWrite: boolean
  onChanged: () => void
}) {
  const reference = proposalReference(proposal.number)

  const { userLabel } = useUserNames(
    proposal.items.map((item) => item.assigneeUserId ?? ''),
  )

  const queryClient = useQueryClient()

  const accept = useMutation({
    mutationFn: () => acceptProposal(client, proposal.id),
    onSuccess: (result) => {
      onChanged()
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(
        t('automation.schedule.proposal.accepted', {
          booked: result.booked.length,
          reference,
        }),
      )

      if (result.skipped.length > 0) {
        toast.warning(
          t('automation.schedule.proposal.acceptedSkipped', {
            skipped: result.skipped.length,
            reasons: result.skipped
              .map((s) => `${s.resourceName ?? ''} ${s.reason ?? ''}`.trim())
              .join('; '),
          }),
        )
      }
    },
    onError: (e) =>
      toast.error(
        messageOf(e, t('automation.schedule.proposal.couldNotAccept')),
      ),
  })

  const dismiss = useMutation({
    mutationFn: () => dismissProposal(client, proposal.id),
    onSuccess: () => {
      onChanged()
      toast.success(t('automation.schedule.proposal.dismissed', { reference }))
    },
    onError: (e) =>
      toast.error(
        messageOf(e, t('automation.schedule.proposal.couldNotDismiss')),
      ),
  })

  const columns = useMemo<RegistryColumn<PlanItem>[]>(
    () => [
      {
        id: 'part',
        header: t('automation.schedule.proposal.part'),
        size: 200,
        cell: ({ row }) => (
          <span className="truncate font-medium text-fg">
            {row.original.partNumber}. {row.original.partTitle}
          </span>
        ),
      },
      {
        id: 'what',
        header: t('automation.schedule.proposal.what'),
        size: 180,
        cell: ({ row }) => (
          <span className="truncate text-fg">
            {row.original.kind === 'instrument'
              ? (row.original.resourceName ?? '')
              : t('automation.schedule.proposal.handsOn')}
          </span>
        ),
      },
      {
        id: 'who',
        header: t('automation.schedule.proposal.who'),
        size: 140,
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {row.original.assigneeUserId
              ? userLabel(row.original.assigneeUserId)
              : '—'}
          </span>
        ),
      },
      {
        id: 'when',
        header: t('automation.schedule.proposal.when'),
        size: 230,
        cell: ({ row }) =>
          row.original.startsAt && row.original.endsAt ? (
            <span className="num">
              {formatDate(row.original.startsAt)}{' '}
              {formatTime(row.original.startsAt)}–
              {formatTime(row.original.endsAt)}
            </span>
          ) : (
            <span className="text-danger-text">
              {t('automation.schedule.proposal.noSlot')}
            </span>
          ),
      },
      {
        id: 'notes',
        header: t('automation.schedule.proposal.notes'),
        cell: ({ row }) =>
          row.original.conflicts.length === 0 ? (
            <span className="text-fg-muted">—</span>
          ) : (
            <Tooltip
              content={row.original.conflicts.map(conflictText).join(' ')}
            >
              <span className="truncate text-warning-text">
                {row.original.conflicts.map(conflictText).join(' ')}
              </span>
            </Tooltip>
          ),
      },
    ],
    [userLabel],
  )

  if (isWaiting(proposal.status)) {
    return (
      <Notice tone="info">
        {t('automation.schedule.proposal.waiting', { reference })}
      </Notice>
    )
  }

  if (proposal.status === 'failed') {
    return (
      <Notice tone="bad">
        {t('automation.schedule.proposal.failed', {
          reference,
          message: proposal.error_message ?? '',
        })}
      </Notice>
    )
  }

  const open = proposal.status === 'proposed'
  const decided = decidedStatus(proposal.status)

  const summary =
    proposal.conflict_count > 0
      ? t('automation.schedule.proposal.summaryConflicts', {
          reference,
          count: proposal.items.length,
          conflicts: proposal.conflict_count,
        })
      : t('automation.schedule.proposal.summary', {
          reference,
          count: proposal.items.length,
        })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-label font-medium text-fg">
          {t('automation.schedule.proposal.title')}
        </h3>
        <span className="text-label text-fg-muted">
          {summary}
          {proposal.reason === 'slip'
            ? ` · ${t('automation.schedule.proposal.slipReason')}`
            : ''}
        </span>
        {decided ? (
          <Status tone={proposal.status === 'accepted' ? 'ok' : 'draft'}>
            {t(`automation.schedule.proposal.decided.${decided}`)}
          </Status>
        ) : null}
        <span className="flex-1" />
        {open && canWrite ? (
          <>
            <Button
              size="sm"
              variant="quiet"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate()}
            >
              {t('automation.schedule.proposal.dismiss')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending
                ? t('automation.schedule.proposal.accepting')
                : t('automation.schedule.proposal.accept')}
            </Button>
          </>
        ) : null}
      </div>
      <TableBox>
        <RegistryGrid
          label={t('automation.schedule.proposal.tableLabel')}
          rows={proposal.items}
          columns={columns}
          getRowId={(r) => `${r.partId}-${r.resourceId ?? 'hands'}-${r.kind}`}
          isLoading={false}
        />
      </TableBox>
    </div>
  )
}

/** One editable instrument need in the plan dialog; the id keys the row. */
interface PlanRow {
  id: string
  resourceId: string
  minutes: string
}

let planRowSequence = 0

function newPlanRow(resourceId: string, minutes: string): PlanRow {
  planRowSequence += 1

  return { id: `plan-row-${planRowSequence}`, resourceId, minutes }
}

function PartPlanDialog({
  part,
  plan,
  needs,
  instruments,
  onClose,
}: {
  part: PartSummary
  plan: PartPlanWire | undefined
  needs: PartNeedWire[]
  instruments: InstrumentOption[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()

  const [handsOn, setHandsOn] = useState(() =>
    String(plan?.hands_on_minutes ?? 60),
  )

  const [wait, setWait] = useState(() => String(plan?.wait_after_minutes ?? 0))

  const [rows, setRows] = useState<PlanRow[]>(() =>
    needs.map((n) => newPlanRow(n.resource_id, String(n.minutes))),
  )

  const whole = (text: string, min: number) => {
    const n = Number(text)

    return text.trim() !== '' && Number.isInteger(n) && n >= min ? n : null
  }

  const handsOnValue = whole(handsOn, 0)
  const waitValue = whole(wait, 0)

  const needValues = rows.map((r) => ({
    resourceId: r.resourceId,
    minutes: whole(r.minutes, 5),
  }))

  const invalid =
    handsOnValue === null ||
    waitValue === null ||
    needValues.some((n) => n.resourceId === '' || n.minutes === null)

  const save = useMutation({
    mutationFn: () =>
      savePartPlan(client, {
        partId: part.partId,
        handsOnMinutes: handsOnValue ?? 0,
        waitAfterMinutes: waitValue ?? 0,
        needs: needValues.map((n) => ({
          resourceId: n.resourceId,
          minutes: n.minutes ?? 5,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.all })
      toast.success(t('automation.schedule.planDialog.saved'))
      onClose()
    },
    onError: (e) =>
      toast.error(
        messageOf(e, t('automation.schedule.planDialog.couldNotSave')),
      ),
  })

  const taken = new Set(rows.map((r) => r.resourceId))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('automation.schedule.planDialog.title', {
            number: part.number,
            title: part.title,
          })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <Field
              label={t('automation.schedule.planDialog.handsOn')}
              hint={t('automation.schedule.planDialog.handsOnHint')}
              error={
                handsOnValue === null
                  ? t('automation.schedule.planDialog.problemNumber')
                  : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={handsOn}
                onChange={(e) => setHandsOn(e.target.value)}
              />
            </Field>
            <Field
              label={t('automation.schedule.planDialog.wait')}
              hint={t('automation.schedule.planDialog.waitHint')}
              error={
                waitValue === null
                  ? t('automation.schedule.planDialog.problemNumber')
                  : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={wait}
                onChange={(e) => setWait(e.target.value)}
              />
            </Field>
            <Field label={t('automation.schedule.planDialog.instruments')}>
              <div className="flex flex-col gap-2">
                {rows.length === 0 ? (
                  <span className="text-fg-muted">
                    {t('automation.schedule.planDialog.noInstruments')}
                  </span>
                ) : null}
                {rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(0,1fr)_90px_auto] items-center gap-2"
                  >
                    <Select
                      aria-label={t('automation.schedule.planDialog.choose')}
                      value={row.resourceId}
                      onChange={(e) =>
                        setRows((c) =>
                          c.map((r, i) =>
                            i === index
                              ? { ...r, resourceId: e.target.value }
                              : r,
                          ),
                        )
                      }
                    >
                      <option value="">
                        {t('automation.schedule.planDialog.choose')}
                      </option>
                      {instruments
                        .filter(
                          (i) => i.id === row.resourceId || !taken.has(i.id),
                        )
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </Select>
                    <Input
                      aria-label={t('automation.schedule.planDialog.minutes')}
                      inputMode="numeric"
                      value={row.minutes}
                      onChange={(e) =>
                        setRows((c) =>
                          c.map((r, i) =>
                            i === index ? { ...r, minutes: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        setRows((c) => c.filter((_, i) => i !== index))
                      }
                    >
                      {t('automation.schedule.planDialog.remove')}
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    size="sm"
                    onClick={() => setRows((c) => [...c, newPlanRow('', '30')])}
                  >
                    {t('automation.schedule.planDialog.add')}
                  </Button>
                </div>
              </div>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || invalid}
            onClick={() => save.mutate()}
          >
            {t('automation.schedule.planDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SlipDialog({
  part,
  onClose,
}: {
  part: PartSummary
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [days, setDays] = useState('1')
  const value = Number(days)
  const invalid = !Number.isInteger(value) || value < 1

  const slip = useMutation({
    mutationFn: () => slipPart(client, part.partId, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.all })
      toast.success(t('automation.schedule.slip.requested'))
      onClose()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('automation.schedule.slip.couldNotSlip'))),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('automation.schedule.slip.title', { number: part.number })}
        />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('automation.schedule.slip.body')}
            </p>
            <Field
              label={t('automation.schedule.slip.days')}
              error={
                invalid ? t('automation.schedule.slip.problemDays') : undefined
              }
            >
              <Input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={slip.isPending || invalid}
            onClick={() => slip.mutate()}
          >
            {t('automation.schedule.slip.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
