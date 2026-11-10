import { Progress } from '#/components/ui/progress'
import { t } from '#/copy'
import { computeSampleHold } from './sample-hold-data'
import type { HoldMeterRecord } from './sample-hold-data'

export function SampleHoldMeter({
  record,
  now,
}: {
  record: HoldMeterRecord
  /** Clock override for deterministic rendering/tests. */
  now?: Date
}) {
  const state = computeSampleHold(record, now)

  if (!state) {
    return (
      <p className="m-0 text-caption text-fg-muted">
        {t('library.samples.sampleHoldMeter.noHoldOrExpiryDate')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="num text-caption">
        {t('library.samples.sampleHoldMeter.ofUsed', {
          daysUsed: state.daysUsed,
          count: state.totalDays,
        })}
      </div>
      <Progress
        label={t('library.samples.sampleHoldMeter.holdTimeUsed')}
        value={state.percentUsed}
        tone={state.expired ? 'danger' : 'neutral'}
      />
    </div>
  )
}
