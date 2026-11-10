import type { DataClient } from '#/lib/data-client'
import { recordSampleLabelPrint } from '#/lib/samples'
import type { SampleLabelRecord } from './label-card-data'

export const LABEL_SHEET_LIMIT = 96

export interface BatchLabelRecord extends SampleLabelRecord {
  id: string
  metadataVersion: number
  /** Anything but a sample prints identifier and title, without a sample event. */
  kind?: string
}

export const isSample = (record: { kind?: string }) =>
  !record.kind || record.kind === 'sample'

export function batchLabelKind(records: readonly BatchLabelRecord[]): string {
  const kinds = new Set(records.map((record) => record.kind ?? 'sample'))

  return kinds.size === 1 ? [...kinds][0] : 'record'
}

export interface BatchPrintOutcome {
  recorded: number
  failed: { identifier: string; error: unknown }[]
}

/** Record every sample's print, including when another sample is refused. */
export async function recordBatchPrints(
  client: DataClient,
  records: readonly BatchLabelRecord[],
): Promise<BatchPrintOutcome> {
  const samples = records.filter(isSample)

  const settled = await Promise.allSettled(
    samples.map((record) =>
      recordSampleLabelPrint(client, {
        recordId: record.id,
        expectedMetadataVersion: record.metadataVersion,
        identifier: record.identifier,
      }),
    ),
  )

  const failed: BatchPrintOutcome['failed'] = []
  settled.forEach((result, index) => {
    if (result.status === 'rejected')
      failed.push({
        identifier: samples[index].identifier,
        error: result.reason,
      })
  })

  return { recorded: samples.length - failed.length, failed }
}
