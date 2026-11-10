import { useQuery } from '@tanstack/react-query'

import {
  fetchPartsForRecord,
  partQueryKeys,
  partsProgress,
} from '#/lib/experiment-parts'
import type { PartBlockLike } from '#/lib/experiment-parts'
import { notebookDataClient } from '#/lib/notebook-data'

/** The parts of an experiment as stored; empty while loading or when it has none. */
export function useRecordParts(recordId: string, enabled = true) {
  return useQuery({
    queryKey: partQueryKeys.forRecord(recordId),
    queryFn: () => fetchPartsForRecord(notebookDataClient, recordId),
    enabled,
  })
}

/** The parts with where each stands, worked out from the blocks on the page. */
export function useRecordPartsProgress(
  recordId: string,
  blocks: readonly PartBlockLike[],
  enabled = true,
) {
  const query = useRecordParts(recordId, enabled)

  return {
    parts: partsProgress(query.data ?? [], blocks),
    isLoading: query.isLoading,
  }
}
