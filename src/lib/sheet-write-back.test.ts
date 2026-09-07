import { describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../tests/fixtures/sheet-definition'
import type { DataClient } from './data-client'
import { fetchComposedSheetRows } from './sheet-composition-data'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import {
  resolveSheetWriteTarget,
  SheetBatchValidationError,
  SheetMixedAuthorityWriteError,
  sheetCellWriteError,
  writeSheetCell,
  writeSheetCells,
} from './sheet-write-back'

const INSTANCE = '30000000-0000-4000-8000-000000000010'
const VERSION = '30000000-0000-4000-8000-000000000011'
const DATASET = '30000000-0000-4000-8000-000000000012'
const ROW = '30000000-0000-4000-8000-000000000013'
const RECORD = '30000000-0000-4000-8000-000000000014'
const LOCAL_FIELD = '30000000-0000-4000-8000-000000000015'
const TOKEN = '30000000-0000-4000-8000-000000000016'

const configuration = validSheetDefinitionConfiguration()
const mappedColumn = configuration.columns[0]
const unmappedColumn = configuration.columns[1]
const calculatedColumn = configuration.columns[2]
const mappedSource = (() => {
  if (mappedColumn.source.kind !== 'bound')
    throw new Error('invalid test fixture')
  return mappedColumn.source
})()

function clientWithRpc(rpc: DataClient['rpc']): DataClient {
  return { rpc } as unknown as DataClient
}

function datasetWire(matched = true) {
  return {
    instanceId: INSTANCE,
    definitionVersionId: VERSION,
    definitionConfiguration: configuration,
    revision: 6,
    offset: 4,
    limit: 50,
    hasMore: false,
    localFieldIds: [LOCAL_FIELD],
    identity: {
      kind: 'source',
      columnIds: [mappedColumn.id],
      logicalTypes: ['reference'],
    },
    rows: [
      {
        identityValues: [RECORD],
        sources: [
          {
            sourceKind: 'dataset',
            bindingId: mappedSource.bindingId,
            datasetId: DATASET,
            datasetRevision: 9,
            rowId: matched ? ROW : null,
            revision: matched ? 4 : null,
            matched,
            values: matched ? { [mappedSource.sourceFieldId]: RECORD } : {},
          },
          {
            sourceKind: 'dataset',
            bindingId:
              unmappedColumn.source.kind === 'bound'
                ? unmappedColumn.source.bindingId
                : VERSION,
            datasetId: DATASET,
            datasetRevision: 9,
            rowId: null,
            revision: null,
            matched: false,
            values: {},
          },
        ],
      },
    ],
  }
}

function recordWire() {
  return {
    ...datasetWire(),
    rows: [
      {
        identityValues: [RECORD],
        sources: [
          {
            sourceKind: 'record',
            bindingId: mappedSource.bindingId,
            recordId: RECORD,
            metadataVersion: 3,
            fieldNames: {
              [mappedSource.sourceFieldId]: 'stable_sample_field',
            },
            matched: true,
            values: { [mappedSource.sourceFieldId]: RECORD },
          },
          datasetWire().rows[0].sources[1],
        ],
      },
    ],
  }
}

async function snapshot(wire: unknown): Promise<ComposedSheetSnapshot> {
  return fetchComposedSheetRows(
    INSTANCE,
    {},
    clientWithRpc(vi.fn().mockResolvedValue(wire)),
  )
}

// PLAT-05 batching: a second Dataset-bound column on the same binding/row.
const SECOND_FIELD = '40000000-0000-4000-8000-000000000010'
const SECOND_COLUMN = '30000000-0000-4000-8000-000000000030'

function twoColumnConfiguration() {
  const configuration = validSheetDefinitionConfiguration()
  configuration.columns.push({
    id: SECOND_COLUMN,
    field: {
      fieldId: SECOND_COLUMN,
      key: 'second_value',
      label: 'Second value',
      description: null,
      logicalType: 'text',
      nullable: true,
      defaultValue: null,
      cardinality: 'one',
      quantity: null,
      validation: {},
      category: null,
      relationship: null,
      computation: { mode: 'stored' },
      lifecycle: 'active',
    },
    source: {
      kind: 'bound',
      bindingId: configuration.bindings[0].id,
      sourceFieldId: SECOND_FIELD,
    },
  })
  configuration.writeBackRules[0].mappings.push({
    columnId: SECOND_COLUMN,
    targetFieldId: SECOND_FIELD,
  })
  configuration.presentation.columnOrder.push(SECOND_COLUMN)
  return parseSheetDefinitionConfiguration(configuration)
}

function twoColumnDatasetWire(matched = true) {
  const config = twoColumnConfiguration()
  return {
    instanceId: INSTANCE,
    definitionVersionId: VERSION,
    definitionConfiguration: config,
    revision: 6,
    offset: 4,
    limit: 50,
    hasMore: false,
    localFieldIds: [LOCAL_FIELD],
    identity: {
      kind: 'source',
      columnIds: [config.columns[0].id],
      logicalTypes: ['reference'],
    },
    rows: [
      {
        identityValues: [RECORD],
        sources: [
          {
            sourceKind: 'dataset',
            bindingId: config.bindings[0].id,
            datasetId: DATASET,
            datasetRevision: 9,
            rowId: matched ? ROW : null,
            revision: matched ? 4 : null,
            matched,
            values: {
              [mappedSource.sourceFieldId]: RECORD,
              [SECOND_FIELD]: 'second-value',
            },
          },
          datasetWire(matched).rows[0].sources[1],
        ],
      },
    ],
  }
}

// GRID-02 mixed-authority rejection: a second writable binding with its own
// Dataset, so a range operation can span two authoritative commit groups.
const DATASET_B = '30000000-0000-4000-8000-000000000019'
const ROW_B = '30000000-0000-4000-8000-000000000020'
const RECORD_B = '30000000-0000-4000-8000-000000000021'

const secondColumnSource = (() => {
  if (unmappedColumn.source.kind !== 'bound')
    throw new Error('invalid test fixture')
  return unmappedColumn.source
})()

function twoWritableBindingConfiguration() {
  const configuration = validSheetDefinitionConfiguration()
  configuration.writeBackRules.push({
    id: '70000000-0000-4000-8000-000000000002',
    bindingId: configuration.bindings[1].id,
    mode: 'update',
    mappings: [
      {
        columnId: unmappedColumn.id,
        targetFieldId: secondColumnSource.sourceFieldId,
      },
    ],
  })
  return parseSheetDefinitionConfiguration(configuration)
}

function twoWritableBindingWire(
  secondSource:
    | {
        sourceKind: 'dataset'
        datasetId: string
        rowId: string
        revision: number
        datasetRevision: number
      }
    | {
        sourceKind: 'record'
        recordId: string
        metadataVersion: number
        fieldName: string
      },
) {
  const config = twoWritableBindingConfiguration()
  return {
    instanceId: INSTANCE,
    definitionVersionId: VERSION,
    definitionConfiguration: config,
    revision: 6,
    offset: 4,
    limit: 50,
    hasMore: false,
    localFieldIds: [LOCAL_FIELD],
    identity: {
      kind: 'source' as const,
      columnIds: [config.columns[0].id],
      logicalTypes: ['reference' as const],
    },
    rows: [
      {
        identityValues: [RECORD],
        sources: [
          {
            sourceKind: 'dataset' as const,
            bindingId: config.bindings[0].id,
            datasetId: DATASET,
            datasetRevision: 9,
            rowId: ROW,
            revision: 4,
            matched: true,
            values: { [mappedSource.sourceFieldId]: RECORD },
          },
          secondSource.sourceKind === 'dataset'
            ? {
                sourceKind: 'dataset' as const,
                bindingId: config.bindings[1].id,
                datasetId: secondSource.datasetId,
                datasetRevision: secondSource.datasetRevision,
                rowId: secondSource.rowId,
                revision: secondSource.revision,
                matched: true,
                values: {
                  [secondColumnSource.sourceFieldId]: 'b-value',
                },
              }
            : {
                sourceKind: 'record' as const,
                bindingId: config.bindings[1].id,
                recordId: secondSource.recordId,
                metadataVersion: secondSource.metadataVersion,
                fieldNames: {
                  [secondColumnSource.sourceFieldId]: secondSource.fieldName,
                },
                matched: true as const,
                values: {
                  [secondColumnSource.sourceFieldId]: 'b-value',
                },
              },
        ],
      },
    ],
  }
}

function twoDatasetWire() {
  return twoWritableBindingWire({
    sourceKind: 'dataset',
    datasetId: DATASET_B,
    rowId: ROW_B,
    revision: 7,
    datasetRevision: 8,
  })
}

function datasetAndRecordWire() {
  return twoWritableBindingWire({
    sourceKind: 'record',
    recordId: RECORD_B,
    metadataVersion: 2,
    fieldName: 'stable_sample_field',
  })
}

describe('composed Sheet write-back', () => {
  it('parses authoritative Dataset and Record CAS provenance before resolving stable targets', async () => {
    const dataset = await snapshot(datasetWire())
    expect(
      resolveSheetWriteTarget({
        composition: dataset,
        rowKey: dataset.rows[0].rowKey,
        columnId: mappedColumn.id,
      }),
    ).toMatchObject({
      kind: 'dataset',
      datasetId: DATASET,
      rowId: ROW,
      expectedDatasetRevision: 9,
      expectedRowRevision: 4,
    })

    const record = await snapshot(recordWire())
    expect(
      resolveSheetWriteTarget({
        composition: record,
        rowKey: record.rows[0].rowKey,
        columnId: mappedColumn.id,
      }),
    ).toMatchObject({
      kind: 'model',
      recordId: RECORD,
      fieldName: 'stable_sample_field',
      expectedMetadataVersion: 3,
    })

    const missingRecordAuthority = recordWire()
    delete (
      missingRecordAuthority.rows[0].sources[0] as { metadataVersion?: number }
    ).metadataVersion
    await expect(snapshot(missingRecordAuthority)).rejects.toThrow()
  })

  it('dispatches exact Dataset, Model and active local payloads from the snapshot', async () => {
    const dataset = await snapshot(datasetWire())
    const datasetRpc = vi.fn().mockResolvedValue({ ok: true })
    const datasetInput = {
      composition: dataset,
      rowKey: dataset.rows[0].rowKey,
      columnId: mappedColumn.id,
      retryToken: TOKEN,
      value: RECORD,
    }
    await writeSheetCell(datasetInput, clientWithRpc(datasetRpc))
    await writeSheetCell(datasetInput, clientWithRpc(datasetRpc))
    expect(datasetRpc).toHaveBeenNthCalledWith(1, 'commit_dataset_row_batch', {
      p_dataset_id: DATASET,
      p_expected_dataset_revision: 9,
      p_rows: [
        {
          operation: 'update',
          rowId: ROW,
          expectedRevision: 4,
          values: { [mappedSource.sourceFieldId]: RECORD },
        },
      ],
      p_idempotency_key: TOKEN,
    })
    expect(datasetRpc.mock.calls[1]).toEqual(datasetRpc.mock.calls[0])

    const record = await snapshot(recordWire())
    const recordRpc = vi.fn().mockResolvedValue({})
    await writeSheetCell(
      {
        ...datasetInput,
        composition: record,
        rowKey: record.rows[0].rowKey,
      },
      clientWithRpc(recordRpc),
    )
    expect(recordRpc).toHaveBeenCalledWith('update_record_custom_fields', {
      p_record_id: RECORD,
      p_expected_metadata_version: 3,
      p_values: { stable_sample_field: RECORD },
    })

    const localRpc = vi.fn().mockRejectedValue(new Error('stop after dispatch'))
    await expect(
      writeSheetCell(
        {
          ...datasetInput,
          columnId: LOCAL_FIELD,
        },
        clientWithRpc(localRpc),
      ),
    ).rejects.toThrow('stop after dispatch')
    expect(localRpc).toHaveBeenCalledWith(
      'mutate_sheet_instance_local_state',
      expect.objectContaining({
        p_instance_id: INSTANCE,
        p_expected_revision: 6,
        p_retry_token: TOKEN,
        p_rows: [
          expect.objectContaining({
            kind: 'composed',
            rowKey: dataset.rows[0].rowKey,
            identityValues: [RECORD],
            compositionOffset: 4,
          }),
        ],
        p_cells: [
          {
            rowKey: dataset.rows[0].rowKey,
            fieldId: LOCAL_FIELD,
            value: RECORD,
          },
        ],
      }),
    )
  })

  it('rejects duplicate mappings, ambiguous rows, unmapped, unmatched, calculated and inactive-local targets', async () => {
    const duplicate = structuredClone(configuration)
    duplicate.writeBackRules[0].mappings.push({
      columnId: unmappedColumn.id,
      targetFieldId: mappedSource.sourceFieldId,
    })
    expect(() => parseSheetDefinitionConfiguration(duplicate)).toThrow(
      'only one write-back mapping',
    )

    const dataset = await snapshot(datasetWire())
    const resolve = (composition: ComposedSheetSnapshot, columnId: string) =>
      resolveSheetWriteTarget({
        composition,
        rowKey: composition.rows[0].rowKey,
        columnId,
      })
    expect(() => resolve(dataset, unmappedColumn.id)).toThrow(
      'unresolved_target',
    )
    expect(() => resolve(dataset, calculatedColumn.id)).toThrow(
      'calculated_read_only',
    )
    expect(() => resolve(dataset, VERSION)).toThrow('unresolved_target')
    expect(() =>
      resolve(
        { ...dataset, rows: [...dataset.rows, dataset.rows[0]] },
        mappedColumn.id,
      ),
    ).toThrow('ambiguous_target')
    const unmatched = await snapshot(datasetWire(false))
    expect(() => resolve(unmatched, mappedColumn.id)).toThrow(
      'unresolved_target',
    )
  })

  it('maps denied, invalid, stale and conflict server failures to cell state', () => {
    expect(
      sheetCellWriteError(
        Object.assign(new Error('denied'), { code: '42501' }),
      ),
    ).toBe('permission_denied')
    expect(sheetCellWriteError(new Error('invalid type'))).toBe('invalid_value')
    expect(
      sheetCellWriteError(
        Object.assign(new Error('metadata version mismatch'), {
          code: 'SB001',
        }),
      ),
    ).toBe('stale')
    expect(
      sheetCellWriteError(
        Object.assign(new Error('retry token reused'), { code: '23505' }),
      ),
    ).toBe('conflict')
  })

  it('batches multi-cell write-back into one commit per dataset (PLAT-05)', async () => {
    const RECORD2 = '30000000-0000-4000-8000-000000000017'
    const ROW2 = '30000000-0000-4000-8000-000000000018'
    const base = datasetWire()
    const twoRows = {
      ...base,
      rows: [
        base.rows[0],
        {
          ...base.rows[0],
          identityValues: [RECORD2],
          sources: [
            {
              ...base.rows[0].sources[0],
              rowId: ROW2,
              revision: 5,
              values: { [mappedSource.sourceFieldId]: RECORD2 },
            },
            base.rows[0].sources[1],
          ],
        },
      ],
    }
    const composition = await snapshot(twoRows)
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    await writeSheetCells(
      {
        composition,
        cells: [
          {
            rowKey: composition.rows[0].rowKey,
            columnId: mappedColumn.id,
            value: RECORD,
          },
          {
            rowKey: composition.rows[1].rowKey,
            columnId: mappedColumn.id,
            value: RECORD2,
          },
        ],
        retryToken: TOKEN,
      },
      clientWithRpc(rpc),
    )
    // One grouped commit instead of one RPC per cell (plus GRID-02 validate).
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('commit_dataset_row_batch', {
      p_dataset_id: DATASET,
      p_expected_dataset_revision: 9,
      p_rows: [
        {
          operation: 'update',
          rowId: ROW,
          expectedRevision: 4,
          values: { [mappedSource.sourceFieldId]: RECORD },
        },
        {
          operation: 'update',
          rowId: ROW2,
          expectedRevision: 5,
          values: { [mappedSource.sourceFieldId]: RECORD2 },
        },
      ],
      p_idempotency_key: expect.stringContaining(TOKEN),
    })
    // GRID-02: the same batch shape is validated before the commit.
    expect(rpc).toHaveBeenNthCalledWith(1, 'validate_dataset_row_batch', {
      p_dataset_id: DATASET,
      p_expected_dataset_revision: 9,
      p_rows: [
        {
          operation: 'update',
          rowId: ROW,
          expectedRevision: 4,
          values: { [mappedSource.sourceFieldId]: RECORD },
        },
        {
          operation: 'update',
          rowId: ROW2,
          expectedRevision: 5,
          values: { [mappedSource.sourceFieldId]: RECORD2 },
        },
      ],
    })
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'commit_dataset_row_batch',
      expect.anything(),
    )
  })

  it('groups record-bound cells per record and keeps single-record batches atomic', async () => {
    const record = await snapshot(recordWire())
    const rpc = vi.fn().mockResolvedValue({})
    await writeSheetCells(
      {
        composition: record,
        cells: [
          {
            rowKey: record.rows[0].rowKey,
            columnId: mappedColumn.id,
            value: RECORD,
          },
        ],
        retryToken: TOKEN,
      },
      clientWithRpc(rpc),
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('update_record_custom_fields', {
      p_record_id: RECORD,
      p_expected_metadata_version: 3,
      p_values: { stable_sample_field: RECORD },
    })
  })

  it('validates the bulk batch before the authoritative commit (GRID-02)', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === 'validate_dataset_row_batch') {
        return Promise.resolve({
          ok: false,
          errors: [{ code: 'invalid_value', rowId: ROW }],
        })
      }
      return Promise.resolve({ ok: true })
    })
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            {
              rowKey: composition.rows[0].rowKey,
              columnId: mappedColumn.id,
              value: RECORD,
            },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toThrow('sheet_batch_validation_failed')
    // The authoritative commit must not run when validation rejects.
    expect(rpc).not.toHaveBeenCalledWith(
      'commit_dataset_row_batch',
      expect.anything(),
    )
  })

  it('fails fast before any write when a cell target is unresolvable', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi.fn().mockResolvedValue({})
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            {
              rowKey: composition.rows[0].rowKey,
              columnId: mappedColumn.id,
              value: RECORD,
            },
            {
              rowKey: composition.rows[0].rowKey,
              columnId: unmappedColumn.id,
              value: 'x',
            },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toThrow('unresolved_target')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('merges multiple Dataset columns on the same row into one row entry (PLAT-05)', async () => {
    const composition = await snapshot(twoColumnDatasetWire())
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    const rowKey = composition.rows[0].rowKey
    await writeSheetCells(
      {
        composition,
        cells: [
          { rowKey, columnId: mappedColumn.id, value: RECORD },
          { rowKey, columnId: SECOND_COLUMN, value: 'second-value' },
        ],
        retryToken: TOKEN,
      },
      clientWithRpc(rpc),
    )
    // GRID-02: one validate + one commit for the grouped batch.
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('commit_dataset_row_batch', {
      p_dataset_id: DATASET,
      p_expected_dataset_revision: 9,
      p_rows: [
        {
          operation: 'update',
          rowId: ROW,
          expectedRevision: 4,
          values: {
            [mappedSource.sourceFieldId]: RECORD,
            [SECOND_FIELD]: 'second-value',
          },
        },
      ],
      p_idempotency_key: expect.stringContaining(TOKEN),
    })
  })

  it('merges a multi-row × multi-column paste into one entry per row (PLAT-05)', async () => {
    const RECORD2 = '30000000-0000-4000-8000-000000000017'
    const ROW2 = '30000000-0000-4000-8000-000000000018'
    const base = twoColumnDatasetWire()
    const wire = {
      ...base,
      rows: [
        base.rows[0],
        {
          ...base.rows[0],
          identityValues: [RECORD2],
          sources: [
            {
              ...base.rows[0].sources[0],
              rowId: ROW2,
              revision: 5,
              values: {
                [mappedSource.sourceFieldId]: RECORD2,
                [SECOND_FIELD]: 'row2-second',
              },
            },
            base.rows[0].sources[1],
          ],
        },
      ],
    }
    const composition = await snapshot(wire)
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    await writeSheetCells(
      {
        composition,
        cells: [
          {
            rowKey: composition.rows[0].rowKey,
            columnId: mappedColumn.id,
            value: RECORD,
          },
          {
            rowKey: composition.rows[0].rowKey,
            columnId: SECOND_COLUMN,
            value: 'second-value',
          },
          {
            rowKey: composition.rows[1].rowKey,
            columnId: mappedColumn.id,
            value: RECORD2,
          },
          {
            rowKey: composition.rows[1].rowKey,
            columnId: SECOND_COLUMN,
            value: 'row2-second',
          },
        ],
        retryToken: TOKEN,
      },
      clientWithRpc(rpc),
    )
    // 4 cells → 1 validate + 1 commit with exactly 2 row entries (one per row).
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('commit_dataset_row_batch', {
      p_dataset_id: DATASET,
      p_expected_dataset_revision: 9,
      p_rows: [
        {
          operation: 'update',
          rowId: ROW,
          expectedRevision: 4,
          values: {
            [mappedSource.sourceFieldId]: RECORD,
            [SECOND_FIELD]: 'second-value',
          },
        },
        {
          operation: 'update',
          rowId: ROW2,
          expectedRevision: 5,
          values: {
            [mappedSource.sourceFieldId]: RECORD2,
            [SECOND_FIELD]: 'row2-second',
          },
        },
      ],
      p_idempotency_key: expect.stringContaining(TOKEN),
    })
  })

  it('rejects a mixed Dataset + local range operation before any RPC (GRID-02)', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    const rowKey = composition.rows[0].rowKey
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            { rowKey, columnId: mappedColumn.id, value: RECORD },
            { rowKey, columnId: LOCAL_FIELD, value: 'local' },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toBeInstanceOf(SheetMixedAuthorityWriteError)
    // Nothing was attempted: no validate, no commit, no local mutation.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still dispatches a pure-local batch as a single mutation (GRID-02)', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi
      .fn()
      .mockRejectedValue(new Error('stop after local dispatch'))
    const rowKey = composition.rows[0].rowKey
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            { rowKey, columnId: LOCAL_FIELD, value: 'local-1' },
            { rowKey, columnId: LOCAL_FIELD, value: 'local-2' },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toThrow('stop after local dispatch')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'mutate_sheet_instance_local_state',
      expect.objectContaining({
        p_instance_id: INSTANCE,
        p_expected_revision: 6,
        p_cells: [
          { rowKey, fieldId: LOCAL_FIELD, value: 'local-1' },
          { rowKey, fieldId: LOCAL_FIELD, value: 'local-2' },
        ],
      }),
    )
  })
})

