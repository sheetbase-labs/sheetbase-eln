import { z } from 'zod'

import type { DataClient } from './data-client'
import { createDataClient } from './data-client'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { mutateSheetLocalState } from './sheet-local-data'

const uuid = z.string().uuid()

/**
 * GRID-02 — the server rejected a bulk write during pre-commit validation.
 * Carries the canonical per-row/field error list so the workspace can point
 * the scientist at the offending cell instead of committing partial state.
 */
export class SheetBatchValidationError extends Error {
  readonly errors: Array<{ code: string; rowId?: string; fieldId?: string }>

  constructor(
    errors:
      Array<{ code: string; rowId?: string; fieldId?: string }> | undefined,
  ) {
    const first = errors?.[0]
    super(
      first
        ? `sheet_batch_validation_failed: ${first.code}`
        : 'sheet_batch_validation_failed',
    )
    this.name = 'SheetBatchValidationError'
    this.errors = errors ?? []
  }
}

/**
 * GRID-02 — a range operation spans more than one authoritative commit group
 * (multiple datasets/record groups, or a mix of dataset, record and local
 * targets). Cross-authority atomicity is not available in one RPC, so the
 * operation is rejected before ANY write: dispatching the groups sequentially
 * could commit one and strand the rest behind a dangling pending state.
 */
export class SheetMixedAuthorityWriteError extends Error {
  constructor() {
    super(
      'mixed_authority_write: Range operation rejected: it spans more than one authoritative target; nothing was written. Split the edit so each range operation writes to one dataset/record/local surface.',
    )
    this.name = 'SheetMixedAuthorityWriteError'
  }
}

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
  | 'mixed_authority_write'
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
  if (error instanceof SheetBatchValidationError) return 'invalid_value'
  if (error instanceof SheetMixedAuthorityWriteError)
    return 'mixed_authority_write'
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

export interface SheetCellWrite {
  rowKey: string
  columnId: string
  value: unknown
}

/**
 * PLAT-05 — batch write-back. Resolves every cell against the authenticated
 * composition snapshot first (fail-fast before any write), then dispatches
 * grouped RPCs:
 *
 *   - Dataset-bound cells: ONE `commit_dataset_row_batch` per
 *     (dataset, expected revision) group instead of one RPC per cell;
 *   - Record-bound cells: one `update_record_custom_fields` per record;
 *   - Local cells: one `mutate_sheet_instance_local_state` for all of them.
 *
 * GRID-02: the groups dispatch sequentially with no cross-group atomicity,
 * so a change set spanning more than one commit group is rejected with
 * `SheetMixedAuthorityWriteError` before any RPC runs.
 * This is the paste/multi-cell-edit path: a 100-cell paste over bound columns
 * previously issued 100 sequential HTTP RPCs.
 */
