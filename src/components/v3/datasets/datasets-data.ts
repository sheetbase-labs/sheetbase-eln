import { useQuery } from '@tanstack/react-query'

import type { Tone } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (roadmap-4/ui-app3): the dataset registry from dataset_list_summary. */

export interface DatasetListRow {
  id: string
  uuid: string
  name: string
  model: string
  projectId: string | null
  createdByUserId: string | null
  rows: number
  issues: number
  updated: string
  archived: boolean
}

interface DatasetSummaryWire {
  id: string
  display_id: string | null
  name: string
  model: string | null
  project_id: string | null
  created_by_user_id: string | null
  row_count: string | number
  issue_count: string | number
  updated_at: string
  archived_at: string | null
}

export function toDatasetListRow(row: DatasetSummaryWire): DatasetListRow {
  return {
    id: row.display_id ?? row.id.slice(0, 8),
    uuid: row.id,
    name: row.name,
    model: row.model ?? '—',
    projectId: row.project_id,
    createdByUserId: row.created_by_user_id,
    rows: Number(row.row_count),
    issues: Number(row.issue_count),
    updated: row.updated_at.slice(0, 10),
    archived: row.archived_at != null,
  }
}

export function datasetValidation(row: DatasetListRow): {
  tone: Tone
  label: string
} {
  if (row.issues === 0) return { tone: 'ok', label: 'Valid' }
  return {
    tone: 'bad',
    label: `${row.issues} ${row.issues === 1 ? 'issue' : 'issues'}`,
  }
}

export const datasetListQueryKeys = {
  page: ['ui-port', 'datasets', 'page'] as const,
}

export function useDatasetSummaries(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: datasetListQueryKeys.page,
    queryFn: async () => {
      const rows = await client.rpc<DatasetSummaryWire[]>(
        'dataset_list_summary',
        {},
      )
      return rows.map(toDatasetListRow)
    },
    staleTime: 15_000,
  })
}
