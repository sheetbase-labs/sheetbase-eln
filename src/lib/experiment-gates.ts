/**
 * Gates between the parts of an experiment (see the experiment_gates migration).
 *
 * A gate holds back the rest of a page, or a whole part, until earlier work is
 * done. It is a `gate` block (everything after it in the same part sits behind
 * it) or an "opens when" rule on a part. Its conditions are all checked by the
 * database (`api.record_gates`), which also says what is still missing in
 * words. `evaluateGateConditions` is a mirror of that check for the page, so a
 * tick or a filled cell answers at once, like `step-status.ts`. It knows the
 * tables and steps and parts the page has loaded; a sheet, the linked samples
 * and the record's own fields it leaves to the database's last answer. Keep the
 * wording in step with `internal.eval_gate_conditions`.
 *
 * A gate set to warn lets people go on with a reason (`overrideGate`); a gate
 * set to block refuses the writes below it in the database. A date condition
 * only ever warns.
 */
import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import type { NotebookBlock } from './notebook-data'

export type GateMode = 'warn' | 'block'

export type GateCondition =
  | {
      kind: 'table_filled'
      blockId: string
      /** Every row has a value in this column. */
      column?: string
      /** At least this many rows (with a value in the column, when one is named). */
      minRows?: number
      /** What the table is called, kept so the words stay right if the heading changes. */
      label?: string
    }
  | { kind: 'step_done'; blockId: string }
  | { kind: 'part_done'; partId: string }
  | { kind: 'samples_linked'; min?: number }
  | { kind: 'field_set'; field: string; label?: string }
  | { kind: 'date_reached'; date: string }
  /** No tracked quality control series (or the one named) has a breach nobody has looked at. */
  | { kind: 'qc_in_control'; seriesId?: string; label?: string }
  /**
   * A plugin has nothing open on the experiment: no hold, and no sign-off step it
   * asked for that is still waiting. Set through the lab API; the database decides.
   */
  | {
      kind: 'plugin_flag'
      extensionKey: string
      flagKey?: string
      /** What the plugin's step is called, kept so the words stay right. */
      label?: string
    }
  /**
   * A plugin check on a table passes. The check runs in the app over the table
   * as it is, and the answer counts only while the table stays as it was.
   */
  | {
      kind: 'plugin_check'
      blockId: string
      extensionKey: string
      checkId: string
      /** The check's input names mapped to the table columns they read. */
      columns: Record<string, string>
      label?: string
    }

export type GateConditionKind = GateCondition['kind']

const gateConditionKindSchema = z.enum([
  'table_filled',
  'step_done',
  'part_done',
  'samples_linked',
  'field_set',
  'date_reached',
  'qc_in_control',
  'plugin_check',
  'plugin_flag',
])

export const GATE_CONDITION_KINDS: readonly GateConditionKind[] =
  gateConditionKindSchema.options

export const MAX_GATE_CONDITIONS = 12

/** The payload of a `gate` block. */
export interface GatePayload {
  label?: string
  mode: GateMode
  conditions: GateCondition[]
  /** The gate came from a template or a protocol and stays on the experiment. */
  fromTemplate?: boolean
  /** In a template: the gate is not armed until an experiment is made from it. */
  pending?: boolean
}

/** One condition as the database checked it. */
export interface GateConditionStatus {
  kind: GateConditionKind
  met: boolean
  /** A date: it warns but never blocks. */
  soft: boolean
  /** What is missing, in words; empty once met. */
  text: string
  blockId?: string
  partId?: string
}

export interface RecordGate {
  /** `block:<id>` or `part:<id>`. */
  gateId: string
  kind: 'block' | 'part'
  blockId: string | null
  partId: string | null
  partNumber: number | null
  label: string
  mode: GateMode
  met: boolean
  /** Holds work back now: unmet, set to block, and not a date alone. */
  blocking: boolean
  overridden: boolean
  overriddenAt: string | null
  overriddenByUserId: string | null
  overrideReason: string | null
  missing: string[]
  conditions: GateConditionStatus[]
  fromTemplate: boolean
}

