import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import { isSequenceFileName } from '#/lib/sequence'
import type { SequenceSummary } from '#/lib/sequence'

export interface LinkedSequence {
  /** The file's record id: what the download route takes. */
  fileRecordId: string
  name: string
  summary: SequenceSummary | null
  addedAt: string
}

interface LinkWire {
  target_record_id: string | null
}

interface FileWire {
  record_id: string
  display_name: string
  created_at: string
  version: number
  sequence_summary: SequenceSummary | null
}

export const linkedSequencesKey = (recordId: string) =>
  ['ui-port', 'linked-sequences', recordId] as const

/** The sequence files linked to a record, a sample or a notebook. */
export function useLinkedSequences(recordId: string | null) {
  return useQuery({
    queryKey: linkedSequencesKey(recordId ?? ''),
    enabled: recordId !== null,
    queryFn: async (): Promise<LinkedSequence[]> => {
      const links = await notebookDataClient.list<LinkWire>(
        'record_links',
        `?source_record_id=eq.${recordId}&target_kind=eq.file&select=target_record_id`,
      )

      const ids = [
        ...new Set(
          links
            .map((l) => l.target_record_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ]

      if (ids.length === 0) return []

      const files = await notebookDataClient.list<FileWire>(
        'file_objects',
        `?record_id=in.(${ids.map(encodeURIComponent).join(',')})&select=record_id,display_name,created_at,version,sequence_summary&order=version.asc`,
      )

      // The latest version of each file is the one that counts.
      const latest = new Map<string, FileWire>()

      for (const f of files) latest.set(f.record_id, f)

      return [...latest.values()]
        .flatMap((f) =>
          f.sequence_summary || isSequenceFileName(f.display_name)
            ? [
                {
                  fileRecordId: f.record_id,
                  name: f.display_name,
                  summary: f.sequence_summary,
                  addedAt: f.created_at,
                },
              ]
            : [],
        )
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    },
  })
}
