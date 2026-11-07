import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Textarea } from '#/components/inventory/list'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Choice } from '#/components/ui/choice'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { IconButton } from '#/components/ui/icon-button'
import { Field, Input } from '#/components/ui/input'
import { RadioGroup } from '#/components/ui/radio-group'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import {
  GATE_REASON_MAX,
  MAX_GATE_CONDITIONS,
  evaluateGateCondition,
  fetchGateOverrides,
  gateQueryKeys,
  nameList,
  normaliseGateReason,
  overrideGate,
} from '#/lib/experiment-gates'
import type {
  GateBlockLike,
  GateCondition,
  GateContext,
  GateMode,
  GatePartLike,
  RecordGate,
} from '#/lib/experiment-gates'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchQcSeries, qcKeys } from '#/lib/run-qc'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'

// ---------------------------------------------------------------------------
// What the page knows about the gates, shared with the blocks it holds back
// ---------------------------------------------------------------------------

export interface GatesState {
  recordId: string
  /** The gates as the database sees them, with the page's own check laid over. */
  gates: readonly RecordGate[]
  /** Blocks held back by a gate that is closed, with the gate that holds each. */
  held: ReadonlyMap<string, RecordGate>
  /** Steps that wait on an earlier step of their part: step id to that step's number. */
  stepWaits: ReadonlyMap<string, number>
  /** The page can change gates and go on past them. */
  canEdit: boolean
  /** A protocol: gates are written down for the experiments made from it, and hold nothing here. */
  describeOnly: boolean
  /** What the page has loaded, for the words of a condition. */
  context: GateContext
  nameOf: (userId: string | null) => string
  /** Ask for the reason and go on past a gate that warns. */
  goOn: (gate: RecordGate) => void
  /** Change a gate block, or the rule of a part. */
  edit: (gate: RecordGate) => void
  /** Move to a block on the page (the table a gate waits on). */
  show: (blockId: string) => void
  /** What a new gate can wait on, from the blocks above `beforeOrder`. */
  targetsFor: (beforeOrder?: number) => GateTargets
}

const GatesContext = React.createContext<GatesState | null>(null)
export const GatesProvider = GatesContext.Provider

export function useGates(): GatesState | null {
  return React.useContext(GatesContext)
}

/** The gate holding a block back, if one is closed. */
export function useHeldBy(blockId: string | undefined): RecordGate | null {
  const gates = useGates()
  return (blockId && gates?.held.get(blockId)) || null
}

