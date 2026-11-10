import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

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
  fetchGateOverrides,
  gateQueryKeys,
  normaliseGateReason,
  overrideGate,
} from '#/lib/experiment-gates'
import type {
  GateCondition,
  GateContext,
  GateMode,
  RecordGate,
} from '#/lib/experiment-gates'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import { runPluginGateCheck } from '#/lib/extensions/plugin-files'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { fetchQcSeries, qcKeys } from '#/lib/run-qc'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  blockTitle,
  describeConditions,
  FIELD_LABELS,
} from './gate-description'
import type { GateTargets } from './gate-description'

export type { GateTargets } from './gate-description'

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

export function GatesProvider(
  props: React.ComponentProps<typeof GatesContext.Provider>,
) {
  return <GatesContext.Provider {...props} />
}

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

// Decode persisted condition fields before rendering their descriptions. A
// recognized kind alone does not prove that its required fields are present.
const gateConditionSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('table_filled'),
    blockId: z.string(),
    column: z.string().optional(),
    minRows: z.number().optional(),
    label: z.string().optional(),
  }),
  z.looseObject({ kind: z.literal('step_done'), blockId: z.string() }),
  z.looseObject({ kind: z.literal('part_done'), partId: z.string() }),
  z.looseObject({
    kind: z.literal('samples_linked'),
    min: z.number().optional(),
  }),
  z.looseObject({
    kind: z.literal('field_set'),
    field: z.string(),
    label: z.string().optional(),
  }),
  z.looseObject({ kind: z.literal('date_reached'), date: z.string() }),
  z.looseObject({
    kind: z.literal('qc_in_control'),
    seriesId: z.string().optional(),
    label: z.string().optional(),
  }),
  z.looseObject({
    kind: z.literal('plugin_flag'),
    extensionKey: z.string(),
    flagKey: z.string().optional(),
    label: z.string().optional(),
  }),
  z.looseObject({
    kind: z.literal('plugin_check'),
    blockId: z.string(),
    extensionKey: z.string(),
    checkId: z.string(),
    columns: z.record(z.string(), z.string()),
    label: z.string().optional(),
  }),
]) satisfies z.ZodType<GateCondition>

/** A gate block as the page shows it. */
export function GateBlockView({
  blockId,
  payload,
}: {
  blockId?: string
  payload: NotebookBlock['payload']
}) {
  const state = useGates()
  const gate = state?.gates.find((g) => g.blockId === blockId) ?? null

  const conditions = React.useMemo(
    () =>
      Array.isArray(payload.conditions)
        ? z.array(gateConditionSchema).parse(payload.conditions)
        : [],
    [payload.conditions],
  )

  const label =
    z.string().catch('').parse(payload.label).trim() ||
    t('notebook.gates.blockLabel')

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

  return (
    <LiveGateView
      gate={gate}
      state={state}
      label={label}
      conditions={conditions}
      mode={mode}
      fromTemplate={fromTemplate}
    />
  )
}

/** The live evaluation owns actions; historical descriptions never offer them. */
function LiveGateView({
  gate,
  state,
  label,
  conditions,
  mode,
  fromTemplate,
}: {
  gate: RecordGate
  state: GatesState
  label: string
  conditions: GateCondition[]
  mode: GateMode
  fromTemplate: boolean
}) {
  const context = state.context
  const headline = gateHeadline(gate, conditions, context)
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
      <ClosedGateActions
        gate={gate}
        state={state}
        conditions={conditions}
        mode={mode}
        fromTemplate={fromTemplate}
      />
    </div>
  )
}