interface RecordGateWire {
  gate_id: string
  gate_kind: 'block' | 'part'
  block_id: string | null
  part_id: string | null
  part_number: number | null
  label: string
  mode: GateMode
  met: boolean
  blocking: boolean
  overridden: boolean
  overridden_at: string | null
  overridden_by_user_id: string | null
  override_reason: string | null
  missing?: string[] | null
  conditions?: Array<Partial<GateConditionStatus>> | null
  from_template: boolean
}

export const gateQueryKeys = {
  forRecord: (recordId: string) => ['notebook', 'gates', recordId] as const,
  overrides: (recordId: string) =>
    ['notebook', 'gates', recordId, 'overrides'] as const,
}

export function toRecordGate(row: RecordGateWire): RecordGate {
  return {
    gateId: row.gate_id,
    kind: row.gate_kind,
    blockId: row.block_id,
    partId: row.part_id,
    partNumber: row.part_number,
    label: row.label,
    mode: row.mode,
    met: row.met,
    blocking: row.blocking,
    overridden: row.overridden,
    overriddenAt: row.overridden_at,
    overriddenByUserId: row.overridden_by_user_id,
    overrideReason: row.override_reason,
    missing: row.missing ?? [],
    conditions: (row.conditions ?? []).map((condition) => {
      const status: GateConditionStatus = {
        kind: gateConditionKindSchema.parse(condition.kind),
        met: condition.met === true,
        soft: condition.soft === true,
        text: condition.text ?? '',
      }

      if (condition.blockId) status.blockId = condition.blockId

      if (condition.partId) status.partId = condition.partId

      return status
    }),
    fromTemplate: row.from_template,
  }
}

/** Every gate of an experiment in page order, as the database sees them now. */
export function fetchRecordGates(
  client: DataClient,
  recordId: string,
): Promise<RecordGate[]> {
  return client
    .rpc<RecordGateWire[]>('record_gates', { p_record_id: recordId })
    .then((rows) => rows.map(toRecordGate))
}

export interface PartGateInput {
  /** Null (or empty) takes the rule off the part. */
  conditions?: GateCondition[] | null
  mode?: GateMode
  stepsInOrder?: boolean
}

/** Set, change or clear the rule that opens a part, and the order of its steps. */
export async function setPartGate(
  client: DataClient,
  partId: string,
  input: PartGateInput,
): Promise<void> {
  await client.rpc('set_part_gate', {
    p_part_id: partId,
    p_conditions: input.conditions?.length ? input.conditions : null,
    p_gate_mode: input.mode ?? null,
    p_steps_in_order: input.stepsInOrder ?? null,
  })
}

export const GATE_REASON_MAX = 2000

/** The trimmed reason, or null when it is empty or too long. */
export function normaliseGateReason(value: string): string | null {
  const reason = value.trim()

  return reason.length >= 1 && reason.length <= GATE_REASON_MAX ? reason : null
}

/** Go on past a gate that warns. Name the gate block or the part. */
export async function overrideGate(
  client: DataClient,
  target: { blockId: string } | { partId: string },
  reason: string,
): Promise<void> {
  const clean = normaliseGateReason(reason)

  if (!clean) throw new Error('Say why you are going on.')

  await client.rpc('override_gate', {
    p_gate_block_id: 'blockId' in target ? target.blockId : null,
    p_gate_part_id: 'partId' in target ? target.partId : null,
    p_reason: clean,
  })
}

/** A person's override of a gate, as stored. */
export interface GateOverride {
  id: string
  recordId: string
  blockId: string | null
  partId: string | null
  label: string
  missing: string[]
  reason: string
  createdAt: string
  createdByUserId: string | null
}

interface GateOverrideWire {
  id: string
  record_id: string
  block_id: string | null
  part_id: string | null
  label: string
  missing: string[] | null
  reason: string
  created_at: string
  created_by_user_id: string | null
}

