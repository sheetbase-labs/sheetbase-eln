/**
 * Which protocol step a new plate run goes in: the one the Now card named,
 * else the open step that names plates. The person can pick another, or none.
 */
import { useState } from 'react'

import { suggestPlateStep } from '#/lib/plate-step'

import { useExperimentSteps } from './use-experiment-steps'

export function useRunStep(input: {
  experimentId: string
  experimentFixed: boolean
  chooseStep: boolean
  initialStep: string | undefined
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const steps = useExperimentSteps(input.experimentId).data ?? []
  const wants = (input.chooseStep || !input.experimentFixed) && steps.length > 0

  const step =
    picked ?? input.initialStep ?? suggestPlateStep(steps)?.block_id ?? ''

  return {
    steps,
    wants,
    step,
    /** What the run is saved with: a step id, null for none, undefined to leave it be. */
    saved: wants ? step || null : undefined,
    onPick: setPicked,
  }
}