describe('GRID-02 mixed-authority rejection', () => {
  it('maps a mixed-authority rejection to the canonical cell error code', () => {
    expect(sheetCellWriteError(new SheetMixedAuthorityWriteError())).toBe(
      'mixed_authority_write',
    )
  })

  it('rejects Dataset A + Dataset B before any commit, even when each would validate', async () => {
    const composition = await snapshot(twoDatasetWire())
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    const rowKey = composition.rows[0].rowKey
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            { rowKey, columnId: mappedColumn.id, value: 'a-value' },
            { rowKey, columnId: unmappedColumn.id, value: 'b-value' },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toThrow(
      'Range operation rejected: it spans more than one authoritative target; nothing was written.',
    )
    // Sequential per-dataset commits are no longer attempted: no validate,
    // no commit, for either dataset.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects Dataset + Record before any commit', async () => {
    const composition = await snapshot(datasetAndRecordWire())
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    const rowKey = composition.rows[0].rowKey
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            { rowKey, columnId: mappedColumn.id, value: 'a-value' },
            { rowKey, columnId: unmappedColumn.id, value: 'b-value' },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toBeInstanceOf(SheetMixedAuthorityWriteError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects Dataset + local even when the bound batch would fail validation — nothing is written', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === 'validate_dataset_row_batch')
        return Promise.resolve({
          ok: false,
          errors: [{ code: 'invalid_value' }],
        })
      return Promise.resolve({ ok: true })
    })
    const rowKey = composition.rows[0].rowKey
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            { rowKey, columnId: mappedColumn.id, value: RECORD },
            { rowKey, columnId: LOCAL_FIELD, value: 'local' },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toBeInstanceOf(SheetMixedAuthorityWriteError)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('GRID-02 review fixes', () => {
  it('treats a commit that returns ok:false as a rejected write, not success', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === 'validate_dataset_row_batch')
        return Promise.resolve({ ok: true })
      return Promise.resolve({
        ok: false,
        errors: [{ code: 'stale_row_revision', rowId: ROW }],
      })
    })
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            {
              rowKey: composition.rows[0].rowKey,
              columnId: mappedColumn.id,
              value: RECORD,
            },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toThrow('sheet_batch_validation_failed')
  })

  it('propagates a validate→commit revision race as a rejected batch', async () => {
    const composition = await snapshot(datasetWire())
    const rpc = vi
      .fn()
      .mockImplementation((name: string) =>
        name === 'validate_dataset_row_batch'
          ? Promise.resolve({ ok: true })
          : Promise.resolve({ ok: false }),
      )
    await expect(
      writeSheetCells(
        {
          composition,
          cells: [
            {
              rowKey: composition.rows[0].rowKey,
              columnId: mappedColumn.id,
              value: RECORD,
            },
          ],
          retryToken: TOKEN,
        },
        clientWithRpc(rpc),
      ),
    ).rejects.toBeInstanceOf(SheetBatchValidationError)
  })
})
