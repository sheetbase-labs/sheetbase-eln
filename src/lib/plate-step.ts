/**
 * Which protocol step a plate run belongs to, and how far the step is.
 *
 * A step is the spine of a notebook: the data run for it sits straight after it
 * and the step reads "in progress" once there is some (the database counts it in
 * `api.record_steps`; `step-status.ts` counts it the same way). These helpers
 * pick the step to offer when a run is added and count the plates a step asks
 * for ("plates 1–4"), so the step can say "2 of 4 plates".
 */
import type { DataClient } from '#/lib/data-client'

/** One row of `api.record_steps`: the part of it the plate dialogs use. */
export interface PlateStepRow {
  block_id: string
  step_number: number | null
  step_text: string | null
  status: 'done' | 'in_progress' | 'not_started'
  is_current: boolean
  result_count: number
}

export function recordSteps(
  client: DataClient,
  recordId: string,
): Promise<PlateStepRow[]> {
  return client.rpc<PlateStepRow[]>('record_steps', { p_record_id: recordId })
}

const PLATE_WORD = /\bplates?\b/i

/**
 * The step a new plate run most likely belongs to: the first step still open
 * that names plates. None when no step does: a guess at the current step would
 * put a plate under whatever the person happens to be doing, so the run goes at
 * the end instead, and the person (or the Now card) names the step.
 */
export function suggestPlateStep(
  steps: readonly PlateStepRow[],
): PlateStepRow | null {
  const open = steps.filter((step) => step.status !== 'done')

  return open.find((step) => PLATE_WORD.test(step.step_text ?? '')) ?? null
}

/**
 * How many plates a step's words ask for: "plates 1–4" is four, "plate 4 today"
 * is one, "6 plates" is six. Null when the words name none.
 */
export function expectedPlateCount(text: string | null): number | null {
  if (!text) return null
  const range = /\bplates?\s+(\d+)\s*(?:–|—|-|to)\s*(\d+)/i.exec(text)

  if (range) {
    const count = Number(range[2]) - Number(range[1]) + 1

    return count >= 1 && count <= 384 ? count : null
  }

  const counted = /\b(\d+)\s+plates\b/i.exec(text)

  if (counted) {
    const count = Number(counted[1])

    return count >= 1 && count <= 384 ? count : null
  }

  return PLATE_WORD.test(text) ? 1 : null
}