/** "After step 2" for a step that waits on the one before it, else null. */
export function useStepWait(blockId: string | undefined): number | null {
  const gates = useGates()
  return (blockId && gates?.stepWaits.get(blockId)) || null
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function blockTitle(
  block: GateBlockLike | undefined,
  fallbackNumber: number,
): string {
  const title =
    block && typeof block.payload.title === 'string'
      ? block.payload.title.trim()
      : ''
  return (
    title ||
    t('notebook.gates.dialog.untitledTable', { number: String(fallbackNumber) })
  )
}

const FIELD_LABELS: Partial<Record<string, () => string>> = {
  reviewer: () => t('notebook.gates.dialog.fieldReviewer'),
  assignee: () => t('notebook.gates.dialog.fieldAssignee'),
  planned_end: () => t('notebook.gates.dialog.fieldPlannedEnd'),
}

function dateWords(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** One condition as something that is true: "Confluence check has Confluence (%) for every row". */
export function describeCondition(
  condition: GateCondition,
  context: GateContext,
): string {
  switch (condition.kind) {
    case 'table_filled': {
      const block = context.blocks.find((b) => b.id === condition.blockId)
      const tables = context.blocks.filter(
        (b) => b.type === 'table' || b.type === 'sheet',
      )
      const table =
        condition.label?.trim() ||
        blockTitle(
          block,
          tables.findIndex((b) => b.id === condition.blockId) + 1,
        )
      if (condition.column && condition.minRows)
        return t('notebook.gates.describe.table_filled_column_rows', {
          table,
          column: condition.column,
          count: condition.minRows,
        })
      if (condition.column)
        return t('notebook.gates.describe.table_filled_column', {
          table,
          column: condition.column,
        })
      if (condition.minRows)
        return t('notebook.gates.describe.table_filled_rows', {
          table,
          count: condition.minRows,
        })
      return t('notebook.gates.describe.table_filled_any', { table })
    }
    case 'step_done': {
      const steps = context.blocks.filter((b) => b.type === 'procedure_step')
      const block = steps.find(
        (b) =>
          b.id === condition.blockId ||
          b.payload.sourceStepBlockId === condition.blockId,
      )
      const number = block
        ? steps.filter(
            (s) =>
              (s.partId ?? null) === (block.partId ?? null) &&
              s.order <= block.order,
          ).length
        : 0
      return t('notebook.gates.describe.step_done', { number: String(number) })
    }
    case 'part_done': {
      const part = context.parts.find(
        (p) => p.id === condition.partId || p.sourcePartId === condition.partId,
      )
      return part
        ? t('notebook.gates.describe.part_done', {
            number: String(part.number),
          })
        : t('notebook.gates.describe.thePart')
    }
    case 'samples_linked':
      return t('notebook.gates.describe.samples_linked', {
        count: condition.min ?? 1,
      })
    case 'field_set':
      return t('notebook.gates.describe.field_set', {
        field:
          condition.label?.trim() ||
          FIELD_LABELS[condition.field]?.() ||
          condition.field,
      })
    case 'date_reached':
      return t('notebook.gates.describe.date_reached', {
        date: dateWords(condition.date),
      })
    case 'qc_in_control':
      return condition.seriesId && condition.label?.trim()
        ? t('notebook.gates.describe.qc_in_control_series', {
            series: condition.label.trim(),
          })
        : t('notebook.gates.describe.qc_in_control_any')
  }
}

/** "A and B", "A, B and C": the conditions of a gate in one phrase. */
export function describeConditions(
  conditions: readonly GateCondition[],
  context: GateContext,
): string {
  return nameList(conditions.map((c) => describeCondition(c, context)))
}

/** The sentence a closed gate leads with. */
function gateHeadline(
  gate: RecordGate,
  conditions: readonly GateCondition[],
  context: GateContext,
): string {
  const words = describeConditions(conditions, context)
  return gate.kind === 'part'
    ? t('notebook.gates.opensWhenPart', {
        number: String(gate.partNumber ?? ''),
        conditions: words,
      })
    : t('notebook.gates.opensWhen', { label: gate.label, conditions: words })
}

/** The first thing to do about an unmet condition: fill the table, or go to it. */
function firstAction(
  gate: RecordGate,
  conditions: readonly GateCondition[],
  context: GateContext,
): { label: string; blockId: string } | null {
  const index = gate.conditions.findIndex((c) => !c.met)
  const condition = index >= 0 ? conditions[index] : undefined
  if (!condition || condition.kind !== 'table_filled') return null
  const status = gate.conditions[index]
  const block = context.blocks.find((b) => b.id === condition.blockId)
  if (!block) return null
  // "P3 and P4 have no Confluence (%)": the first name is where to start.
  const first = condition.column
    ? status.text.match(/^(.+?)(?: and | have | has |, )/)?.[1]
    : undefined
  const name =
    first && !first.startsWith('The ') && first !== condition.label
      ? first
      : null
  return {
    blockId: block.id,
    label: name
      ? t('notebook.gates.fill', { name })
      : t('notebook.gates.goTo', {
          name: condition.label?.trim() || blockTitle(block, 1),
        }),
  }
}

// ---------------------------------------------------------------------------
// The gate on the page
// ---------------------------------------------------------------------------

/** A gate block as the page shows it. */
export function GateBlockView({
  blockId,
  payload,
}: {
  blockId?: string
  payload: Record<string, unknown>
}) {
  const state = useGates()
  const gate = state?.gates.find((g) => g.blockId === blockId) ?? null
  const conditions = React.useMemo(
    () =>
      Array.isArray(payload.conditions)
        ? (payload.conditions as GateCondition[])
        : [],
    [payload.conditions],
  )
  const label =
    typeof payload.label === 'string' && payload.label.trim()
      ? payload.label.trim()
      : t('notebook.gates.blockLabel')
  const mode: GateMode = payload.mode === 'block' ? 'block' : 'warn'
  const fromTemplate = payload.fromTemplate === true
  const context: GateContext = state?.context ?? { blocks: [], parts: [] }

  if (gate && state?.describeOnly) {
    return (
      <div
        data-gate="described"
        className="flex items-start gap-2 rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-label text-fg-muted"
      >
        <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          {t('notebook.gates.opensWhen', {
            label,
            conditions: describeConditions(conditions, context),
          })}{' '}
          {mode === 'block'
            ? t('notebook.gates.protocolBlocks')
            : t('notebook.gates.protocolWarns')}
        </span>
        {state.canEdit ? (
          <IconButton
            label={t('notebook.gates.edit')}
            icon="edit"
            onClick={() => state.edit(gate)}
          />
        ) : null}
      </div>
    )
  }

  if (!gate || !state) {
    // Read away from the live page (history, review): say what it was.
    return (
      <div
        data-gate="static"
        className="flex items-start gap-2 rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-label text-fg-muted"
      >
        <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
        <span>
          {t('notebook.gates.opensWhen', {
            label,
            conditions: describeConditions(conditions, context),
          })}
        </span>
      </div>
    )
  }

  const headline = gateHeadline(gate, conditions, context)
  const action = firstAction(gate, conditions, context)
  const canGoOn =
    state.canEdit && mode === 'warn' && !gate.met && !gate.overridden
  const canEdit = state.canEdit && !fromTemplate

  if (gate.met) {
    return (
      <div
        data-gate="open"
        className="flex items-center gap-2 rounded-md px-1 py-1 text-label text-fg-muted"
      >
        <Icon name="check" size={14} className="shrink-0 text-success" />
        <span className="min-w-0 flex-1">
          {t('notebook.gates.openLine', { label })}
        </span>
        {fromTemplate ? (
          <span
            className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-caption"
            title={t('notebook.gates.fromTemplateHint')}
          >
            {t('notebook.gates.fromTemplate')}
          </span>
        ) : null}
        {canEdit ? (
          <IconButton
            label={t('notebook.gates.edit')}
            icon="edit"

            onClick={() => state.edit(gate)}
          />
        ) : null}
      </div>
    )
  }

  if (gate.overridden) {
    return (
      <div
        data-gate="gone-past"
        className="flex items-start gap-2 rounded-md border border-dashed border-warning-border bg-surface-muted px-3 py-2 text-label"
      >
        <Icon
          name="warn"
          size={14}
          className="mt-0.5 shrink-0 text-warning-text"
        />
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-fg">{headline}</span>{' '}
          <span className="text-fg-muted">
            {t('notebook.gates.wentOnBy', {
              name: state.nameOf(gate.overriddenByUserId),
              reason: gate.overrideReason ?? '',
            })}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      data-gate={gate.blocking ? 'blocking' : 'closed'}
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-warning-border bg-warning-wash px-3 py-2.5 text-label leading-[18px]"
    >
      <Icon name="lock" size={14} className="shrink-0 text-warning-text" />
      <div className="min-w-0 flex-1 basis-[16rem]">
        <span className="font-semibold text-warning-text">{headline}</span>{' '}
        <span className="text-fg">
          {gate.missing.map((text) => `${text}.`).join(' ')}
        </span>
        {mode === 'block' ? (
          <span className="mt-0.5 block text-fg-muted">
            {t('notebook.gates.blockedNote')}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {action ? (
          <Button onClick={() => state.show(action.blockId)}>
            {action.label}
          </Button>
        ) : null}
        {canGoOn ? (
          <Button onClick={() => state.goOn(gate)}>
            {t('notebook.gates.goOnAnyway')}
          </Button>
        ) : null}
        {fromTemplate ? (
          <span
            className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-caption text-fg-muted"
            title={t('notebook.gates.fromTemplateHint')}
          >
            {t('notebook.gates.fromTemplate')}
          </span>
        ) : null}
        {canEdit ? (
          <IconButton
            label={t('notebook.gates.edit')}
            icon="edit"

            onClick={() => state.edit(gate)}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The note on a step that has to wait for the one before it. */
export function StepWaitNote({ blockId }: { blockId?: string }) {
  const number = useStepWait(blockId)
  if (!number) return null
  return (
    <p
      className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-muted"
      title={t('notebook.gates.stepsInOrderHint')}
    >
      <Icon name="lock" size={12} />
      {t('notebook.gates.afterStep', { number: String(number) })}
    </p>
  )
}

/** Dims what a closed gate holds back, and keeps it from being used. */
export function GateHold({
  blockId,
  children,
  className,
}: {
  blockId: string
  children: React.ReactNode
  className?: string
}) {
  const gate = useHeldBy(blockId)
  if (!gate) return <>{children}</>
  return (
    <div
      data-held-by={gate.gateId}
      title={t('notebook.gates.laterHeld')}
      className={cn('opacity-45 select-none', className)}
      // The gate says why. Until it opens (or someone goes on), nothing here is used.
      inert
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Go on anyway
// ---------------------------------------------------------------------------

/** Ask why, then go on past a gate that warns. */
export function GoOnDialog({
  gate,
  recordId,
  onClose,
  onDone,
}: {
  gate: RecordGate
  recordId: string
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const clean = normaliseGateReason(reason)
  const go = useMutation({
    mutationFn: () =>
      overrideGate(
        notebookDataClient,
        gate.blockId ? { blockId: gate.blockId } : { partId: gate.partId! },
        reason,
      ),
    onSuccess: async () => {
      await onDone()
      toast.success(t('notebook.gates.wentOnDone'))
      onClose()
    },
    onError: () => toast.error(t('notebook.gates.couldNotGoOn')),
  })
  void recordId
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={t('notebook.gates.override.title')}
          description={t('notebook.gates.override.body', {
            gate:
              gate.kind === 'part'
                ? t('notebook.parts.partNumber', {
                    number: String(gate.partNumber ?? ''),
                  })
                : gate.label,
          })}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (clean && !go.isPending) go.mutate()
          }}
        >
          <DialogBody>
            <div className="rounded-md bg-warning-wash px-3 py-2 text-label">
              <span className="font-semibold text-warning-text">
                {t('notebook.gates.override.missingLabel')}
              </span>
              <ul className="mt-1 list-disc pl-4 text-fg">
                {gate.missing.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
            <Field label={t('notebook.gates.override.reasonLabel')} required>
              <Textarea
                autoFocus
                value={reason}
                rows={3}
                maxLength={GATE_REASON_MAX}
                placeholder={t('notebook.gates.override.reasonPlaceholder')}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!clean || go.isPending}
            >
              {go.isPending
                ? t('notebook.gates.override.working')
                : t('notebook.gates.override.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Authoring: the gate dialog
// ---------------------------------------------------------------------------

/** What a condition can point at. */
export interface GateTargets {
  tables: ReadonlyArray<{
    id: string
    label: string
    columns: readonly string[]
  }>
  steps: ReadonlyArray<{ id: string; number: number; text: string }>
  parts: ReadonlyArray<{ id: string; number: number; title: string }>
}

export interface GateDraft {
  label: string
  mode: GateMode
  conditions: GateCondition[]
  stepsInOrder: boolean
}

type Kind = GateCondition['kind']

const ALL_KINDS: readonly Kind[] = [
  'table_filled',
  'step_done',
  'part_done',
  'samples_linked',
  'field_set',
  'date_reached',
  'qc_in_control',
]

/** A first condition of a kind, pointed at something that exists when it can be. */
function blankCondition(kind: Kind, targets: GateTargets): GateCondition {
  switch (kind) {
    case 'table_filled': {
      const table = targets.tables.at(-1)
      return {
        kind,
        blockId: table?.id ?? '',
        ...((table?.columns[1] ?? table?.columns[0])
          ? { column: table.columns[1] ?? table.columns[0] }
          : { minRows: 1 }),
        ...(table ? { label: table.label } : {}),
      }
    }
    case 'step_done':
      return { kind, blockId: targets.steps.at(-1)?.id ?? '' }
    case 'part_done':
      return { kind, partId: targets.parts.at(-1)?.id ?? '' }
    case 'samples_linked':
      return { kind, min: 1 }
    case 'field_set':
      return {
        kind,
        field: 'reviewer',
        label: t('notebook.gates.dialog.fieldReviewer'),
      }
    case 'date_reached':
      return { kind, date: new Date().toISOString().slice(0, 10) }
    case 'qc_in_control':
      return { kind }
  }
}

function conditionIsComplete(condition: GateCondition): boolean {
  switch (condition.kind) {
    case 'table_filled':
      return (
        Boolean(condition.blockId) &&
        Boolean(condition.column || condition.minRows)
      )
    case 'step_done':
      return Boolean(condition.blockId)
    case 'part_done':
      return Boolean(condition.partId)
    case 'samples_linked':
      return true
    case 'field_set':
      return Boolean(condition.field)
    case 'date_reached':
      return /^\d{4}-\d{2}-\d{2}$/.test(condition.date)
    case 'qc_in_control':
      return true
  }
}

const ROWS_OPTION = '__rows__'

/** Which tracked quality control series a gate waits on: all of them, or one. */
function QcSeriesSelect({
  condition,
  onChange,
}: {
  condition: Extract<GateCondition, { kind: 'qc_in_control' }>
  onChange: (next: GateCondition) => void
}) {
  const list = useQuery({
    queryKey: qcKeys.series('gate-picker'),
    queryFn: () => fetchQcSeries(notebookDataClient),
    staleTime: 10_000,
  })
  return (
    <Select
      aria-label={t('notebook.gates.dialog.qcSeriesLabel')}
      value={condition.seriesId ?? ''}
      className="w-auto min-w-48"
      onChange={(event) => {
        const series = (list.data ?? []).find(
          (s) => s.id === event.target.value,
        )
        onChange(
          series
            ? { kind: 'qc_in_control', seriesId: series.id, label: series.name }
            : { kind: 'qc_in_control' },
        )
      }}
    >
      <option value="">{t('notebook.gates.dialog.qcAnySeries')}</option>
      {(list.data ?? []).map((series) => (
        <option key={series.id} value={series.id}>
          {series.name}
        </option>
      ))}
    </Select>
  )
}

function ConditionRow({
  condition,
  targets,
  kinds,
  onChange,
  onRemove,
  lead,
}: {
  condition: GateCondition
  targets: GateTargets
  kinds: readonly Kind[]
  onChange: (next: GateCondition) => void
  onRemove: () => void
  lead: string
}) {
  const table =
    condition.kind === 'table_filled'
      ? targets.tables.find((tbl) => tbl.id === condition.blockId)
      : undefined
  return (
    <div className="flex flex-col gap-1.5" data-condition={condition.kind}>
      <span className="text-caption font-semibold uppercase tracking-wide text-fg-muted">
        {lead}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('notebook.gates.dialog.kindLabel')}
          value={condition.kind}
          className="w-auto min-w-44"
          onChange={(event) =>
            onChange(blankCondition(event.target.value as Kind, targets))
          }
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`notebook.gates.dialog.kind.${kind}`)}
            </option>
          ))}
        </Select>
        {condition.kind === 'table_filled' ? (
          <>
            <Select
              aria-label={t('notebook.gates.dialog.tableLabel')}
              value={condition.blockId}
              className="w-auto min-w-40"
              onChange={(event) => {
                const next = targets.tables.find(
                  (tbl) => tbl.id === event.target.value,
                )
                onChange({
                  kind: 'table_filled',
                  blockId: event.target.value,
                  ...((next?.columns[1] ?? next?.columns[0])
                    ? { column: next.columns[1] ?? next.columns[0] }
                    : { minRows: 1 }),
                  ...(next ? { label: next.label } : {}),
                })
              }}
            >
              <option value="" disabled>
                {t('notebook.gates.dialog.pickTable')}
              </option>
              {targets.tables.map((tbl) => (
                <option key={tbl.id} value={tbl.id}>
                  {tbl.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('notebook.gates.dialog.rowsLabel')}
              value={condition.column ?? ROWS_OPTION}
              className="w-auto min-w-40"
              onChange={(event) => {
                const { column: _column, minRows: _min, ...rest } = condition
                onChange(
                  event.target.value === ROWS_OPTION
                    ? { ...rest, minRows: 1 }
                    : { ...rest, column: event.target.value },
                )
              }}
            >
              {(table?.columns ?? []).map((column) => (
                <option key={column} value={column}>
                  {t('notebook.gates.dialog.everyRowHas', { column })}
                </option>
              ))}
              <option value={ROWS_OPTION}>
                {t('notebook.gates.dialog.atLeastRows')}
              </option>
            </Select>
            {condition.column === undefined ? (
              <Input
                aria-label={t('notebook.gates.dialog.rowsLabel')}
                inputMode="numeric"
                className="w-20"
                value={String(condition.minRows ?? 1)}
                onChange={(event) => {
                  const value = Number(event.target.value.replace(/\D/g, ''))
                  onChange({ ...condition, minRows: Math.max(1, value || 1) })
                }}
              />
            ) : null}
          </>
        ) : null}
        {condition.kind === 'step_done' ? (
          <Select
            aria-label={t('notebook.gates.dialog.stepLabel')}
            value={condition.blockId}
            className="w-auto min-w-48"
            onChange={(event) =>
              onChange({ kind: 'step_done', blockId: event.target.value })
            }
          >
            <option value="" disabled>
              {t('notebook.gates.dialog.pickStep')}
            </option>
            {targets.steps.map((step) => (
              <option key={step.id} value={step.id}>
                {t('notebook.gates.dialog.stepOption', {
                  number: String(step.number),
                  text: step.text.slice(0, 40),
                })}
              </option>
            ))}
          </Select>
        ) : null}
        {condition.kind === 'part_done' ? (
          <Select
            aria-label={t('notebook.gates.dialog.partLabel')}
            value={condition.partId}
            className="w-auto min-w-48"
            onChange={(event) =>
              onChange({ kind: 'part_done', partId: event.target.value })
            }
          >
            <option value="" disabled>
              {t('notebook.gates.dialog.pickPart')}
            </option>
            {targets.parts.map((part) => (
              <option key={part.id} value={part.id}>
                {t('notebook.parts.partTitle', {
                  number: String(part.number),
                  title: part.title,
                })}
              </option>
            ))}
          </Select>
        ) : null}
        {condition.kind === 'samples_linked' ? (
          <Input
            aria-label={t('notebook.gates.dialog.samplesLabel')}
            inputMode="numeric"
            className="w-20"
            value={String(condition.min ?? 1)}
            onChange={(event) => {
              const value = Number(event.target.value.replace(/\D/g, ''))
              onChange({ kind: 'samples_linked', min: Math.max(1, value || 1) })
            }}
          />
        ) : null}
        {condition.kind === 'field_set' ? (
          <Select
            aria-label={t('notebook.gates.dialog.fieldLabel')}
            value={condition.field}
            className="w-auto min-w-40"
            onChange={(event) =>
              onChange({
                kind: 'field_set',
                field: event.target.value,
                label: FIELD_LABELS[event.target.value]?.(),
              })
            }
          >
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <option key={field} value={field}>
                {label?.()}
              </option>
            ))}
          </Select>
        ) : null}
        {condition.kind === 'qc_in_control' ? (
          <QcSeriesSelect condition={condition} onChange={onChange} />
        ) : null}
        {condition.kind === 'date_reached' ? (
          <Input
            aria-label={t('notebook.gates.dialog.dateLabel')}
            type="date"
            className="w-auto"
            value={condition.date}
            onChange={(event) =>
              onChange({ kind: 'date_reached', date: event.target.value })
            }
          />
        ) : null}
        <IconButton
          label={t('notebook.gates.dialog.removeCondition')}
          icon="x"

          onClick={onRemove}
        />
      </div>
    </div>
  )
}

/**
 * The dialog that makes or changes a gate: what it waits on, whether it warns
 * or blocks, and for a part, whether its steps are done in order. The same
 * dialog serves a gate block, the rule that opens a part and a template.
 */
export function GateDialog({
  part,
  initial,
  targets,
  kinds = ALL_KINDS,
  named = true,
  canStepsInOrder = false,
  removable = false,
  saving = false,
  onSave,
  onRemove,
  onClose,
}: {
  /** Set for the rule that opens a part: the part's number. */
  part?: number
  initial?: Partial<GateDraft>
  targets: GateTargets
  kinds?: readonly Kind[]
  /** Offer a name for the gate (a gate block has one; a part's rule has not). */
  named?: boolean
  canStepsInOrder?: boolean
  removable?: boolean
  saving?: boolean
  onSave: (draft: GateDraft) => void | Promise<void>
  onRemove?: () => void | Promise<void>
  onClose: () => void
}) {
  const usable = kinds.filter((kind) => {
    if (kind === 'table_filled') return targets.tables.length > 0
    if (kind === 'step_done') return targets.steps.length > 0
    if (kind === 'part_done') return targets.parts.length > 0
    return true
  })
  const [label, setLabel] = React.useState(initial?.label ?? '')
  const [mode, setMode] = React.useState<GateMode>(initial?.mode ?? 'warn')
  const [stepsInOrder, setStepsInOrder] = React.useState(
    initial?.stepsInOrder ?? false,
  )
  const [conditions, setConditions] = React.useState<GateCondition[]>(() =>
    initial?.conditions?.length
      ? [...initial.conditions]
      : usable[0]
        ? [blankCondition(usable[0], targets)]
        : [],
  )
  const complete =
    conditions.length > 0 && conditions.every(conditionIsComplete)
  const onlyDates = conditions.every((c) => c.kind === 'date_reached')
  const ready =
    (complete ||
      (conditions.length === 0 && stepsInOrder && part !== undefined)) &&
    (!named || true)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-xl" data-testid="gate-dialog">
        <DialogHeader
          title={
            part !== undefined
              ? t('notebook.gates.dialog.titlePart', { number: String(part) })
              : t('notebook.gates.dialog.title')
          }
          description={
            part !== undefined
              ? t('notebook.gates.dialog.descriptionPart')
              : t('notebook.gates.dialog.description')
          }
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !saving)
              void onSave({
                label: label.trim(),
                mode,
                conditions: complete ? conditions : [],
                stepsInOrder,
              })
          }}
        >
          <DialogBody>
            {named ? (
              <Field
                label={t('notebook.gates.dialog.labelLabel')}
                hint={t('notebook.gates.dialog.labelHint')}
              >
                <Input
                  value={label}
                  maxLength={200}
                  placeholder={t('notebook.gates.dialog.labelPlaceholder')}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
            ) : null}
            <div className="flex flex-col gap-3">
              {conditions.map((condition, index) => (
                <ConditionRow
                  key={index}
                  lead={
                    index === 0
                      ? t('notebook.gates.dialog.conditionsLabel')
                      : t('notebook.gates.dialog.and')
                  }
                  condition={condition}
                  targets={targets}
                  kinds={usable}
                  onChange={(next) =>
                    setConditions((all) =>
                      all.map((c, i) => (i === index ? next : c)),
                    )
                  }
                  onRemove={() =>
                    setConditions((all) => all.filter((_, i) => i !== index))
                  }
                />
              ))}
              {usable.length === 0 ? (
                <p className="text-label text-fg-muted">
                  {t('notebook.gates.dialog.noTargets')}
                </p>
              ) : null}
              <div>
                <Button
                  type="button"

                  variant="quiet"
                  icon="plus"
                  disabled={
                    conditions.length >= MAX_GATE_CONDITIONS ||
                    usable.length === 0
                  }
                  onClick={() =>
                    setConditions((all) => [
                      ...all,
                      blankCondition(usable[0], targets),
                    ])
                  }
                >
                  {t('notebook.gates.dialog.addCondition')}
                </Button>
              </div>
              <p className="text-caption text-fg-muted">
                {t('notebook.gates.dialog.otherConditions')}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
              <legend className="mb-1 text-caption font-semibold uppercase tracking-wide text-fg-muted">
                {t('notebook.gates.dialog.untilThen')}
              </legend>
              <RadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as GateMode)}
              >
                <Choice value="warn" title={t('notebook.gates.dialog.warn')}>
                  {t('notebook.gates.dialog.warnHint')}
                </Choice>
                <Choice
                  value="block"
                  title={t('notebook.gates.dialog.block')}
                  disabled={onlyDates && complete}
                >
                  {part !== undefined
                    ? t('notebook.gates.dialog.blockHintPart')
                    : t('notebook.gates.dialog.blockHint')}
                </Choice>
              </RadioGroup>
              {canStepsInOrder ? (
                <label className="flex cursor-pointer items-center gap-2 text-label text-fg">
                  <Checkbox
                    checked={stepsInOrder}
                    onCheckedChange={(value) => setStepsInOrder(value === true)}
                  />
                  {t('notebook.gates.dialog.stepsInOrder')}
                </label>
              ) : null}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            {removable && onRemove ? (
              <Button
                type="button"
                variant="danger"
                className="mr-auto"
                disabled={saving}
                onClick={() => void onRemove()}
              >
                {t('notebook.gates.dialog.remove')}
              </Button>
            ) : null}
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || saving}>
              {saving
                ? t('notebook.gates.dialog.saving')
                : t('notebook.gates.dialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What a gate dialog can point at, taken from the blocks and parts of a page. */
export function gateTargetsFrom(
  blocks: readonly (GateBlockLike & { tableColumns?: readonly string[] })[],
  parts: readonly GatePartLike[],
  options: {
    /** Only what sits above this order counts (a gate waits on earlier work). */
    beforeOrder?: number
    /** Only parts before this number. */
    beforePart?: number
    sheetColumns?: ReadonlyMap<string, readonly string[]>
  } = {},
): GateTargets {
  const above = [...blocks]
    .filter(
      (b) => options.beforeOrder === undefined || b.order < options.beforeOrder,
    )
    .sort((a, b) => a.order - b.order)
  const tables = above
    .filter((b) => b.type === 'table' || b.type === 'sheet')
    .map((b, index) => ({
      id: b.id,
      label: blockTitle(b, index + 1),
      columns:
        b.type === 'table'
          ? Array.isArray(b.payload.columns)
            ? (b.payload.columns as unknown[]).map(String)
            : []
          : (options.sheetColumns?.get(b.id) ?? []),
    }))
  const steps = above
    .filter((b) => b.type === 'procedure_step')
    .map((b) => ({
      id: b.id,
      number: above.filter(
        (s) =>
          s.type === 'procedure_step' &&
          (s.partId ?? null) === (b.partId ?? null) &&
          s.order <= b.order,
      ).length,
      text: typeof b.payload.text === 'string' ? b.payload.text : '',
    }))
  return {
    tables,
    steps,
    parts: parts
      .filter(
        (p) =>
          options.beforePart === undefined || p.number < options.beforePart,
      )
      .map((p) => ({ id: p.id, number: p.number, title: p.title })),
  }
}

// ---------------------------------------------------------------------------
// A part that is not open yet
// ---------------------------------------------------------------------------

/** Above a part whose "opens when" rule is not met: what is missing and how to get there. */
export function LockedPartBanner({
  gate,
  className,
  onGoOn,
  goToPart,
}: {
  gate: RecordGate
  className?: string
  onGoOn?: () => void
  /** A way to the part the missing work is in. */
  goToPart?: {
    number: number
    onClick: (event: React.MouseEvent) => void
  } | null
}) {
  return (
    <div
      data-gate={gate.blocking ? 'blocking' : 'closed'}
      data-testid="locked-part"
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-warning-border bg-warning-wash px-3 py-2.5 text-label leading-[18px]',
        className,
      )}
    >
      <Icon name="lock" size={14} className="shrink-0 text-warning-text" />
      <div className="min-w-0 flex-1 basis-[16rem]">
        <span className="font-semibold text-warning-text">
          {t('notebook.gates.locked.title', {
            number: String(gate.partNumber ?? ''),
          })}
        </span>{' '}
        <span className="text-fg">
          {t('notebook.gates.locked.body', {
            missing: gate.missing.join('; '),
          })}
        </span>
        <span className="mt-0.5 block text-fg-muted">
          {gate.mode === 'block'
            ? t('notebook.gates.locked.blockedBody')
            : t('notebook.gates.locked.preview')}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {goToPart ? (
          <Button onClick={goToPart.onClick}>
            {t('notebook.gates.locked.goTo', {
              number: String(goToPart.number),
            })}
          </Button>
        ) : null}
        {onGoOn ? (
          <Button onClick={onGoOn}>{t('notebook.gates.locked.goOn')}</Button>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review: the gates gone past
// ---------------------------------------------------------------------------

/** Where work went on without a gate being open, and why. Shown to the reviewer. */
export function GateOverridesPanel({ recordId }: { recordId: string }) {
  const overrides = useQuery({
    queryKey: gateQueryKeys.overrides(recordId),
    queryFn: () => fetchGateOverrides(notebookDataClient, recordId),
  })
  const rows = overrides.data ?? []
  const names = useUserNames(
    rows
      .map((row) => row.createdByUserId)
      .filter((id): id is string => Boolean(id)),
  )
  const nameOf = (userId: string | null) =>
    userId ? names.userLabel(userId) : ''
  if (rows.length === 0) return null
  return (
    <section
      data-testid="gate-overrides"
      className="rounded-lg border border-warning-border bg-warning-wash/40 p-4"
    >
      <h3 className="text-body font-semibold text-fg">
        {t('notebook.gates.review.title')}
      </h3>
      <p className="mb-3 text-label text-fg-muted">
        {t('notebook.gates.review.description')}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="text-label">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-fg">{row.label}</span>
              <span className="rounded-sm bg-warning-wash px-1.5 py-0.5 text-caption text-warning-text">
                {t('notebook.gates.review.deviation')}
              </span>
              <span className="text-fg-muted">
                {t('notebook.gates.review.who')} {nameOf(row.createdByUserId)} ·{' '}
                {new Date(row.createdAt).toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </div>
            {row.missing.length > 0 ? (
              <p className="text-fg-muted">
                {t('notebook.gates.review.missing')}: {row.missing.join('; ')}
              </p>
            ) : null}
            <p className="text-fg">
              {t('notebook.gates.review.reason')}: {row.reason}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The queries a change to a gate touches. */
export function useRefreshGates(recordId: string) {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: gateQueryKeys.forRecord(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: ['notebook', 'parts', recordId],
      }),
    ])
  }, [queryClient, recordId])
}

export { evaluateGateCondition }
