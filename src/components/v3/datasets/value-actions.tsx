import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { Textarea } from '#/components/v3/inventory/list'
import {
  clearDatasetValueFlag,
  flagDatasetValue,
  requestRepeat,
  systemFlagProvenance,
} from '#/lib/dataset-flags'
import type {
  DatasetSystemRule,
  DatasetValueFlag,
  DatasetValueFlagKind,
} from '#/lib/dataset-flags'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/format-date'

/**
 * DSET-01.5 — selected-value actions.
 *
 * The same actions wherever a Dataset value is selected (the Dataset rows
 * inspector and the experiment context that links to it):
 *
 * - Mark out of range: reason category plus an optional comment; the value
 *   stays as recorded and is excluded until the flag is cleared.
 * - Clear flag: clears the active flag (manual or rule-derived `system`).
 * - Request repeat: atomically derives a dilution sample and plans the rows
 *   that will hold the repeat.
 *
 * The caller owns permission gating (`canWrite`) and source-sample lookup; the
 * RPCs remain the authority and any refusal is surfaced as a toast, never an
 * unhandled render error.
 */

/** Human labels for the canonical flag kinds (DB is authoritative). */
export const FLAG_KIND_LABELS: Record<DatasetValueFlagKind, string> = {
  out_of_range: 'Out of range',
  missing_unit: 'Missing unit',
  above_curve: 'Above curve',
  high_cv: 'High replicate CV',
}

/** Design reason categories (canvas DialogsRecord, "Mark out of range"). */
export const FLAG_REASON_CATEGORIES = [
  "Above the assay's validated range",
  'Instrument or handling error',
  'Other',
] as const

export type FlagReasonCategory = (typeof FLAG_REASON_CATEGORIES)[number]

export interface RepeatSourceSample {
  id: string
  identifier: string
}

export interface ValueActionsProps {
  datasetId: string
  rowId: string
  fieldId: string
  fieldLabel: string
  /** Display value; null/undefined renders an em dash. */
  value: unknown
  /**
   * Active flags on this value. A manual and a system flag can coexist on the
   * same value, so each is shown and cleared separately.
   */
  flags?: readonly DatasetValueFlag[]
  /** Mirrors `is_workspace_writer`: hide write actions from a non-writer. */
  canWrite: boolean
  /** Source sample for a repeat; `null` disables the repeat action. */
  sourceSample?: RepeatSourceSample | null
  client?: DataClient
  /** Called after a successful flag, clear or repeat so the caller refreshes. */
  onChanged?: () => void
  className?: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Please try again.'
}

function errorToast(title: string) {
  return (cause: unknown) => toast(title, { description: errorMessage(cause) })
}

function flagSourceLabel(flag: DatasetValueFlag): string {
  return flag.source === 'system' ? 'System rule' : 'Set manually'
}

