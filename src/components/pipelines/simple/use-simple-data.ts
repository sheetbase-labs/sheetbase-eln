import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'

/** One column of a dataset, with the field id a flag needs. */
export interface DatasetColumn {
  id: string
  key: string
  label: string
  type: string
}

/** The columns of a dataset's schema version. */
export function useDatasetColumns(schemaVersionId: string) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'simple-columns', schemaVersionId],
    queryFn: async (): Promise<DatasetColumn[]> => {
      const rows = await notebookDataClient.list<{
        field_id: string
        key: string
        label: string
        logical_type: string
      }>(
        'dataset_schema_version_fields',
        `?select=field_id,key,label,logical_type&schema_version_id=eq.${encodeURIComponent(schemaVersionId)}&lifecycle=eq.active&order=display_order.asc`,
      )

      return rows.map((row) => ({
        id: row.field_id,
        key: row.key,
        label: row.label,
        type: row.logical_type,
      }))
    },
    enabled: schemaVersionId.length > 0,
    staleTime: 60_000,
  })
}

export interface LatestSnapshot {
  id: string
  label: string
  createdAt: string
}

/** The newest snapshot (dataset version) of a dataset, the one a dry run reads. */
export function useLatestSnapshot(datasetId: string) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'simple-snapshot', datasetId],
    queryFn: async (): Promise<LatestSnapshot | null> => {
      const rows = await notebookDataClient.list<{
        id: string
        label: string
        created_at: string
      }>(
        'dataset_versions',
        `?select=id,label,created_at&dataset_id=eq.${encodeURIComponent(datasetId)}&order=created_at.desc&limit=1`,
      )

      const row = rows.at(0)

      return row
        ? { id: row.id, label: row.label, createdAt: row.created_at }
        : null
    },
    enabled: datasetId.length > 0,
    staleTime: 15_000,
  })
}

export interface NotificationChannel {
  id: string
  key: string
  description: string | null
  channel: 'teams' | 'email' | 'webhook'
}

/** The places a run can post: Teams channels, email addresses and webhooks. */
export function useNotificationChannels() {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'simple-channels'] as const,
    queryFn: async (): Promise<NotificationChannel[]> => {
      const rows = await notebookDataClient.list<{
        id: string
        key: string
        description: string | null
        channel_type: string
        status: string
      }>(
        'webhook_subscriptions',
        '?select=id,key,description,channel_type,status&status=eq.active&order=key.asc',
      )

      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        description: row.description,
        channel:
          row.channel_type === 'teams' || row.channel_type === 'email'
            ? row.channel_type
            : 'webhook',
      }))
    },
    staleTime: 60_000,
  })
}
