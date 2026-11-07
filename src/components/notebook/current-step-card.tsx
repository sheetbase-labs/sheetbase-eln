import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { useInstruments } from '#/components/instruments/instruments-data'
import { useStepTimers } from '#/components/notebook/step-timer'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { useRecordPartsProgress } from '#/components/notebook/use-record-parts'
import {
  currentPart,
  daysSinceStart,
  formatPartDate,
  partDate,
  partQueryKeys,
  setPartDone,
} from '#/lib/experiment-parts'
import { gateRefusal } from '#/lib/experiment-gates'
import type { PartProgress } from '#/lib/experiment-parts'
import { currentStep, instrumentNamedBy, stepProgress } from '#/lib/step-status'
import type { StepBlockLike, StepProgress } from '#/lib/step-status'
import { stepTimerQueryKeys } from '#/lib/step-timers'

/**
 * The "Now" card at the top of a running experiment's notebook: the step to
 * work on, what has been recorded against it, and the three things done at the
 * bench — add a result, mark it done, book the instrument it needs. Its status
 * follows the evidence on the page (see `step-status.ts`), so a step with a note,
 * a result or a running timer reads as in progress without anyone setting it.
 * When every step is done the card turns into the way to submit the notebook.
 */
export function CurrentStepCard({
  recordId,
  blocks,
  canEdit,
  returned = false,
  renderSubmit,
  startedAt,
}: {
  recordId: string
  /** Every block of the notebook, so the steps of all parts are counted. */
  blocks: readonly StepBlockLike[]
  /** When the experiment started: the day its parts count from. */
  startedAt?: string
  /** The notebook is open to changes: not locked, archived or an old revision. */
  canEdit: boolean
  /** The review came back, so submitting again is a resubmission. */
  returned?: boolean
  /** The notebook's Submit button, or nothing when this person cannot submit. */
  renderSubmit?: (variant: 'primary' | 'secondary') => React.ReactNode
}) {
  const timers = useStepTimers()
  const timerBlockIds = React.useMemo(
    () => new Set((timers.data ?? []).map((timer) => timer.blockId)),
    [timers.data],
  )
  const { parts } = useRecordPartsProgress(recordId, blocks)
  const steps = React.useMemo(
    () => stepProgress(blocks, timerBlockIds, parts),
    [blocks, timerBlockIds, parts],
  )
  if (steps.length === 0 && parts.length === 0) return null
  const current = currentStep(steps)
  const nowPart = currentPart(parts)
  return (
    <section
      aria-label={t('notebook.currentStep.label')}
      data-testid="current-step-card"
      className="my-3 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 max-md:p-3.5"
    >
      {current ? (
        <RunningStep
          recordId={recordId}
          step={current}
          total={steps.length}
          canEdit={canEdit}
          timerRunning={timerBlockIds.has(current.blockId)}
          submit={renderSubmit?.('secondary')}
          part={nowPart}
          startedAt={startedAt}
        />
      ) : nowPart ? (
        <RunningPart
          recordId={recordId}
          part={nowPart}
          canEdit={canEdit}
          startedAt={startedAt}
          submit={renderSubmit?.('secondary')}
        />
      ) : (
        <AllDone
          total={steps.length}
          submit={renderSubmit?.('primary')}
          returned={returned}
        />
      )}
    </section>
  )
}

function useRefreshSteps(recordId: string) {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.blocks(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: partQueryKeys.forRecord(recordId),
      }),
      queryClient.invalidateQueries({ queryKey: stepTimerQueryKeys.all }),
    ])
  }, [queryClient, recordId])
}

/** When the part is yet to come, say which day it falls on. */
function partLaterLine(
  part: PartProgress | null,
  startedAt: string | undefined,
): string | null {
  if (!part || !startedAt) return null
  if (daysSinceStart(startedAt) >= part.dayOffset) return null
  return t('notebook.parts.partOpensLater', {
    number: String(part.number),
    date: formatPartDate(partDate(startedAt, part.dayOffset)),
  })
}

