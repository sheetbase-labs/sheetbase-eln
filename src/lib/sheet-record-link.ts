/**
 * CORE-04.3 link/unlink a Sheet Record-reference cell.
 *
 * Persists the Record UUID through the column's authoritative write-back
 * target. Does not call `create_record_link`.
 */
import type { DataClient } from './data-client'
import { createDataClient } from './data-client'
import type { RecordReferenceCellContract } from './record-reference-cell'
import {
  clearRecordReference,
  selectRecordReference,
} from './record-reference-cell'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { writeSheetCell } from './sheet-write-back'

export function linkSheetRecordReference(
  input: {
    composition: ComposedSheetSnapshot
    rowKey: string
    columnId: string
    retryToken: string
    contract: RecordReferenceCellContract
    record: {
      recordId: string
      modelKey: string
      archived: boolean
      deleted: boolean
    }
  },
  client: DataClient = createDataClient(),
) {
  const value = selectRecordReference({
    contract: input.contract,
    record: input.record,
  })
  return writeSheetCell(
    {
      composition: input.composition,
      rowKey: input.rowKey,
      columnId: input.columnId,
      retryToken: input.retryToken,
      value,
    },
    client,
  )
}

export function unlinkSheetRecordReference(
  input: {
    composition: ComposedSheetSnapshot
    rowKey: string
    columnId: string
    retryToken: string
    contract: RecordReferenceCellContract
  },
  client: DataClient = createDataClient(),
) {
  return writeSheetCell(
    {
      composition: input.composition,
      rowKey: input.rowKey,
      columnId: input.columnId,
      retryToken: input.retryToken,
      value: clearRecordReference(input.contract),
    },
    client,
  )
}
