import { useQuery } from '@tanstack/react-query'

import { chunkIds } from '#/lib/chunk-ids'
import { notebookDataClient } from '#/lib/notebook-data'
import type { RecordWire } from '#/lib/notebook-data'

/** A volume with its unit, or an em dash when the reading is missing. */
export function formatVolume(
  value: number | null | undefined,
  unit: string | null,
): string {
  if (value == null) return '—'
  const amount = value.toLocaleString('en-GB', { maximumFractionDigits: 2 })

  return unit ? `${amount} ${unit}` : amount
}

/** The experiments and samples a withdrawal names, read in one chunked pass. */
export function usePurposeRecords(purposeIds: string[]) {
  const ids = Array.from(new Set(purposeIds.filter(Boolean)))

  return useQuery({
    queryKey: ['ui-port', 'sample-purpose-records', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = (
        await Promise.all(
          chunkIds(ids).map((group) =>
            notebookDataClient.list<RecordWire>(
              'records',
              `?id=in.(${group.join(',')})&select=id,identifier,title,kind`,
            ),
          ),
        )
      ).flat()

      return new Map(rows.map((row) => [row.id, row]))
    },
  })
}