function ClosedGateActions({
  gate,
  state,
  conditions,
  mode,
  fromTemplate,
}: {
  gate: RecordGate
  state: GatesState
  conditions: GateCondition[]
  mode: GateMode
  fromTemplate: boolean
}) {
  const action = firstAction(gate, conditions, state.context)

  const pluginCheck = gate.conditions.some(
    (status, index) =>
      !status.met && conditions[index]?.kind === 'plugin_check',
  )
    ? conditions.find((condition) => condition.kind === 'plugin_check')
    : undefined

  const canGoOn =
    state.canEdit && mode === 'warn' && !gate.met && !gate.overridden

  const canEdit = state.canEdit && !fromTemplate

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {action ? (
        <Button onClick={() => state.show(action.blockId)}>
          {action.label}
        </Button>
      ) : null}
      {pluginCheck && state.canEdit ? (
        <RunPluginCheckButton
          recordId={state.recordId}
          conditions={conditions}
        />
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
  )
}

/** Runs the plugin checks a gate waits on, then asks the database again. */
function RunPluginCheckButton({
  recordId,
  conditions,
}: {
  recordId: string
  conditions: readonly GateCondition[]
}) {
  const queryClient = useQueryClient()

  const run = useMutation({
    mutationFn: async () => {
      const outcomes: string[] = []

      for (const condition of conditions) {
        if (condition.kind !== 'plugin_check') continue

        // Mappings can share record_gate_check's result key; preserve last-write order and stop at first refusal.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const outcome = await runPluginGateCheck({
          recordId,
          blockId: condition.blockId,
          extensionKey: condition.extensionKey,
          checkId: condition.checkId,
          columns: condition.columns,
        })

        outcomes.push(outcome.status)
      }

      return outcomes
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: gateQueryKeys.forRecord(recordId),
      })
    },
    onError: (error) =>
      toast.error(
        t('notebook.gates.checkFailed', {
          reason: error instanceof Error ? error.message : '',
        }),
      ),
  })

  return (
    <Button disabled={run.isPending} onClick={() => run.mutate()}>
      {run.isPending
        ? t('notebook.gates.checkRunning')
        : t('notebook.gates.runCheck')}
    </Button>
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
  'plugin_check',
  'plugin_flag',
]

