import { useMutation } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import type { BulkSampleRow } from '#/lib/sample-bulk'
import { registerSamples } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'

/** The caller owns refreshing its registry after this transaction succeeds. */
export function useBulkRegistration(
  client: DataClient,
  projectId: string,
  rows: BulkSampleRow[],
  defaultLocation: string,
  onSuccess: (samples: SampleRecord[]) => void,
) {
  return useMutation({
    mutationFn: () =>
      registerSamples(client, {
        projectId,
        samples: rows.map((row) => ({
          title: row.title,
          sampleType: row.sampleType,
          quantity: row.quantity,
          quantityUnit: row.quantityUnit,
          storageLocation:
            row.storageLocation ?? (defaultLocation.trim() || undefined),
          barcode: row.barcode,
        })),
      }),
    onSuccess,
  })
}
