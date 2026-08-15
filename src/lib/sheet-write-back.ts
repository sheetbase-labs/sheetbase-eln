import { z } from 'zod'

import type { DataClient } from './data-client'
import { createDataClient } from './data-client'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { mutateSheetLocalState } from './sheet-local-data'

const uuid = z.string().uuid()

export type SheetWriteTarget =
  | {
      kind: 'dataset'
      columnId: string
      datasetId: string
      rowId: string
      fieldId: string
      expectedDatasetRevision: number
      expectedRowRevision: number
    }
  | {
      kind: 'model'
      columnId: string
      recordId: string
      fieldId: string
      fieldName: string
      expectedMetadataVersion: number
    }
  | { kind: 'local'; columnId: string; fieldId: string }

export type SheetCellWriteError =
  | 'ambiguous_target'
  | 'unresolved_target'
  | 'calculated_read_only'
  | 'permission_denied'
  | 'invalid_value'
  | 'stale'
  | 'conflict'

/** Resolve from one authenticated, parsed composition snapshot. Labels, order,
 * A1 coordinates and caller-provided revision maps are deliberately absent. */
export function resolveSheetWriteTarget(input: {
  composition: ComposedSheetSnapshot
  rowKey: string
  columnId: string
}): SheetWriteTarget {
  const sourceRows = input.composition.rows.filter(
    ({ rowKey }) => rowKey === input.rowKey,
  )
  if (sourceRows.length > 1) throw new Error('ambiguous_target')
  if (sourceRows.length !== 1) throw new Error('unresolved_target')
  if (input.composition.localFieldIds.includes(input.columnId))
    return { kind: 'local', columnId: input.columnId, fieldId: input.columnId }
  const configuration = input.composition.definitionConfiguration
  if (!configuration || !input.composition.boundProjection)
    throw new Error('unresolved_target')
  const column = configuration.columns.find(({ id }) => id === input.columnId)
  if (!column) throw new Error('unresolved_target')
  if (column.source.kind === 'calculated')
    throw new Error('calculated_read_only')
  if (column.source.kind === 'declared') throw new Error('unresolved_target')
  const source = column.source
  const rules = configuration.writeBackRules.flatMap((rule) =>
    rule.bindingId === source.bindingId
      ? rule.mappings
          .filter(({ columnId }) => columnId === column.id)
          .map(({ targetFieldId }) => targetFieldId)
      : [],
  )
  if (rules.length > 1) throw new Error('ambiguous_target')
  if (rules.length !== 1 || rules[0] !== source.sourceFieldId)
    throw new Error('unresolved_target')
  const projectedRows = input.composition.boundProjection.rows.filter(
    ({ rowKey }) => rowKey === input.rowKey,
  )
  if (projectedRows.length > 1) throw new Error('ambiguous_target')
  if (!projectedRows[0] || !Object.hasOwn(projectedRows[0].values, column.id))
    throw new Error('unresolved_target')
  const value = projectedRows[0].values[column.id]
  if (value.kind === 'unmatched') throw new Error('unresolved_target')
  const provenance = value.provenance
  if (provenance.sourceKind === 'dataset') {
    if (provenance.sourceRowId === null || provenance.sourceRevision === null)
      throw new Error('unresolved_target')
    return {
      kind: 'dataset',
      columnId: column.id,
      datasetId: provenance.sourceDatasetId,
      rowId: provenance.sourceRowId,
      fieldId: provenance.sourceFieldId,
      expectedDatasetRevision: provenance.sourceDatasetRevision,
      expectedRowRevision: provenance.sourceRevision,
    }
  }
  return {
    kind: 'model',
    columnId: column.id,
    recordId: provenance.sourceRecordId,
    fieldId: provenance.sourceFieldId,
    fieldName: provenance.sourceFieldName,
    expectedMetadataVersion: provenance.sourceMetadataVersion,
  }
}

export function sheetCellWriteError(error: unknown): SheetCellWriteError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ambiguous_target')) return 'ambiguous_target'
  if (message.includes('calculated_read_only')) return 'calculated_read_only'
  if (message.includes('unresolved_target')) return 'unresolved_target'
  if (code === '42501' || /42501|denied|permission/i.test(message))
    return 'permission_denied'
  if (
    ['SB001', 'SB073'].includes(code) ||
    /SB001|SB073|stale|revision|metadata version/i.test(message)
  )
    return 'stale'
  if (code === '23505' || /23505|conflict/i.test(message)) return 'conflict'
  return 'invalid_value'
}

async function dispatchResolvedSheetCell(
  input: {
    instanceId: string
    instanceRevision: number
    retryToken: string
    rowAddress:
      | { kind: 'local'; rowKey: string }
      | {
          kind: 'composed'
          rowKey: string
          identityValues: unknown[]
          compositionOffset: number
        }
    target: SheetWriteTarget
    value: unknown
  },
  client: DataClient,
) {
  uuid.parse(input.retryToken)
  if (input.target.kind === 'dataset')
    return client.rpc('commit_dataset_row_batch', {
      p_dataset_id: input.target.datasetId,
      p_expected_dataset_revision: input.target.expectedDatasetRevision,
      p_rows: [
        {
          operation: 'update',
          rowId: input.target.rowId,
          expectedRevision: input.target.expectedRowRevision,
          values: { [input.target.fieldId]: input.value },
        },
      ],
      p_idempotency_key: input.retryToken,
    })
  if (input.target.kind === 'model')
    return client.rpc('update_record_custom_fields', {
      p_record_id: input.target.recordId,
      p_expected_metadata_version: input.target.expectedMetadataVersion,
      p_values: { [input.target.fieldName]: input.value },
    })
  return mutateSheetLocalState(
    {
      instanceId: input.instanceId,
      expectedRevision: input.instanceRevision,
      retryToken: input.retryToken,
      rows: [input.rowAddress],
      cells: [
        {
          rowKey: input.rowAddress.rowKey,
          fieldId: input.target.fieldId,
          value: input.value,
        },
      ],
    },
    client,
  )
}

/** Public write orchestration: resolve stable IDs and CAS provenance from the
 * authenticated composition response, then dispatch through the existing
 * controlled owner RPC. */
export function writeSheetCell(
  input: {
    composition: ComposedSheetSnapshot
    rowKey: string
    columnId: string
    retryToken: string
    value: unknown
  },
  client: DataClient = createDataClient(),
) {
  const target = resolveSheetWriteTarget(input)
  const row = input.composition.rows.find(
    ({ rowKey }) => rowKey === input.rowKey,
  )!
  return dispatchResolvedSheetCell(
    {
      instanceId: input.composition.instanceId,
      instanceRevision: input.composition.revision,
      retryToken: input.retryToken,
      rowAddress: {
        kind: 'composed',
        rowKey: row.rowKey,
        identityValues: row.identityValues,
        compositionOffset: input.composition.offset,
      },
      target,
      value: input.value,
    },
    client,
  )
}
