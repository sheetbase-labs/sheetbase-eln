import { skipToken, useQuery } from '@tanstack/react-query'

import {
  useModelFields,
  useModelVersions,
} from '#/components/models/models-data'
import {
  contractKeys,
  fetchContractForTarget,
  fetchDatasetStatus,
  fetchRuns,
} from '#/lib/data-contracts/client'
import type { ContractTarget } from '#/lib/data-contracts/types'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'

/** The contract of a model, or null when it has none. */
export function useContractForTarget(
  target: ContractTarget | null,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: target ? contractKeys.target(target) : ['data-contracts', 'none'],
    queryFn: target ? () => fetchContractForTarget(client, target) : skipToken,
    staleTime: 15_000,
  })
}

export function useContractRuns(
  contractId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: contractKeys.runs(contractId ?? ''),
    queryFn: contractId ? () => fetchRuns(client, contractId) : skipToken,
    staleTime: 10_000,
  })
}

/** A dataset's standing under its schema's contract; null when it has none. */
export function useDatasetContractStatus(
  datasetId: string | undefined,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: contractKeys.datasetStatus(datasetId ?? ''),
    queryFn: datasetId
      ? () => fetchDatasetStatus(client, datasetId)
      : skipToken,
    staleTime: 15_000,
  })
}

export interface ContractFieldOption {
  key: string
  label: string
}

/** The fields a rule can be about, from the model's current definition. */
export function useContractFields(
  target: ContractTarget | null,
  client: DataClient = notebookDataClient,
) {
  const schemaId = target?.kind === 'dataset_schema' ? target.id : ''
  const versions = useModelVersions(schemaId, client)
  const latest = versions.data?.[0]
  const schemaFields = useModelFields(latest?.id, client)

  const recordModelKey = target?.kind === 'record_model' ? target.key : null

  const recordFields = useQuery({
    queryKey: ['data-contracts', 'record-fields', target],
    queryFn:
      recordModelKey === null
        ? skipToken
        : async (): Promise<ContractFieldOption[]> => {
            const rows = await client.list<{
              field_name: string
              label: string
            }>(
              'record_field_definitions',
              `?kind=eq.${encodeURIComponent(recordModelKey)}&lifecycle=eq.active&select=field_name,label&order=display_order`,
            )

            return rows.map((row) => ({
              key: row.field_name,
              label: row.label,
            }))
          },
    staleTime: 30_000,
  })

  if (target?.kind === 'record_model') return recordFields.data ?? []

  return (schemaFields.data ?? [])
    .filter((field) => field.lifecycle === 'active')
    .map((field) => ({ key: field.key, label: field.label }))
}
