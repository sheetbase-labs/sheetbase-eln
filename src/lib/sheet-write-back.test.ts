import { describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../tests/fixtures/sheet-definition'
import type { DataClient } from './data-client'
import { fetchComposedSheetRows } from './sheet-composition-data'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import {
  resolveSheetWriteTarget,
  sheetCellWriteError,
  writeSheetCell,
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
})