/** The card for a part that has no steps: its own title, and the way to finish it. */
function RunningPart({
  recordId,
  part,
  canEdit,
  startedAt,
  submit,
}: {
  recordId: string
  part: PartProgress
  canEdit: boolean
  startedAt?: string
  submit?: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const done = useMutation({
    mutationFn: () => setPartDone(notebookDataClient, part.id, true),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: partQueryKeys.forRecord(recordId),
        }),
        queryClient.invalidateQueries({
          queryKey: notebookQueryKeys.blocks(recordId),
        }),
      ])
      toast.success(
        t('notebook.parts.partDone', { number: String(part.number) }),
      )
    },
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  const later = partLaterLine(part, startedAt)
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-label font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {t('notebook.parts.nowPartEyebrow', { part: String(part.number) })}
        </p>
        <h2 className="m-0 font-heading text-doc font-semibold leading-snug text-fg">
          {part.title}
        </h2>
        <p className="m-0 text-body text-fg-muted">
          {later ?? t('notebook.parts.noSteps')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-1">
        {canEdit ? (
          <Button
            variant="primary"
            icon="check"
            disabled={done.isPending}
            onClick={() => done.mutate()}
          >
            {t('notebook.parts.markPartDone')}
          </Button>
        ) : null}
        {submit ? (
          <span className="ml-auto max-md:w-full">{submit}</span>
        ) : null}
      </div>
    </>
  )
}