/** A rule's evaluated value, rendered compactly for the inspector. */
export function formatProvenanceValue(value: unknown): string {
  if (value == null) return 'no value'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * A one-line summary of a system rule's own parameters, so the inspector says
 * what the value was measured against and not just that a rule fired.
 */
export function formatRuleThreshold(
  rule: DatasetSystemRule,
  threshold: unknown,
): string | null {
  if (!threshold || typeof threshold !== 'object') return null
  const t = threshold as Record<string, unknown>
  if (rule === 'out_of_range') {
    const { min, max } = t
    if (min != null && max != null) return `expected ${min}–${max}`
    if (max != null) return `expected at most ${max}`
    if (min != null) return `expected at least ${min}`
    return null
  }
  if (rule === 'missing_unit') return 'the field requires a unit'
  // Only `high_cv` remains in the union here.
  const parts: string[] = []
  if (t.cvPercent != null) parts.push(`CV ${t.cvPercent}%`)
  if (t.replicateCount != null) parts.push(`${t.replicateCount} replicates`)
  if (t.maxCvPercent != null) parts.push(`limit ${t.maxCvPercent}%`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Flag state plus the selected-value actions. Renders the flag state honestly
 * (kind, reason, comment, manual versus system source) and lets a writer clear
 * a system flag by hand, matching the design's override behaviour.
 */
export function ValueActions({
  datasetId,
  rowId,
  fieldId,
  fieldLabel,
  value,
  flags = [],
  canWrite,
  sourceSample,
  client = notebookDataClient,
  onChanged,
  className,
}: ValueActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [clearTarget, setClearTarget] = useState<DatasetValueFlag | null>(null)

  const mark = useMutation({
    mutationFn: (input: { reason: string; comment: string | null }) =>
      flagDatasetValue(client, {
        datasetId,
        rowId,
        fieldId,
        kind: 'out_of_range',
        reason: input.reason,
        comment: input.comment,
      }),
    onSuccess: () => {
      setDialogOpen(false)
      onChanged?.()
      toast('Value marked out of range')
    },
    onError: errorToast('Could not mark the value out of range'),
  })

  const clear = useMutation({
    mutationFn: (input: { flagId: string; reason?: string | null }) =>
      clearDatasetValueFlag(client, input.flagId, input.reason ?? null),
    onSuccess: () => {
      setClearTarget(null)
      onChanged?.()
      toast('Flag cleared')
    },
    onError: errorToast('Could not clear the flag'),
  })

  // A manual flag clears in one step; a system flag is an override, so the
  // writer must record why they dismissed the rule.
  const requestClear = (flag: DatasetValueFlag) => {
    if (flag.source === 'system') setClearTarget(flag)
    else clear.mutate({ flagId: flag.id })
  }

  const repeat = useMutation({
    mutationFn: () =>
      requestRepeat(client, {
        sourceRecordId: sourceSample!.id,
        datasetId,
        sourceRowId: rowId,
        sourceFieldId: fieldId,
      }),
    onSuccess: (result) => {
      onChanged?.()
      const identifier =
        typeof result.sample.identifier === 'string'
          ? result.sample.identifier
          : 'a derived sample'
      const planned = result.plannedRowIds.length
      toast(`Request repeat queued · ${identifier}`, {
        description: `${planned} planned ${
          planned === 1 ? 'row' : 'rows'
        } added to the dataset (no values yet).`,
      })
    },
    onError: errorToast('Could not request a repeat'),
  })

  const busy = mark.isPending || clear.isPending || repeat.isPending

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {canWrite ? null : (
        <Notice tone="info" icon={false}>
          You have read access to this dataset, so flag and repeat actions are
          unavailable. Ask a workspace writer.
        </Notice>
      )}

      {flags.length ? (
        <div className="flex flex-col gap-2">
          {flags.map((flag) => {
            const provenance = systemFlagProvenance(flag)
            const threshold = provenance
              ? formatRuleThreshold(provenance.rule, provenance.threshold)
              : null
            return (
              <div
                key={flag.id}
                className="rounded-md bg-danger-wash px-3 py-2.5 text-label leading-[18px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-danger-text">
                    {FLAG_KIND_LABELS[flag.kind]}
                  </span>
                  <span
                    className={cn(
                      'rounded-sm px-1.5 py-0.5 text-label',
                      flag.source === 'system'
                        ? 'bg-canvas-sunken text-fg-muted'
                        : 'bg-selection-subtle text-fg',
                    )}
                  >
                    {flagSourceLabel(flag)}
                  </span>
                </div>
                <div className="mt-0.5 text-fg">{flag.reason}</div>
                {provenance ? (
                  <div className="mt-0.5 text-fg-muted">
                    Evaluated {formatProvenanceValue(provenance.evaluatedValue)}
                    {threshold ? ` · ${threshold}` : ''}
                    {provenance.evaluatedAt
                      ? ` · ${formatDate(provenance.evaluatedAt)}`
                      : ''}
                  </div>
                ) : null}
                {flag.comment ? (
                  <div className="mt-0.5 text-fg-muted">{flag.comment}</div>
                ) : null}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-fg-muted">
                    {flag.setAt ? `Set ${formatDate(flag.setAt)}` : ''}
                  </span>
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => requestClear(flag)}
                    >
                      Clear flag
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Muted>No flag on this value.</Muted>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!canWrite || busy}
          onClick={() => setDialogOpen(true)}
        >
          Mark out of range…
        </Button>
        <Button
          size="sm"
          disabled={!canWrite || busy || !sourceSample}
          title={
            sourceSample
              ? `Repeat ${fieldLabel} from ${sourceSample.identifier}`
              : 'No source sample is linked to this row, so a repeat cannot be requested from here.'
          }
          onClick={() => repeat.mutate()}
        >
          Request repeat
        </Button>
        {repeat.data?.plannedRows.at(0) ? (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link
                to="/readings/new"
                search={{
                  sample: repeat.data.sample.id,
                  dataset: datasetId,
                  plannedKey: repeat.data.plannedRows[0].plannedKey,
                  returnTo: `/datasets/${datasetId}/rows?row=${rowId}&field=${fieldId}&live=true`,
                }}
              />
            }
          >
            Record repeat reading
          </Button>
        ) : null}
      </div>

      <MarkOutOfRangeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fieldLabel={fieldLabel}
        value={value}
        busy={mark.isPending}
        onSubmit={(reason, comment) => mark.mutate({ reason, comment })}
      />

      <ClearSystemFlagDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null)
        }}
        flagLabel={
          clearTarget ? FLAG_KIND_LABELS[clearTarget.kind] : 'this value'
        }
        busy={clear.isPending}
        onSubmit={(reason) =>
          clearTarget && clear.mutate({ flagId: clearTarget.id, reason })
        }
      />
    </div>
  )
}

export interface MarkOutOfRangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fieldLabel: string
  value: unknown
  busy?: boolean
  onSubmit: (reason: string, comment: string | null) => void
}

/**
 * The reusable "Mark out of range" dialog. Reason category is required; the
 * comment is optional. The value is never edited here, which the notice says.
 */
export function MarkOutOfRangeDialog({
  open,
  onOpenChange,
  fieldLabel,
  value,
  busy = false,
  onSubmit,
}: MarkOutOfRangeDialogProps) {
  const groupName = useId()
  const formId = useId()
  const [reason, setReason] = useState<FlagReasonCategory>(
    FLAG_REASON_CATEGORIES[0],
  )
  const [comment, setComment] = useState('')

  const submit = () => {
    onSubmit(reason, comment.trim() ? comment.trim() : null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason(FLAG_REASON_CATEGORIES[0])
          setComment('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title="Mark value out of range"
          description={`${fieldLabel} · ${value == null ? '—' : String(value)}`}
        />
        <DialogBody>
          <Notice tone="warn" icon={false}>
            The value stays as recorded. It is flagged as out of range and
            excluded from criteria and analyses until a corrected value is
            imported into the dataset.
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-label font-medium text-fg">
                Reason
              </legend>
              {FLAG_REASON_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex cursor-pointer items-center gap-2 text-label text-fg"
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={category}
                    checked={reason === category}
                    disabled={busy}
                    onChange={() => setReason(category)}
                  />
                  {category}
                </label>
              ))}
            </fieldset>
            <Field label="Comment">
              <Textarea
                value={comment}
                rows={2}
                disabled={busy}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            Mark out of range
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface ClearSystemFlagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  flagLabel: string
  busy?: boolean
  onSubmit: (reason: string) => void
}

/**
 * Clearing a rule-generated flag is a review decision, so it records why. The
 * reason is required by the database; the button stays disabled until one is
 * entered. The rule can only be dismissed, not deleted: the value itself is
 * untouched and a later change may flag it again.
 */
export function ClearSystemFlagDialog({
  open,
  onOpenChange,
  flagLabel,
  busy = false,
  onSubmit,
}: ClearSystemFlagDialogProps) {
  const formId = useId()
  const [reason, setReason] = useState('')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title="Clear system flag"
          description={`${flagLabel} · set by a rule`}
        />
        <DialogBody>
          <Notice tone="warn" icon={false}>
            This flag was derived from a rule, not set by a person. Clearing it
            records your reason and dismisses the rule for this value; the value
            stays as recorded and a later change may flag it again.
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (reason.trim()) onSubmit(reason.trim())
            }}
          >
            <Field label="Reason">
              <Textarea
                value={reason}
                rows={3}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || reason.trim().length === 0}
          >
            Clear flag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