/** A first condition of a kind, pointed at something that exists when it can be. */
function blankCondition(kind: Kind, targets: GateTargets): GateCondition {
  switch (kind) {
    case 'table_filled': {
      const table = targets.tables.at(-1)

      const condition: Extract<GateCondition, { kind: 'table_filled' }> = {
        kind,
        blockId: table?.id ?? '',
        ...((table?.columns[1] ?? table?.columns[0])
          ? { column: table.columns[1] ?? table.columns[0] }
          : { minRows: 1 }),
      }

      if (table) condition.label = table.label

      return condition
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
    case 'plugin_flag':
      return { kind, extensionKey: '' }
    case 'plugin_check':
      return {
        kind,
        blockId: targets.tables.at(-1)?.id ?? '',
        extensionKey: '',
        checkId: '',
        columns: {},
      }
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
    case 'plugin_flag':
      return Boolean(condition.extensionKey)
    case 'plugin_check':
      return Boolean(
        condition.blockId && condition.extensionKey && condition.checkId,
      )
  }
}

const ROWS_OPTION = '__rows__'

/** The plugins that have save hooks, once each: the ones that can raise a hold or a sign-off. */
function pluginsOf(
  hooks: ReadonlyArray<{ extensionKey: string; extensionName: string }>,
): Array<{ key: string; name: string }> {
  const seen = new Map<string, string>()

  for (const hook of hooks)
    if (!seen.has(hook.extensionKey))
      seen.set(hook.extensionKey, hook.extensionName)

  return [...seen].map(([key, name]) => ({ key, name }))
}

/** Which plugin's holds and sign-off steps a gate waits on (all of that plugin's). */
function PluginFlagPicker({
  condition,
  onChange,
}: {
  condition: Extract<GateCondition, { kind: 'plugin_flag' }>
  onChange: (next: GateCondition) => void
}) {
  const plugins = pluginsOf(useExtensionPoints().data['record-hooks'])
  const active = plugins.find((p) => p.key === condition.extensionKey)

  return (
    <>
      <Select
        aria-label={t('notebook.gates.dialog.pluginFlagLabel')}
        value={active?.key ?? ''}
        className="w-auto min-w-48"
        onChange={(event) => {
          const next = plugins.find((p) => p.key === event.target.value)

          if (next)
            onChange({
              kind: 'plugin_flag',
              extensionKey: next.key,
              label: next.name,
            })
        }}
      >
        <option value="" disabled>
          {t('notebook.gates.dialog.pickPluginFlag')}
        </option>
        {plugins.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </Select>
    </>
  )
}

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

/**
 * Which plugin check a gate waits on, which table it looks at, and which table
 * column feeds each thing the check reads. The first check and the columns that
 * share a name with its inputs are filled in so a common case is one click.
 */
function PluginCheckPicker({
  condition,
  targets,
  onChange,
}: {
  condition: Extract<GateCondition, { kind: 'plugin_check' }>
  targets: GateTargets
  onChange: (next: GateCondition) => void
}) {
  const points = useExtensionPoints()
  const checks = points.data.checks
  const table = targets.tables.find((tbl) => tbl.id === condition.blockId)

  const active = checks.find(
    (item) =>
      item.extensionKey === condition.extensionKey &&
      item.id === condition.checkId,
  )

  return (
    <>
      <Select
        aria-label={t('notebook.gates.dialog.pluginCheckLabel')}
        value={active ? `${active.extensionKey}/${active.id}` : ''}
        className="w-auto min-w-48"
        onChange={(event) => {
          const next = checks.find(
            (item) => `${item.extensionKey}/${item.id}` === event.target.value,
          )

          if (next) onChange(bindPluginCheck(next, condition.blockId, targets))
        }}
      >
        <option value="" disabled>
          {t('notebook.gates.dialog.pickPluginCheck')}
        </option>
        {checks.map((item) => (
          <option
            key={`${item.extensionKey}/${item.id}`}
            value={`${item.extensionKey}/${item.id}`}
          >
            {item.declaration.title}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('notebook.gates.dialog.tableLabel')}
        value={condition.blockId}
        className="w-auto min-w-40"
        onChange={(event) =>
          active
            ? onChange(bindPluginCheck(active, event.target.value, targets))
            : onChange({ ...condition, blockId: event.target.value })
        }
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
      {active?.declaration.inputs.map((input) => (
        <label key={input.name} className="flex items-center gap-1.5">
          <span className="text-label text-fg-muted">{input.label}</span>
          <Select
            aria-label={input.label}
            value={condition.columns[input.name] ?? ''}
            className="w-auto min-w-32"
            onChange={(event) =>
              onChange({
                ...condition,
                columns: {
                  ...condition.columns,
                  [input.name]: event.target.value,
                },
              })
            }
          >
            <option value="">{t('notebook.gates.dialog.pickColumn')}</option>
            {(table?.columns ?? []).map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </Select>
        </label>
      ))}
    </>
  )
}

function bindPluginCheck(
  check: ReturnType<typeof useExtensionPoints>['data']['checks'][number],
  tableId: string,
  targets: GateTargets,
): GateCondition {
  const columns = targets.tables.find((table) => table.id === tableId)?.columns
  const mapped: Record<string, string> = {}

  for (const input of check.declaration.inputs) {
    const match = columns?.find(
      (column) =>
        column.trim().toLowerCase() === input.label.trim().toLowerCase() ||
        column.trim().toLowerCase() === input.name.toLowerCase(),
    )

    if (match) mapped[input.name] = match
  }

  return {
    kind: 'plugin_check',
    blockId: tableId,
    extensionKey: check.extensionKey,
    checkId: check.id,
    label: check.declaration.title,
    columns: mapped,
  }
}

/** Defaults belong to the dialog draft, including when plugin metadata arrives later. */
function withPluginDefaults(
  condition: GateCondition,
  targets: GateTargets,
  points: ReturnType<typeof useExtensionPoints>['data'],
): GateCondition {
  if (condition.kind === 'plugin_check' && !condition.checkId) {
    const first = points.checks.at(0)

    if (first) return bindPluginCheck(first, condition.blockId, targets)
  }

  if (condition.kind === 'plugin_flag' && !condition.extensionKey) {
    const first = pluginsOf(points['record-hooks']).at(0)

    if (first)
      return { kind: 'plugin_flag', extensionKey: first.key, label: first.name }
  }

  return condition
}

function TableFilledCondition({
  condition,
  targets,
  onChange,
}: {
  condition: Extract<GateCondition, { kind: 'table_filled' }>
  targets: GateTargets
  onChange: (next: GateCondition) => void
}) {
  const table = targets.tables.find((tbl) => tbl.id === condition.blockId)

  return (
    <>
      <Select
        aria-label={t('notebook.gates.dialog.tableLabel')}
        value={condition.blockId}
        className="w-auto min-w-40"
        onChange={(event) => {
          const next = targets.tables.find(
            (tbl) => tbl.id === event.target.value,
          )

          const nextCondition: Extract<
            GateCondition,
            { kind: 'table_filled' }
          > = {
            kind: 'table_filled',
            blockId: event.target.value,
            ...((next?.columns[1] ?? next?.columns[0])
              ? { column: next.columns[1] ?? next.columns[0] }
              : { minRows: 1 }),
          }

          if (next) nextCondition.label = next.label
          onChange(nextCondition)
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
          onChange={(event) => {
            const kind = kinds.find((value) => value === event.target.value)

            if (kind) onChange(blankCondition(kind, targets))
          }}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {t(`notebook.gates.dialog.kind.${kind}`)}
            </option>
          ))}
        </Select>
        {condition.kind === 'table_filled' ? (
          <TableFilledCondition
            condition={condition}
            targets={targets}
            onChange={onChange}
          />
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
                label: FIELD_LABELS.get(event.target.value)?.(),
              })
            }
          >
            {Array.from(FIELD_LABELS, ([field, label]) => (
              <option key={field} value={field}>
                {label()}
              </option>
            ))}
          </Select>
        ) : null}
        {condition.kind === 'qc_in_control' ? (
          <QcSeriesSelect condition={condition} onChange={onChange} />
        ) : null}
        {condition.kind === 'plugin_flag' ? (
          <PluginFlagPicker condition={condition} onChange={onChange} />
        ) : null}
        {condition.kind === 'plugin_check' ? (
          <PluginCheckPicker
            condition={condition}
            targets={targets}
            onChange={onChange}
          />
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
interface GateDialogProps {
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
}

/** Own the editable conditions and their plugin defaults for this dialog session. */
function useGateDraft({
  part,
  initial,
  targets,
  kinds = ALL_KINDS,
  named = true,
}: Pick<GateDialogProps, 'part' | 'initial' | 'targets' | 'kinds' | 'named'>) {
  const points = useExtensionPoints().data
  const pluginChecks = points.checks
  const pluginsWithHooks = pluginsOf(points['record-hooks'])

  const usable = kinds.filter((kind) => {
    if (kind === 'plugin_check')
      return targets.tables.length > 0 && pluginChecks.length > 0

    if (kind === 'plugin_flag') return pluginsWithHooks.length > 0

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

  const dialogId = React.useId()

  const [conditionRows, setConditionRows] = React.useState(() => {
    const conditions = initial?.conditions?.length
      ? [...initial.conditions]
      : usable[0]
        ? [blankCondition(usable[0], targets)]
        : []

    return conditions.map((condition, index) => ({
      key: `${dialogId}-${index}`,
      condition,
    }))
  })

  const resolvedRows = conditionRows.map((row) => ({
    ...row,
    condition: withPluginDefaults(row.condition, targets, points),
  }))

  // Adopt a newly available default in this draft before committing children.
  // Later metadata refreshes must not silently replace that chosen plugin.
  if (
    resolvedRows.some(
      (row, index) => row.condition !== conditionRows[index]?.condition,
    )
  )
    setConditionRows(resolvedRows)

  const conditions = resolvedRows.map((row) => row.condition)

  const complete =
    conditions.length > 0 && conditions.every(conditionIsComplete)

  const onlyDates = conditions.every((c) => c.kind === 'date_reached')

  const ready =
    (complete ||
      (conditions.length === 0 && stepsInOrder && part !== undefined)) &&
    (!named || true)

  return {
    label,
    setLabel,
    mode,
    setMode,
    stepsInOrder,
    setStepsInOrder,
    usable,
    resolvedRows,
    setConditionRows,
    conditions,
    complete,
    onlyDates,
    ready,
  }
}

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
}: GateDialogProps) {
  const {
    label,
    setLabel,
    mode,
    setMode,
    stepsInOrder,
    setStepsInOrder,
    usable,
    resolvedRows,
    setConditionRows,
    conditions,
    complete,
    onlyDates,
    ready,
  } = useGateDraft({ part, initial, targets, kinds, named })

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
              {resolvedRows.map(({ condition, key }, index) => (
                <ConditionRow
                  key={key}
                  lead={
                    index === 0
                      ? t('notebook.gates.dialog.conditionsLabel')
                      : t('notebook.gates.dialog.and')
                  }
                  condition={condition}
                  targets={targets}
                  kinds={usable}
                  onChange={(next) =>
                    setConditionRows((all) =>
                      all.map((row) =>
                        row.key === key ? { ...row, condition: next } : row,
                      ),
                    )
                  }
                  onRemove={() =>
                    setConditionRows((all) =>
                      all.filter((row) => row.key !== key),
                    )
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
                  onClick={() => {
                    const key = crypto.randomUUID()
                    setConditionRows((all) => [
                      ...all,
                      { key, condition: blankCondition(usable[0], targets) },
                    ])
                  }}
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
                onValueChange={(value) =>
                  setMode(z.enum(['warn', 'block']).parse(value))
                }
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
  const timeZone = useDisplayTimeZone()

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
                  timeZone,
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
