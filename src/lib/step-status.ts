/**
 * The status of each protocol step in a notebook, taken from the evidence on
 * the page rather than from a separate flag.
 *
 * - done: the step is ticked.
 * - in progress: not ticked, but it has a note, a result recorded against it, or
 *   a timer of the person's running on it.
 * - not started: none of those.
 *
 * The current step is the first one that is not done. The database computes the
 * same thing for the API, the assistant and pipelines (`api.record_steps`, migration
 * 0103); keep the two in step.
 */

export type StepStatus = 'done' | 'in_progress' | 'not_started'

export interface StepBlockLike {
  id: string
  type?: string
  payload: Record<string, unknown>
}

export interface StepProgress {
  blockId: string
  /** Position among the steps, from 1. */
  index: number
  stepNumber: number | null
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

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The steps of a notebook in page order. `timerBlockIds` are the steps the
 * person has a running timer on.
 */
export function stepProgress(
  blocks: readonly StepBlockLike[],
  timerBlockIds: ReadonlySet<string> = new Set(),
): StepProgress[] {
  const results = new Map<string, number>()
  for (const block of blocks) {
    if (block.type !== 'metric') continue
    const step = text(block.payload.stepBlockId)
    if (step) results.set(step, (results.get(step) ?? 0) + 1)
  }
  const steps: StepProgress[] = []
  let currentTaken = false
  for (const block of blocks) {
    if (block.type !== 'procedure_step') continue
    const payload = block.payload
    const label = text(payload.text).trim()
    if (!label) continue
    const done = payload.completed === true
    const note = text(payload.note).trim() || null
    const resultCount = results.get(block.id) ?? 0
    const status: StepStatus = done
      ? 'done'
      : note || resultCount > 0 || timerBlockIds.has(block.id)
        ? 'in_progress'
        : 'not_started'
    const current = !done && !currentTaken
    if (current) currentTaken = true
    steps.push({
      blockId: block.id,
      index: steps.length + 1,
      stepNumber:
        typeof payload.stepNumber === 'number' ? payload.stepNumber : null,
      text: label,
      status,
      current,
      note,
      results: resultCount,
      completedAt: done ? text(payload.completedAt) || null : null,
      completedByUserId: done ? text(payload.completedByUserId) || null : null,
      durationSeconds:
        typeof payload.durationSeconds === 'number'
          ? payload.durationSeconds
          : null,
      instrumentId: UUID.test(text(payload.instrumentId))
        ? text(payload.instrumentId)
        : null,
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
