import { t } from '#/copy'
import { expectedPlateCount } from '#/lib/plate-step'
import type { StepProgress } from '#/lib/step-status'

/** "2 of 4 plates" when the step's words ask for a number of plates, else "2 plates". */
export function platesLine(step: StepProgress): string {
  const expected = expectedPlateCount(step.text)

  return expected !== null && expected > 1
    ? t('features.plateRuns.step.platesOf', {
        count: step.plates,
        expected,
      })
    : t('features.plateRuns.step.plates', { count: step.plates })
}
