import { Section } from '#/components/ui/layout'
import { Progress } from '#/components/ui/progress'
import { Status } from '#/components/ui/status'
import type { SampleQuantityBalances } from '#/lib/samples'
import { formatQuantityAmount } from './quantity-input'
import { computeUsageSegments } from './sample-usage-data'
import { t } from '#/copy'

/**
 * LAB-01 step 3 — the SampleUsage "Volume" bar.
 *
 * The bar is built from `api.sample_quantity_balances`: `used` is the
 * cumulative consumed volume from the canonical `api.sample_events` ledger,
 * `reserved` is the active reservation sum and `free` is the current quantity
 * minus reserved. Registered volume is `used + current` = `used + reserved +
 * free`, so the three segments always fill the bar exactly.
 */

export function UsageBalanceBar({
  balances,
  className,
}: {
  balances: SampleQuantityBalances | null
  className?: string
}) {
  const segments = computeUsageSegments(balances)
  const unit = balances?.unit ? ` ${balances.unit}` : ''
  const label = `${formatQuantityAmount(segments.total)}${unit} registered: ${formatQuantityAmount(segments.used)}${unit} used, ${formatQuantityAmount(segments.reserved)}${unit} reserved, ${formatQuantityAmount(segments.free)}${unit} free`

  return (
    <Section
      title={t('library.samples.sampleUsage.volume')}
      className={className}
    >
      <div className="max-w-[640px]">
        <Progress
          label={label}
          size="md"
          segments={[
            { value: segments.usedPct, className: 'bg-fg-muted' },
            { value: segments.reservedPct, className: 'bg-selection-border' },
          ]}
        />
        <div className="num mt-2 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-label">
          <Status tone="stored">
            {t('library.samples.sampleUsage.used', {
              used: formatQuantityAmount(segments.used),
              unit,
            })}
          </Status>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-[7px] rounded-full bg-selection-border"
            />
            {t('library.samples.sampleUsage.reserved', {
              reserved: formatQuantityAmount(segments.reserved),
              unit,
            })}
          </span>
          <Status tone="none">
            {t('library.samples.sampleUsage.free', {
              free: formatQuantityAmount(segments.free),
              unit,
            })}
          </Status>
        </div>
      </div>
    </Section>
  )
}
