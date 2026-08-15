import type { DataClient } from './data-client'
import { createDataClient } from './data-client'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import {
  resolveSheetWriteTarget,
  type SheetWriteTarget,
} from './sheet-write-back'

type WithoutColumnId<T> = T extends unknown ? Omit<T, 'columnId'> : never

export type SheetRecordWriteTarget = WithoutColumnId<SheetWriteTarget> & {
  rowKey?: string
  identityValues?: unknown[]
  compositionOffset?: number
  instanceId?: string
  expectedRevision?: number
}

const RECORD_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function enrichSheetRecordWriteTarget(
  composition: ComposedSheetSnapshot,
  rowKey: string,
  resolved: SheetWriteTarget,
): SheetRecordWriteTarget {
  if (resolved.kind !== 'local') return resolved
  const row = composition.rows.find((item) => item.rowKey === rowKey)
  return {
    ...resolved,
    instanceId: composition.instanceId,
    expectedRevision: composition.revision,
    rowKey,
    identityValues: row?.identityValues,
    compositionOffset: row?.compositionOffset ?? composition.offset,
  }
}

export function composedSheetRecordLinkBatchRows(
  composition: ComposedSheetSnapshot,
  pendingValues: Record<string, Record<string, unknown>> = {},
): Array<{
  rowKey: string
  operation: 'link'
  recordId: string
  writeTarget: SheetRecordWriteTarget
}> {
  const columns = composition.boundProjection?.columns ?? []
  const picker = columns.find(
    (column) =>
      column.presentation.kind === 'record-picker' &&
      column.permission.editability === 'editable',
  )
  if (!picker) return []
  return (composition.boundProjection?.rows ?? []).flatMap((row) => {
    const pending = pendingValues[row.rowKey]?.[picker.id]
    const projected = row.values[picker.id]
    const raw =
      pending ?? (projected?.kind === 'present' ? projected.value : null)
    if (typeof raw !== 'string' || !RECORD_UUID.test(raw)) return []
    try {
      const resolved = resolveSheetWriteTarget({
        composition,
        rowKey: row.rowKey,
        columnId: picker.id,
      })
      return [
        {
          rowKey: row.rowKey,
          operation: 'link' as const,
          recordId: raw,
          writeTarget: enrichSheetRecordWriteTarget(
            composition,
            row.rowKey,
            resolved,
          ),
        },
      ]
    } catch {
      return []
    }
  })
}

export function createAndLinkSheetRecord(
  input: {
    projectId: string
    modelKey: string
    title: string
    customFields?: Record<string, unknown>
    writeTarget: SheetRecordWriteTarget
  },
  client: DataClient = createDataClient(),
) {
  return client.rpc('create_and_link_sheet_record', {
    p_project_id: input.projectId,
    p_model_key: input.modelKey,
    p_title: input.title,
    p_custom_fields: input.customFields ?? {},
    p_write_target: input.writeTarget,
  })
}

export function commitSheetRecordBatch(
  input: {
    projectId: string
    modelKey: string
    rows: unknown[]
    idempotencyKey: string
  },
  client: DataClient = createDataClient(),
) {
  return client.rpc('commit_sheet_record_batch', {
    p_project_id: input.projectId,
    p_model_key: input.modelKey,
    p_rows: input.rows,
    p_idempotency_key: input.idempotencyKey,
  })
}
