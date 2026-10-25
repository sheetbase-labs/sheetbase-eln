import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import {
  listRecordModelVersionUsage,
  listRecordModelVersions,
} from '#/lib/record-model-versions'

/** The versions of a workspace record model, newest first. Shares its key with
 * the Versions tab so a save there refreshes the Fields tab and header counts. */
export function useRecordModelVersionList(modelId: string | undefined) {
  return useQuery({
    queryKey: ['ui-port', 'record-models', 'versions', modelId],
    queryFn: () =>
      modelId ? listRecordModelVersions(notebookDataClient, modelId) : [],
    enabled: Boolean(modelId),
  })
}

export function useRecordModelVersionUsage(modelId: string | undefined) {
  return useQuery({
    queryKey: ['ui-port', 'record-models', 'version-usage', modelId],
    queryFn: () =>
      modelId ? listRecordModelVersionUsage(notebookDataClient, modelId) : [],
    enabled: Boolean(modelId),
  })
}

/** How many records exist for a model key, for the Records tab count. */
export function useRecordModelRecordCount(modelKey: string) {
  return useQuery({
    queryKey: ['ui-port', 'record-models', 'record-count', modelKey],
    enabled: Boolean(modelKey),
    staleTime: 15_000,
    queryFn: async () =>
      (
        await notebookDataClient.list<{ id: string }>(
          'records',
          `?kind=eq.${encodeURIComponent(modelKey)}&deleted_at=is.null&select=id`,
        )
      ).length,
  })
}
