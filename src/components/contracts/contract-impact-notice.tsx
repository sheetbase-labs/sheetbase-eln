import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { contractImpact } from '#/lib/data-contracts/impact'
import type { ContractFieldShape } from '#/lib/data-contracts/impact'
import { describeRule, kindLabel } from '#/lib/data-contracts/rules'
import type { ContractTarget } from '#/lib/data-contracts/types'
import { useContractForTarget } from './contract-data'

/** The unit a field stores values in, from its quantity metadata. */
export function storageUnitOf(quantity: unknown): string | null {
  if (quantity && typeof quantity === 'object' && 'storageUnit' in quantity) {
    const unit = (quantity as { storageUnit?: unknown }).storageUnit
    return typeof unit === 'string' && unit !== '' ? unit : null
  }
  return null
}

/**
 * Shown beside a version that is about to be published: the contract rules the
 * new fields would break, so nobody finds out from a failed import later.
 */
export function ContractImpactNotice({
  target,
  nextFields,
  modelId,
}: {
  target: ContractTarget
  nextFields: ContractFieldShape[]
  modelId: string
}) {
  const contract = useContractForTarget(target)
  if (!contract.data || contract.data.lifecycle === 'retired') return null
  const impacts = contractImpact(contract.data.rules, nextFields)
  if (impacts.length === 0) return null
  return (
    <Notice
      tone="warn"
      title={t('contracts.impact.title')}
      className="mb-4"
      action={
        <Button
          size="sm"
          nativeButton={false}
          render={<Link to="/models/$modelId/contract" params={{ modelId }} />}
        >
          {t('contracts.impact.contract')}
        </Button>
      }
    >
      <p>{t('contracts.impact.body')}</p>
      <ul className="mt-1 list-disc pl-5">
        {impacts.map(({ rule, reason }) => (
          <li key={rule.id}>
            {t(
              reason === 'removed'
                ? 'contracts.impact.removed'
                : reason === 'not_number'
                  ? 'contracts.impact.notNumber'
                  : 'contracts.impact.unitChanged',
              {
                rule: `${kindLabel(rule.kind)} (${describeRule(rule)})`,
                field: rule.field ?? '',
              },
            )}
          </li>
        ))}
      </ul>
    </Notice>
  )
}
