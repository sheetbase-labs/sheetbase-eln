/**
 * Which protocol step a plate run is for. The run lands in that step of the
 * notebook and the step reads in progress.
 */
import { Field } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import type { PlateStepRow } from '#/lib/plate-step'

export function RunStepField({
  steps,
  value,
  onChange,
}: {
  steps: readonly PlateStepRow[]
  /** The chosen step's block id; empty for no step. */
  value: string
  onChange: (blockId: string) => void
}) {
  return (
    <Field
      label={t('features.plateRuns.step.label')}
      hint={t('features.plateRuns.step.hint')}
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('features.plateRuns.step.none')}</option>
        {steps.map((step, index) => (
          <option key={step.block_id} value={step.block_id}>
            {t('features.plateRuns.step.option', {
              number: step.step_number ?? index + 1,
              text: (step.step_text ?? '').slice(0, 90),
            })}
          </option>
        ))}
      </Select>
    </Field>
  )
}