export async function writeSheetCells(
  input: {
    composition: ComposedSheetSnapshot
    cells: SheetCellWrite[]
    retryToken: string
  },
  client: DataClient = createDataClient(),
): Promise<void> {
  const composition = input.composition
  const rowByKey = new Map(
    composition.rows.map((row) => [row.rowKey, row] as const),
  )
  const rowAddressFor = (rowKey: string) => {
    const row = rowByKey.get(rowKey)
    if (!row) throw new Error('unresolved_target')
    return {
      kind: 'composed' as const,
      rowKey: row.rowKey,
      identityValues: row.identityValues,
      compositionOffset: composition.offset,
    }
  }

  // Fail fast: resolve every target before any write begins, so a bad cell
  // cannot leave earlier cells committed behind a dangling pending state.
  const resolved = input.cells.map((cell) => ({
    cell,
    target: resolveSheetWriteTarget({
      composition,
      rowKey: cell.rowKey,
      columnId: cell.columnId,
    }),
  }))

  const datasetGroups = new Map<string, typeof resolved>()
  const recordGroups = new Map<string, typeof resolved>()
  const localCells: Array<{
    rowAddress: ReturnType<typeof rowAddressFor>
    cell: SheetCellWrite
  }> = []

  for (const entry of resolved) {
    if (entry.target.kind === 'dataset') {
      const key = `${entry.target.datasetId}:${entry.target.expectedDatasetRevision}`
      const group = datasetGroups.get(key) ?? []
      group.push(entry)
      datasetGroups.set(key, group)
    } else if (entry.target.kind === 'model') {
      const group = recordGroups.get(entry.target.recordId) ?? []
      group.push(entry)
      recordGroups.set(entry.target.recordId, group)
    } else {
      localCells.push({
        rowAddress: rowAddressFor(entry.cell.rowKey),
        cell: entry.cell,
      })
    }
  }

  // GRID-02: reject mixed-authority range operations before ANY write. The
  // dispatch below commits per group sequentially with no cross-group
  // atomicity, so a plan spanning more than one commit group (multiple
  // (dataset, expected revision) groups, multiple records, or a mix of
  // dataset/record/local targets) could commit one group and fail a later
  // one while the UI reports nothing was written. Fail closed instead.
  const commitGroupCount =
    datasetGroups.size + recordGroups.size + (localCells.length > 0 ? 1 : 0)
  if (commitGroupCount > 1) throw new SheetMixedAuthorityWriteError()

  const newUuid = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })

  // One commit per (dataset, expected revision) group, with ONE row entry per
  // canonical Dataset row — a rectangular paste writes the same rowId through
  // several columns, and those values must merge into a single update
  // operation (never multiple entries for the same row in one batch).
  for (const [key, group] of datasetGroups) {
    const [dataset, expectedDatasetRevision] = key.split(':')
    const rowsByRowId = new Map<
      string,
      {
        rowId: string
        expectedRevision: number
        values: Record<string, unknown>
      }
    >()
    for (const { cell, target } of group) {
      const t = target as Extract<SheetWriteTarget, { kind: 'dataset' }>
      let entry = rowsByRowId.get(t.rowId)
      if (!entry) {
        entry = {
          rowId: t.rowId,
          expectedRevision: t.expectedRowRevision,
          values: {},
        }
        rowsByRowId.set(t.rowId, entry)
      } else if (entry.expectedRevision !== t.expectedRowRevision) {
        // Two cells on the same row from the same snapshot must agree on the
        // row revision; a divergence means the composition is inconsistent.
        throw new Error('ambiguous_target')
      }
      entry.values[t.fieldId] = cell.value
    }
    const rows = [...rowsByRowId.values()].map(
      ({ rowId, expectedRevision, values }) => ({
        operation: 'update' as const,
        rowId,
        expectedRevision,
        values,
      }),
    )

    // GRID-02: bulk validation runs before the authoritative commit so a
    // rejected batch never reaches the write path. The server remains the
    // validation authority; this call surfaces its decision before writes.
    const validated = await client.rpc<{
      ok?: boolean
      errors?: Array<{ code: string }>
    }>('validate_dataset_row_batch', {
      p_dataset_id: dataset,
      p_expected_dataset_revision: Number(expectedDatasetRevision),
      p_rows: rows,
    })
    if (validated.ok === false) {
      throw new SheetBatchValidationError(validated.errors)
    }

    // GRID-02: the commit RPC also returns ok:false (instead of throwing)
    // when its internal validation fails — e.g. the dataset revision moved
    // between validate and commit. A silent ok:false would report
    // "Write-back saved." with nothing written; fail closed instead.
    const committed = await client.rpc<{
      ok?: boolean
      errors?: Array<{ code: string }>
    }>('commit_dataset_row_batch', {
      p_dataset_id: dataset,
      p_expected_dataset_revision: Number(expectedDatasetRevision),
      p_rows: rows,
      p_idempotency_key: `${input.retryToken}-${key.slice(0, 24)}`,
    })
    if (committed.ok === false) {
      throw new SheetBatchValidationError(committed.errors)
    }
  }

  // One update per record.
  for (const [recordId, group] of recordGroups) {
    const values: Record<string, unknown> = {}
    for (const { cell, target } of group) {
      const t = target as Extract<SheetWriteTarget, { kind: 'model' }>
      values[t.fieldName] = cell.value
    }
    const first = group[0]
    const t = (
      first as { target: Extract<SheetWriteTarget, { kind: 'model' }> }
    ).target
    await client.rpc('update_record_custom_fields', {
      p_record_id: recordId,
      p_expected_metadata_version: t.expectedMetadataVersion,
      p_values: values,
    })
  }

  // One local mutation for all local cells.
  if (localCells.length > 0) {
    await mutateSheetLocalState(
      {
        instanceId: composition.instanceId,
        expectedRevision: composition.revision,
        retryToken: newUuid(),
        rows: localCells.map(({ rowAddress }) => rowAddress),
        cells: localCells.map(({ cell, rowAddress }) => ({
          rowKey: rowAddress.rowKey,
          fieldId: cell.columnId,
          value: cell.value,
        })),
      },
      client,
    )
  }
}