function RunningStep({
  recordId,
  step,
  total,
  canEdit,
  timerRunning,
  submit,
  part,
  startedAt,
}: {
  recordId: string
  step: StepProgress
  total: number
  canEdit: boolean
  timerRunning: boolean
  submit?: React.ReactNode
  part: PartProgress | null
  startedAt?: string
}) {
  const refresh = useRefreshSteps(recordId)
  const [adding, setAdding] = React.useState(false)
  const markDone = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('set_step_done', {
        p_block_id: step.blockId,
        p_done: true,
      }),
    onSuccess: async () => {
      await refresh()
      toast.success(
        t('notebook.currentStep.stepDone', {
          number: String(step.partStepIndex ?? step.stepNumber ?? step.index),
        }),
      )
    },
    onError: (error) =>
      toast.error(
        gateRefusal(error)?.message ?? t('notebook.currentStep.couldNotFinish'),
      ),
  })
  const evidence = [
    stepEvidence(step, timerRunning),
    partLaterLine(part, startedAt),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-label font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {step.partNumber != null &&
          step.partStepIndex != null &&
          step.partStepCount != null
            ? t('notebook.parts.nowEyebrow', {
                part: String(step.partNumber),
                number: String(step.partStepIndex),
                total: String(step.partStepCount),
              })
            : t('notebook.currentStep.eyebrow', {
                number: String(step.index),
                total: String(total),
              })}
        </p>
        <h2 className="m-0 font-heading text-doc font-semibold leading-snug text-fg">
          {step.text}
        </h2>
        <p className="m-0 text-body text-fg-muted">{evidence}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-1">
        {canEdit ? (
          <>
            <Button onClick={() => setAdding(true)} icon="plus">
              {t('notebook.currentStep.addResult')}
            </Button>
            <Button
              variant="primary"
              disabled={markDone.isPending}
              onClick={() => markDone.mutate()}
              icon="check"
            >
              {t('notebook.currentStep.markDone')}
            </Button>
          </>
        ) : null}
        <BookStepInstrument recordId={recordId} step={step} />
        {submit ? (
          <span className="ml-auto max-md:w-full">{submit}</span>
        ) : null}
      </div>
      {adding ? (
        <AddResultDialog
          recordId={recordId}
          step={step}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  )
}

/** One line on what the page already shows for the step. */
function stepEvidence(step: StepProgress, timerRunning: boolean): string {
  const parts: string[] = []
  parts.push(
    step.status === 'in_progress'
      ? t('notebook.currentStep.inProgress')
      : t('notebook.currentStep.notStarted'),
  )
  if (timerRunning) parts.push(t('notebook.currentStep.timerRunning'))
  if (step.results > 0) {
    parts.push(t('notebook.currentStep.results', { count: step.results }))
  }
  if (step.note) parts.push(step.note.split('\n')[0].slice(0, 120))
  return parts.join(' · ')
}

function AllDone({
  total,
  submit,
  returned,
}: {
  total: number
  submit?: React.ReactNode
  returned: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-text-foreground"
        >
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-body font-semibold text-fg">
            {t('notebook.currentStep.allDone', { total: String(total) })}
          </p>
          {submit ? (
            <p className="m-0 text-label text-fg-muted">
              {returned
                ? t('notebook.currentStep.allDoneReturned')
                : t('notebook.currentStep.allDoneHint')}
            </p>
          ) : null}
        </div>
      </div>
      {submit ? <span className="max-md:w-full">{submit}</span> : null}
    </div>
  )
}

/**
 * Book the instrument this step needs: the one the step names (by a saved
 * instrument or in its words), or the schedule's booking form to choose from.
 */
function BookStepInstrument({
  recordId,
  step,
}: {
  recordId: string
  step: StepProgress
}) {
  const instruments = useInstruments()
  const named = React.useMemo(() => {
    const list = (instruments.data ?? []).filter(
      (instrument) => !instrument.retiredAt && !instrument.outOfServiceAt,
    )
    return (
      list.find((instrument) => instrument.id === step.instrumentId) ??
      instrumentNamedBy(step.text, list)
    )
  }, [instruments.data, step.instrumentId, step.text])
  return (
    <Button
      variant="quiet"
      icon="calendar"
      nativeButton={false}
      render={
        <Link
          to="/schedule"
          search={{
            ...(named ? { book: named.id } : {}),
            experiment: recordId,
            returnTo: `/experiments/${encodeURIComponent(recordId)}`,
          }}
        />
      }
    >
      {named
        ? t('notebook.currentStep.bookNamed', { name: named.name })
        : t('notebook.currentStep.bookInstrument')}
    </Button>
  )
}

function AddResultDialog({
  recordId,
  step,
  onClose,
}: {
  recordId: string
  step: StepProgress
  onClose: () => void
}) {
  const refresh = useRefreshSteps(recordId)
  const [label, setLabel] = React.useState('')
  const [value, setValue] = React.useState('')
  const [unit, setUnit] = React.useState('')
  const add = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('add_step_result', {
        p_block_id: step.blockId,
        p_label: label.trim(),
        p_value: value.trim(),
        p_unit: unit.trim() || null,
      }),
    onSuccess: async () => {
      await refresh()
      toast.success(t('notebook.currentStep.resultAdded'))
      onClose()
    },
    onError: () => toast.error(t('notebook.currentStep.couldNotAdd')),
  })
  const ready = label.trim() !== '' && value.trim() !== ''
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={t('notebook.currentStep.addResultTitle')}
          description={t('notebook.currentStep.stepOf', {
            number: String(step.index),
            text: step.text.slice(0, 120),
          })}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !add.isPending) add.mutate()
          }}
        >
          <DialogBody>
            <Field label={t('notebook.currentStep.whatLabel')} required>
              <Input
                autoFocus
                value={label}
                maxLength={200}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field label={t('notebook.currentStep.valueLabel')} required>
                <Input
                  value={value}
                  maxLength={200}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>
              <Field label={t('notebook.currentStep.unitLabel')}>
                <Input
                  value={unit}
                  maxLength={40}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </Field>
            </div>
            <p className="m-0 text-label text-fg-muted">
              {t('notebook.currentStep.addResultHint')}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || add.isPending}
            >
              {add.isPending
                ? t('notebook.currentStep.adding')
                : t('notebook.currentStep.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