export function fetchGateOverrides(
  client: DataClient,
  recordId: string,
): Promise<GateOverride[]> {
  return client
    .list<GateOverrideWire>(
      'gate_overrides',
      `?record_id=eq.${recordId}&order=created_at.asc,id.asc`,
    )
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        recordId: row.record_id,
        blockId: row.block_id,
        partId: row.part_id,
        label: row.label,
        missing: row.missing ?? [],
        reason: row.reason,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
      })),
    )
}

// ---------------------------------------------------------------------------
// The page's own check
// ---------------------------------------------------------------------------

export interface GateBlockLike {
  id: string
  type: string
  partId?: string | null
  order: number
  /** The block's own JSONB payload, decoded where a condition reads it. */
  payload: NotebookBlock['payload']
}

export interface GatePartLike {
  id: string
  number: number
  title: string
  state: 'done' | 'now' | 'later'
  sourcePartId?: string | null
}

export interface GateContext {
  blocks: readonly GateBlockLike[]
  parts: readonly GatePartLike[]
}

/** A condition checked on the page: `known` is false when only the database can say. */
export interface MirroredCondition {
  known: boolean
  met: boolean
  soft: boolean
  text: string
}

function isBlank(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true

  return value.trim() === ''
}

/** "P3", "P3 and P4", "P3, P4 and P5", "P3, P4, P5 and 2 more". */
export function nameList(names: readonly string[]): string {
  if (names.length === 0) return ''

  if (names.length === 1) return names[0]

  if (names.length <= 3)
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

const unknown: MirroredCondition = {
  known: false,
  met: false,
  soft: false,
  text: '',
}

/** A table block's payload as a gate reads it: heading text and the cell grid. */
const gateTableSchema = z.object({
  title: z.string().optional().catch(undefined),
  columns: z.array(z.coerce.string()).catch([]),
  rows: z.array(z.unknown()).catch([]),
})

const gateRowSchema = z.array(z.coerce.string().nullish())

type GateRow = z.infer<typeof gateRowSchema>

function tableCondition(
  condition: Extract<GateCondition, { kind: 'table_filled' }>,
  ctx: GateContext,
): MirroredCondition {
  const block = ctx.blocks.find((b) => b.id === condition.blockId)

  if (!block || (block.type !== 'table' && block.type !== 'sheet')) {
    return {
      known: true,
      met: false,
      soft: false,
      text: 'A table this gate waits on has been removed',
    }
  }

  // The cells of a sheet live in its own instance, which the page reads
  // elsewhere: leave it to the database.
  if (block.type === 'sheet') return unknown

  const table = gateTableSchema.parse(block.payload)
  const label = condition.label?.trim() || table.title?.trim() || 'The table'
  const column = condition.column?.trim() || null
  const min = condition.minRows ?? 0
  const columns = table.columns

  const rows = table.rows.flatMap((row) => {
    const parsed = gateRowSchema.safeParse(row)

    return parsed.success ? [parsed.data] : []
  })

  const index = column
    ? columns.findIndex((c) => c.trim().toLowerCase() === column.toLowerCase())
    : -1

  const total = rows.length
  const nonEmpty = rows.filter((row) => row.some((cell) => !isBlank(cell)))
  const cellOf = (row: GateRow) => (index >= 0 ? row[index] : undefined)
  const filled = rows.filter((row) => !isBlank(cellOf(row)))

  const missingNames = rows.flatMap((row, i) =>
    isBlank(cellOf(row)) ? [row[0]?.trim() || `Row ${i + 1}`] : [],
  )

  const done = (met: boolean, text: string): MirroredCondition => ({
    known: true,
    met,
    soft: false,
    text: met ? '' : text,
  })

  if (column && index < 0) {
    return done(false, `${label} has no ${column} column`)
  }

  if (column && min > 0) {
    return done(
      filled.length >= min,
      `${label} needs ${plural(min, 'row')} with ${column} (${filled.length} so far)`,
    )
  }

  if (column) {
    if (total === 0) return done(false, `${label} has no rows yet`)

    return done(
      filled.length === total,
      `${nameList(missingNames)} ${missingNames.length === 1 ? 'has' : 'have'} no ${column}`,
    )
  }

  const need = min > 0 ? min : 1

  return done(
    nonEmpty.length >= need,
    `${label} needs at least ${plural(need, 'row')} filled (${nonEmpty.length} so far)`,
  )
}

function stepCondition(
  condition: Extract<GateCondition, { kind: 'step_done' }>,
  ctx: GateContext,
): MirroredCondition {
  const block = ctx.blocks.find(
    (b) =>
      b.type === 'procedure_step' &&
      (b.id === condition.blockId ||
        b.payload.sourceStepBlockId === condition.blockId),
  )

  if (!block) {
    return {
      known: true,
      met: false,
      soft: false,
      text: 'A step this gate waits on has been removed',
    }
  }

  const met = block.payload.completed === true

  if (met) return { known: true, met, soft: false, text: '' }

  const number = ctx.blocks.filter(
    (s) =>
      s.type === 'procedure_step' &&
      (s.partId ?? null) === (block.partId ?? null) &&
      s.order <= block.order,
  ).length

  const text = z.string().catch('').parse(block.payload.text).slice(0, 40)

  return {
    known: true,
    met,
    soft: false,
    text: `Step ${number} (${text}) isn't done`,
  }
}

function partCondition(
  condition: Extract<GateCondition, { kind: 'part_done' }>,
  ctx: GateContext,
): MirroredCondition {
  const part = ctx.parts.find(
    (p) => p.id === condition.partId || p.sourcePartId === condition.partId,
  )

  if (!part) {
    return {
      known: true,
      met: false,
      soft: false,
      text: 'A part this gate waits on has been removed',
    }
  }

  const met = part.state === 'done'

  return {
    known: true,
    met,
    soft: false,
    text: met ? '' : `Part ${part.number} (${part.title}) isn't done`,
  }
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)

  const month = date.toLocaleString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  })

  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}

