/**
 * Parts of an experiment (see the experiment_parts migration): one notebook split over days, each
 * part its own page.
 *
 * An experiment with no parts is a single page, as ever. Once it has parts every
 * block belongs to one, parts run in order, and each carries the day it falls on
 * (days from the start of the experiment) and who does it. A part is done when
 * all its steps are, or by hand when it has none; the current part is the first
 * that is not done. The database computes the same thing for the API, the
 * assistant and pipelines (`api.record_parts`, `api.record_steps`); keep the two
 * in step.
 */
import type { DataClient } from '#/lib/data-client'
import type { GateCondition, GateMode } from '#/lib/experiment-gates'
import { notebookOutline } from '#/lib/notebook-outline'
import type { NotebookBlock } from '#/lib/notebook-data'

export interface ExperimentPartWire {
  id: string
  workspace_id: string
  record_id: string
  position: number
  title: string
  day_offset: number
  assignee_user_id: string | null
  opened_at: string | null
  completed_at: string | null
  completed_by_user_id: string | null
  source_part_id?: string | null
  opens_when?: GateCondition[] | null
  gate_mode?: GateMode
  steps_in_order?: boolean
  gate_from_template?: boolean
  requires_sign_off: boolean
  signed_off_at: string | null
  signed_off_by_user_id: string | null
  signoff_id: string | null
}

export interface ExperimentPart {
  id: string
  recordId: string
  position: number
  title: string
  /** Days from the start of the experiment. */
  dayOffset: number
  assigneeUserId: string | null
  openedAt: string | null
  completedAt: string | null
  completedByUserId: string | null
  /** The part of a template or protocol this one was made from. */
  sourcePartId?: string | null
  /** The rule that opens the part (see experiment-gates.ts), if it has one. */
  opensWhen?: GateCondition[] | null
  gateMode?: GateMode
  /** The steps of the part are done in order. */
  stepsInOrder?: boolean
  /** The rule came from a template or protocol and stays on the experiment. */
  gateFromTemplate?: boolean
  /** The part needs a signature before the next one opens. */
  requiresSignOff: boolean
  signedOffAt: string | null
  signedOffByUserId: string | null
  signoffId: string | null
}

export type PartState = 'done' | 'now' | 'later'

export interface PartProgress extends ExperimentPart {
  /** Position among the parts, from 1. This is the number in the part's URL. */
  number: number
  state: PartState
  stepCount: number
  stepsDone: number
  blockCount: number
  /** Its work is done and it only waits for a signature. */
  awaitingSignOff: boolean
  /** Signed: frozen until amended. */
  signed: boolean
}

export interface PartBlockLike {
  id: string
  type?: string
  partId?: string | null
  payload: NotebookBlock['payload']
}

export const partQueryKeys = {
  forRecord: (recordId: string) => ['notebook', 'parts', recordId] as const,
  summary: (recordId: string) =>
    ['notebook', 'parts', recordId, 'summary'] as const,
  inRange: (from: string, to: string) =>
    ['notebook', 'parts', 'range', from, to] as const,
}

/** One row of `api.record_parts`: a part with its date, who finished it and what it holds. */
export interface PartSummary {
  partId: string
  number: number
  title: string
  dayOffset: number
  dueOn: string | null
  assigneeUserId: string | null
  status: PartState
  completedAt: string | null
  completedByUserId: string | null
  stepCount: number
  stepsDone: number
  blockCount: number
  resultCount: number
}

interface PartSummaryWire {
  part_id: string
  part_number: number
  title: string
  day_offset: number
  due_on: string | null
  assignee_user_id: string | null
  status: PartState
  completed_at: string | null
  completed_by_user_id: string | null
  step_count: number
  steps_done: number
  block_count: number
  result_count: number
}

/** A part falling in a range of days, with the experiment it belongs to. */
export interface DuePart {
  partId: string
  recordId: string
  identifier: string
  recordTitle: string
  number: number
  title: string
  dueOn: string
  assigneeUserId: string | null
  status: PartState
}

interface DuePartWire {
  part_id: string
  record_id: string
  identifier: string
  record_title: string
  part_number: number
  title: string
  due_on: string
  assignee_user_id: string | null
  status: PartState
}

/** The parts of running experiments whose day is from `from` up to, not including, `to` (YYYY-MM-DD). */
export function fetchPartsInRange(
  client: DataClient,
  from: string,
  to: string,
): Promise<DuePart[]> {
  return client
    .rpc<DuePartWire[]>('parts_in_range', { p_from: from, p_to: to })
    .then((rows) =>
      rows.map((row) => ({
        partId: row.part_id,
        recordId: row.record_id,
        identifier: row.identifier,
        recordTitle: row.record_title,
        number: row.part_number,
        title: row.title,
        dueOn: row.due_on,
        assigneeUserId: row.assignee_user_id,
        status: row.status,
      })),
    )
}

