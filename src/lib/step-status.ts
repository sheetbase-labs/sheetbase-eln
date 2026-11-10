/**
 * The status of each protocol step in a notebook, taken from the evidence on
 * the page rather than from a separate flag.
 *
 * - done: the step is ticked.
 * - in progress: not ticked, but it has a note, a result recorded against it, or
 *   a timer of the person's running on it.
 * - not started: none of those.
 *
 * The current step is the first one that is not done. When the experiment is
 * split into parts it is the first one that is not done in the current part
 * (the first part that is not done), and steps are numbered within their part.
 * The database computes the same thing for the API, the assistant and
 * pipelines (`api.record_steps`, migration 0103 and the experiment_parts migration); keep the two in step.
 */

import { z } from 'zod'

export type StepStatus = 'done' | 'in_progress' | 'not_started'

export interface StepBlockLike {
  id: string
  type?: string
  /** The part the block is in, when the experiment has parts. */
  partId?: string | null
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A block payload is open stored JSON shared with notebook rendering; every member read here is decoded by the member schemas below rather than trusted.
  payload: Record<string, unknown>
}

/** What stepProgress needs to know of the parts: their order and which is current. */
export interface StepPartsLike {
  id: string
  number: number
  state: 'done' | 'now' | 'later'
}

export interface StepProgress {
  blockId: string
  /** Position among the steps, from 1. */
  index: number
  stepNumber: number | null
  /** The part the step is in, and its place among that part's steps. */
  partId: string | null
  partNumber: number | null
  partStepIndex: number | null
  partStepCount: number | null
  text: string
  status: StepStatus
  current: boolean
  note: string | null
  results: number
  completedAt: string | null
  completedByUserId: string | null
  durationSeconds: number | null
  instrumentId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A payload member that reads as text; anything else reads as absent. */
const textMember = z.string().catch('')

/** A payload member that reads as a number; anything else reads as null. */
const numberMember = z.number().nullable().catch(null)

/** A payload member that reads as a tick; anything else counts as unticked. */
const booleanMember = z.boolean().catch(false)

/**
 * The steps of a notebook in page order. `timerBlockIds` are the steps the
 * person has a running timer on.
 */
export function stepProgress(
  blocks: readonly StepBlockLike[],
  timerBlockIds: ReadonlySet<string> = new Set(),
  parts: readonly StepPartsLike[] = [],
): StepProgress[] {
  const partById = new Map(parts.map((part) => [part.id, part]))
  const currentPartId = parts.find((part) => part.state === 'now')?.id ?? null
  const inPart = new Map<string, number>()

  for (const block of blocks) {
    if (block.type === 'procedure_step' && block.partId) {
      inPart.set(block.partId, (inPart.get(block.partId) ?? 0) + 1)
    }
  }

  const placed = new Map<string, number>()
  const results = new Map<string, number>()

  for (const block of blocks) {
    if (block.type !== 'metric') continue
    const step = textMember.parse(block.payload.stepBlockId)

    if (step) results.set(step, (results.get(step) ?? 0) + 1)
  }

  const steps: StepProgress[] = []
  let currentTaken = false

  for (const block of blocks) {
    if (block.type !== 'procedure_step') continue
    const payload = block.payload
    const label = textMember.parse(payload.text).trim()

    if (!label) continue

    const partId =
      block.partId && partById.has(block.partId) ? block.partId : null

    if (partId) placed.set(partId, (placed.get(partId) ?? 0) + 1)
    const done = booleanMember.parse(payload.completed)
    const note = textMember.parse(payload.note).trim() || null
    const resultCount = results.get(block.id) ?? 0

    const status: StepStatus = done
      ? 'done'
      : note || resultCount > 0 || timerBlockIds.has(block.id)
        ? 'in_progress'
        : 'not_started'

    const inCurrentPart = parts.length === 0 || partId === currentPartId
    const current = !done && !currentTaken && inCurrentPart

    if (current) currentTaken = true
    const instrumentId = textMember.parse(payload.instrumentId)

    steps.push({
      blockId: block.id,
      index: steps.length + 1,
      stepNumber: numberMember.parse(payload.stepNumber),
      partId,
      partNumber: partId ? partById.get(partId)!.number : null,
      partStepIndex: partId ? (placed.get(partId) ?? null) : null,
      partStepCount: partId ? (inPart.get(partId) ?? null) : null,
      text: label,
      status,
      current,
      note,
      results: resultCount,
      completedAt: done ? textMember.parse(payload.completedAt) || null : null,
      completedByUserId: done
        ? textMember.parse(payload.completedByUserId) || null
        : null,
      durationSeconds: numberMember.parse(payload.durationSeconds),
      instrumentId: UUID.test(instrumentId) ? instrumentId : null,
    })
  }

  return steps
}

/** The step to work on now, or null when every step is done (or there are none). */
export function currentStep(
  steps: readonly StepProgress[],
): StepProgress | null {
  return steps.find((step) => step.current) ?? null
}

/**
 * The one instrument a step's words name, when exactly one does. An instrument
 * is named by its name or its number (INS-0002); short names are ignored so a
 * word like "pH" does not match by accident.
 */
export function instrumentNamedBy<
  T extends { id: string; name: string; displayId?: string | null },
>(stepText: string, instruments: readonly T[]): T | null {
  const haystack = stepText.toLowerCase()

  const hits = instruments.filter((instrument) => {
    const name = instrument.name.trim().toLowerCase()
    const number = (instrument.displayId ?? '').trim().toLowerCase()

    return (
      (name.length >= 4 && haystack.includes(name)) ||
      (number.length >= 4 && haystack.includes(number))
    )
  })

  return hits.length === 1 ? hits[0] : null
}