/** Check one condition against what the page has loaded. */
export function evaluateGateCondition(
  condition: GateCondition,
  ctx: GateContext,
  today: Date = new Date(),
): MirroredCondition {
  switch (condition.kind) {
    case 'table_filled':
      return tableCondition(condition, ctx)
    case 'step_done':
      return stepCondition(condition, ctx)
    case 'part_done':
      return partCondition(condition, ctx)
    case 'date_reached': {
      const todayIso = today.toISOString().slice(0, 10)
      const met = todayIso >= condition.date

      return {
        known: true,
        met,
        soft: true,
        text: met ? '' : `Not before ${formatDate(condition.date)}`,
      }
    }

    default:
      return unknown
  }
}

/** The conditions of a gate as the page can check them (unknown ones marked). */
export function evaluateGateConditions(
  conditions: readonly GateCondition[],
  ctx: GateContext,
  today: Date = new Date(),
): MirroredCondition[] {
  return conditions.map((condition) =>
    evaluateGateCondition(condition, ctx, today),
  )
}

/**
 * A gate as the page shows it: the database's answer, with the conditions the
 * page can check itself replaced by its own (so a tick or a cell answers before
 * the database has been asked again).
 */
export function liveGate(
  gate: RecordGate,
  conditions: readonly GateCondition[] | null,
  ctx: GateContext,
  today: Date = new Date(),
): RecordGate {
  if (!conditions || conditions.length !== gate.conditions.length) return gate
  const mirrored = evaluateGateConditions(conditions, ctx, today)

  const merged: GateConditionStatus[] = gate.conditions.map((server, i) => {
    const mine = mirrored[i]

    return mine.known
      ? { ...server, met: mine.met, soft: mine.soft, text: mine.text }
      : server
  })

  const met = merged.every((c) => c.met)
  const blocking = merged.some((c) => !c.met && !c.soft)

  return {
    ...gate,
    conditions: merged,
    met,
    blocking: !met && blocking && gate.mode === 'block',
    missing: merged.flatMap((c) => (c.met ? [] : [c.text])),
  }
}

/** A gate that is closed and has not been gone past: what sits behind it is held back. */
export function isGateClosed(gate: RecordGate): boolean {
  return !gate.met && !gate.overridden
}

/**
 * The blocks held back, each with the gate that holds it. A block gate holds
 * back what comes after it in its own part (or on the page, with no parts); a
 * part gate holds back the whole part. When two gates hold a block, the first
 * on the page is named.
 */
