/**
 * The samples an experiment is working with, for laying them out on a plate.
 * They are the samples linked to the experiment, so a plate well can name the
 * sample it holds and the result reaches that sample.
 */
import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'

export interface ExperimentSample {
  id: string | null
  identifier: string
}

interface LinkRow {
  target_record_id: string | null
  target_identifier: string
}

export const experimentSampleKeys = {
  forRecord: (recordId: string) => ['experiment-samples', recordId] as const,
}

export function useExperimentSamples(recordId: string) {
  return useQuery({
    queryKey: experimentSampleKeys.forRecord(recordId),
    enabled: recordId !== '',
    staleTime: 30_000,
    queryFn: async (): Promise<ExperimentSample[]> => {
      const rows = await notebookDataClient.list<LinkRow>(
        'record_links',
        `?source_record_id=eq.${encodeURIComponent(recordId)}&link_type=eq.sample&select=target_record_id,target_identifier&order=target_identifier.asc&limit=200`,
      )

      const seen = new Set<string>()

      return rows.flatMap((row) => {
        if (seen.has(row.target_identifier)) return []
        seen.add(row.target_identifier)

        return [{ id: row.target_record_id, identifier: row.target_identifier }]
      })
    },
  })
}
