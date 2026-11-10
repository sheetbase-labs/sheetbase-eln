import { t } from '#/copy'
import { formatQuantityAmount } from './quantity-input'
import type { AliquotPlan, PoolPlan } from './quantity-plans'

export function AliquotPlanPreview({
  plan,
  unit,
  identifier,
}: {
  plan: AliquotPlan
  unit: string | null
  identifier: string
}) {
  if (plan.error)
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        {plan.error}
      </p>
    )

  if (plan.total == null) return null
  const suffix = unit ? ` ${unit}` : ''
  const total = `${formatQuantityAmount(plan.total)}${suffix}`

  return (
    <p role="status" className="m-0 text-label text-fg-muted">
      {plan.remaining != null
        ? t('library.samples.aliquotDialog.totalAndStaysIn', {
            total,
            remaining: `${formatQuantityAmount(plan.remaining)}${suffix}`,
            identifier,
          })
        : t('library.samples.aliquotDialog.total', { total })}
    </p>
  )
}

export function PoolPlanPreview({ plan }: { plan: PoolPlan }) {
  if (plan.error)
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        {plan.error}
      </p>
    )

  if (plan.total == null) return null
  const suffix = plan.unit ? ` ${plan.unit}` : ''

  return (
    <p role="status" className="m-0 text-label text-fg-muted">
      {t('library.samples.poolDialog.total', {
        total: `${formatQuantityAmount(plan.total)}${suffix}`,
      })}
    </p>
  )
}
