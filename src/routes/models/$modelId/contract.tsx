import { createFileRoute } from '@tanstack/react-router'

import { ContractPanel } from '#/components/contracts/contract-panel'
import { useContractForTarget } from '#/components/contracts/contract-data'
import { hasCapability } from '#/lib/capability'
import { isUuid } from '#/lib/field-value-validation'
import type { ContractTarget } from '#/lib/data-contracts/types'

/**
 * The Contract tab of a table model or a record model: rules for what good
 * data looks like, the standing, and the record of every check.
 */
export const Route = createFileRoute('/models/$modelId/contract')({
  component: ModelContract,
})

function ModelContract() {
  const { modelId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const target: ContractTarget = isUuid(modelId)
    ? { kind: 'dataset_schema', id: modelId }
    : { kind: 'record_model', key: modelId }
  const contract = useContractForTarget(target)
  if (contract.isLoading) return null
  return (
    <ContractPanel
      target={target}
      contract={contract.data ?? null}
      canEdit={hasCapability(context.workspace?.role, 'schema.edit')}
    />
  )
}