export function fetchPartSummary(
  client: DataClient,
  recordId: string,
): Promise<PartSummary[]> {
  return client
    .rpc<PartSummaryWire[]>('record_parts', { p_record_id: recordId })
    .then((rows) =>
      rows.map((row) => ({
        partId: row.part_id,
        number: row.part_number,
        title: row.title,
        dayOffset: row.day_offset,
        dueOn: row.due_on,
        assigneeUserId: row.assignee_user_id,
        status: row.status,
        completedAt: row.completed_at,
        completedByUserId: row.completed_by_user_id,
        stepCount: row.step_count,
        stepsDone: row.steps_done,
        blockCount: row.block_count,
        resultCount: row.result_count,
      })),
    )
}

export function toExperimentPart(row: ExperimentPartWire): ExperimentPart {
  return {
    id: row.id,
    recordId: row.record_id,
    position: row.position,
    title: row.title,
    dayOffset: row.day_offset,
    assigneeUserId: row.assignee_user_id,
    openedAt: row.opened_at,
    completedAt: row.completed_at,
    completedByUserId: row.completed_by_user_id,
    sourcePartId: row.source_part_id ?? null,
    opensWhen: row.opens_when ?? null,
    gateMode: row.gate_mode ?? 'warn',
    stepsInOrder: row.steps_in_order ?? false,
    gateFromTemplate: row.gate_from_template ?? false,
    requiresSignOff: row.requires_sign_off,
    signedOffAt: row.signed_off_at ?? null,
    signedOffByUserId: row.signed_off_by_user_id ?? null,
    signoffId: row.signoff_id ?? null,
  }
}

export function fetchPartsForRecord(
  client: DataClient,
  recordId: string,
): Promise<ExperimentPart[]> {
  return client
    .list<ExperimentPartWire>(
      'experiment_parts',
      `?record_id=eq.${recordId}&order=position.asc,id.asc`,
    )
    .then((rows) => rows.map(toExperimentPart))
}

/**
 * The parts in order with where each stands. Steps decide whether a part with
 * steps is done (live from the blocks, so the page answers a tick at once); a
 * part without steps is done when it was marked so. A part that needs a
 * signature is finished only when it is signed: until then it stays the part
 * to work on, and the next one waits.
 */
export function partsProgress(
  parts: readonly ExperimentPart[],
  blocks: readonly PartBlockLike[],
): PartProgress[] {
  const ordered = [...parts].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  )

  const byPart = new Map<
    string,
    { steps: number; done: number; blocks: number }
  >()

  for (const block of blocks) {
    if (!block.partId) continue
    const entry = byPart.get(block.partId) ?? { steps: 0, done: 0, blocks: 0 }
    entry.blocks += 1

    if (block.type === 'procedure_step') {
      entry.steps += 1

      if (block.payload.completed === true) entry.done += 1
    }

    byPart.set(block.partId, entry)
  }

  let currentTaken = false

  return ordered.map((part, index) => {
    const counts = byPart.get(part.id) ?? { steps: 0, done: 0, blocks: 0 }

    const workDone =
      counts.steps > 0 ? counts.done === counts.steps : part.completedAt != null

    const signed = part.signedOffAt != null
    const done = workDone && (!part.requiresSignOff || signed)

    const state: PartState = done
      ? 'done'
      : !currentTaken
        ? ((currentTaken = true), 'now')
        : 'later'

    return {
      ...part,
      number: index + 1,
      state,
      stepCount: counts.steps,
      stepsDone: counts.done,
      blockCount: counts.blocks,
      awaitingSignOff: workDone && part.requiresSignOff && !signed,
      signed,
    }
  })
}

/** The part to work on, or null when there are none or all are done. */
export function currentPart(
  parts: readonly PartProgress[],
): PartProgress | null {
  return parts.find((part) => part.state === 'now') ?? null
}

/** The part the page shows: the one in the URL, else the current one, else the last. */
export function shownPart(
  parts: readonly PartProgress[],
  requestedNumber: number | null,
): PartProgress | null {
  if (parts.length === 0) return null

  if (requestedNumber != null) {
    const asked = parts.find((part) => part.number === requestedNumber)

    if (asked) return asked
  }

  return currentPart(parts) ?? parts[parts.length - 1]
}

/** The blocks of one part, in page order. */
export function blocksOfPart<T extends { partId?: string | null }>(
  blocks: readonly T[],
  part: Pick<ExperimentPart, 'id'> | null,
): T[] {
  if (!part) return [...blocks]

  return blocks.filter((block) => block.partId === part.id)
}

/** A part number from a URL segment, or null when it is not one. */
export function partNumberFromParam(param: string | undefined): number | null {
  if (!param || !/^[0-9]{1,3}$/.test(param)) return null
  const value = Number(param)

  return value >= 1 ? value : null
}

const DAY_MS = 86_400_000