export function blocksBehindGates(
  blocks: readonly GateBlockLike[],
  gates: readonly RecordGate[],
): Map<string, RecordGate> {
  const held = new Map<string, RecordGate>()
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const closed = gates.filter(isGateClosed)
  const byId = new Map(ordered.map((block) => [block.id, block]))

  for (const gate of closed) {
    if (gate.kind === 'part') {
      for (const block of ordered) {
        if (block.partId === gate.partId && !held.has(block.id)) {
          held.set(block.id, gate)
        }
      }

      continue
    }

    const own = gate.blockId === null ? undefined : byId.get(gate.blockId)

    if (!own) continue

    for (const block of ordered) {
      if (
        block.order > own.order &&
        (block.partId ?? null) === (own.partId ?? null) &&
        block.type !== 'gate' &&
        !held.has(block.id)
      ) {
        held.set(block.id, gate)
      }
    }
  }

  return held
}

/** The step a step waits on when its part is done in order: "after step 2". */
export function stepWaitsOnStep(
  blocks: readonly GateBlockLike[],
  stepsInOrderPartIds: ReadonlySet<string>,
): Map<string, number> {
  const waits = new Map<string, number>()
  const byPart = new Map<string, GateBlockLike[]>()

  for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
    if (block.type !== 'procedure_step' || !block.partId) continue

    if (!stepsInOrderPartIds.has(block.partId)) continue
    byPart.set(block.partId, [...(byPart.get(block.partId) ?? []), block])
  }

  for (const steps of byPart.values()) {
    const firstOpen = steps.findIndex((s) => s.payload.completed !== true)

    if (firstOpen < 0) continue
    steps.forEach((step, index) => {
      if (index > firstOpen && step.payload.completed !== true) {
        waits.set(step.id, firstOpen + 1)
      }
    })
  }

  return waits
}

/** A stored condition names a kind the page mirrors. */
const storedCondition = z.looseObject({ kind: gateConditionKindSchema })

/** The conditions of a gate block's payload, or [] when it has none the page understands. */
export function gateConditionsOf(
  payload: GateBlockLike['payload'],
): GateCondition[] {
  const conditions = z.array(z.unknown()).safeParse(payload.conditions)

  return conditions.success && conditions.data.every(isCondition)
    ? conditions.data
    : []
}

export function gateModeOf(payload: GateBlockLike['payload']): GateMode {
  return payload.mode === 'block' ? 'block' : 'warn'
}

function isCondition(value: z.input<z.ZodUnknown>): value is GateCondition {
  return storedCondition.safeParse(value).success
}

/**
 * The words the database refuses with. The API flattens the error code to a
 * category, so the message is how a refusal from a gate is told from any other.
 */
const REFUSAL_WORDS: ReadonlyArray<
  readonly [RegExp, 'SB150' | 'SB151' | 'SB152']
> = [
  [/^Part \d+ is not open yet/, 'SB150'],
  [/^This is behind a gate/, 'SB150'],
  [/^Steps in this part are done in order/, 'SB151'],
  [/^This gate comes from the template/, 'SB152'],
]

/** The error body the API answers a refused gate write with. */
const gateRefusalBody = z.looseObject({
  code: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
})

/** A refusal a gate wrote, named by the code the API keeps. */
export interface GateRefusal {
  code: 'SB150' | 'SB151' | 'SB152'
  message: string
}

/** Why a write was refused by a gate, when it was. */
export function gateRefusal(error: z.input<z.ZodUnknown>): GateRefusal | null {
  const refusal = gateRefusalBody.safeParse(error)

  if (!refusal.success) return null
  const text = refusal.data.message ?? ''

  if (
    refusal.data.code === 'SB150' ||
    refusal.data.code === 'SB151' ||
    refusal.data.code === 'SB152'
  ) {
    return { code: refusal.data.code, message: text }
  }

  for (const [pattern, known] of REFUSAL_WORDS) {
    if (pattern.test(text)) return { code: known, message: text }
  }

  return null
}
