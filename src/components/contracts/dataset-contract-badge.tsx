import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { contractKeys, fetchContractById } from '#/lib/data-contracts/client'
import { statusLabel } from '#/lib/data-contracts/rules'
import { notebookDataClient } from '#/lib/notebook-data'
import { ContractStatusBadge } from './contract-status'
import { useDatasetContractStatus } from './contract-data'

/** A dataset's standing under its schema's contract, linking to the contract. */
export function DatasetContractBadge({ datasetId }: { datasetId: string }) {
  const standing = useDatasetContractStatus(datasetId)
  const contractId = standing.data?.contractId
  const contract = useQuery({
    queryKey: [...contractKeys.all, 'by-id', contractId],
    queryFn: () => fetchContractById(notebookDataClient, contractId ?? ''),
    enabled: Boolean(contractId),
    staleTime: 30_000,
  })
  if (!standing.data) return null
  const modelId = contract.data?.datasetSchemaId
  const badge = <ContractStatusBadge status={standing.data.status} />
  return (
    <span
      className="inline-flex items-center gap-1.5 text-fg"
      title={t('contracts.statusHint.withContract', {
        contract: contract.data?.name ?? t('contracts.dataset.status'),
        status: statusLabel(standing.data.status),
      })}
    >
      <span className="text-fg-muted">{t('contracts.dataset.status')}</span>
      {modelId ? (
        <Link
          to="/models/$modelId/contract"
          params={{ modelId }}
          className="no-underline hover:no-underline"
        >
          {badge}
        </Link>
      ) : (
        badge
      )}
    </span>
  )
}