/** The calendar date a part falls on: the day the experiment started plus its offset. */
export function partDate(startedAt: string, dayOffset: number): Date {
  const start = new Date(startedAt)

  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + dayOffset,
    ),
  )
}

/** Whole days from the day the experiment started to `now`, from 0. */
export function daysSinceStart(
  startedAt: string,
  now: Date = new Date(),
): number {
  const start = new Date(startedAt)

  const from = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  )

  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return Math.max(0, Math.round((to - from) / DAY_MS))
}

/** The last day of the experiment: its latest part, or null with no parts. */
export function lastDayOffset(parts: readonly ExperimentPart[]): number | null {
  if (parts.length === 0) return null

  return Math.max(...parts.map((part) => part.dayOffset))
}

/** Whether a part's day has passed while it is not done. Its own day is not late. */
export function partIsLate(
  part: Pick<PartProgress, 'state' | 'dayOffset'>,
  startedAt: string,
  now: Date = new Date(),
): boolean {
  return (
    part.state !== 'done' && daysSinceStart(startedAt, now) > part.dayOffset
  )
}

/** Whether a part's day is today (or has passed) while it is not done. */
export function partIsDue(
  part: PartProgress,
  startedAt: string,
  now: Date = new Date(),
): boolean {
  return (
    part.state !== 'done' && daysSinceStart(startedAt, now) >= part.dayOffset
  )
}

export interface SplitPoint {
  title: string
  firstBlockId: string
}

/**
 * Where an unsplit notebook would divide into parts: at each block holding a
 * level-2 heading, titled by that heading. Blocks before the first heading join
 * the first part.
 */
export function splitPointsAtHeadings(
  blocks: ReadonlyArray<{
    id: string
    type: string
    order: number
    payload: NotebookBlock['payload']
  }>,
): SplitPoint[] {
  const seen = new Set<string>()
  const points: SplitPoint[] = []

  for (const entry of notebookOutline(blocks)) {
    if (entry.level !== 2 || seen.has(entry.blockId)) continue
    seen.add(entry.blockId)
    points.push({
      title: entry.text.slice(0, 200),
      firstBlockId: entry.blockId,
    })
  }

  return points
}

// ---------------------------------------------------------------------------
// Writes: each is one database function (see the experiment_parts migration).
// ---------------------------------------------------------------------------

export function createExperimentPart(
  client: DataClient,
  input: {
    recordId: string
    title: string
    dayOffset?: number | null
    afterPartId?: string | null
  },
) {
  return client.rpc<ExperimentPartWire>('create_experiment_part', {
    p_record_id: input.recordId,
    p_title: input.title,
    p_day_offset: input.dayOffset ?? null,
    p_after_part_id: input.afterPartId ?? null,
  })
}

export function updateExperimentPart(
  client: DataClient,
  input: {
    partId: string
    title?: string
    dayOffset?: number
    assigneeUserId?: string | null
  },
) {
  return client.rpc<ExperimentPartWire>('update_experiment_part', {
    p_part_id: input.partId,
    p_title: input.title ?? null,
    p_day_offset: input.dayOffset ?? null,
    p_assignee_user_id: input.assigneeUserId ?? null,
    p_clear_assignee: input.assigneeUserId === null,
  })
}

export function moveExperimentPart(
  client: DataClient,
  partId: string,
  afterPartId: string | null,
) {
  return client.rpc<ExperimentPartWire>('move_experiment_part', {
    p_part_id: partId,
    p_after_part_id: afterPartId,
  })
}

export function deleteExperimentPart(
  client: DataClient,
  partId: string,
  moveBlocksTo: string | null,
) {
  return client.rpc<{ part_id: string; moved_blocks: number }>(
    'delete_experiment_part',
    { p_part_id: partId, p_move_blocks_to: moveBlocksTo },
  )
}

export function setPartDone(client: DataClient, partId: string, done: boolean) {
  return client.rpc<ExperimentPartWire>('set_part_done', {
    p_part_id: partId,
    p_done: done,
  })
}

export function setBlockPart(
  client: DataClient,
  blockId: string,
  partId: string,
) {
  return client.rpc<{
    block_id: string
    part_id: string
    order: number
    version?: number
    structure_version?: number
  }>('set_block_part', { p_block_id: blockId, p_part_id: partId })
}

export function splitRecordIntoParts(
  client: DataClient,
  recordId: string,
  points: readonly SplitPoint[],
) {
  return client.rpc<ExperimentPartWire[]>('split_record_into_parts', {
    p_record_id: recordId,
    p_parts: points.map((point, index) => ({
      title: point.title,
      first_block_id: point.firstBlockId,
      day_offset: index,
    })),
  })
}

const partDateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "Mon 2 Nov": the date a part falls on, as the strip and the cards show it. */
export function formatPartDate(date: Date): string {
  return partDateFormat.format(date)
}
