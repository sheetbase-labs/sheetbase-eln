import { describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../tests/fixtures/sheet-definition'
import type { DataClient } from './data-client'
import { RECORD_REFERENCE_CELL_FORMAT } from './record-reference-cell'
import { fetchComposedSheetRows } from './sheet-composition-data'
import {
  linkSheetRecordReference,
  unlinkSheetRecordReference,
} from './sheet-record-link'

const INSTANCE = '30000000-0000-4000-8000-000000000010'
const VERSION = '30000000-0000-4000-8000-000000000011'
const DATASET = '30000000-0000-4000-8000-000000000012'
const ROW = '30000000-0000-4000-8000-000000000013'
const RECORD = '30000000-0000-4000-8000-000000000014'
const LOCAL_FIELD = '30000000-0000-4000-8000-000000000015'
const TOKEN = '30000000-0000-4000-8000-000000000016'
const SAMPLE = '11111111-1111-4111-8111-111111111111'

const configuration = validSheetDefinitionConfiguration()
const mappedColumn = configuration.columns[0]
const mappedSource = (() => {
  if (mappedColumn.source.kind !== 'bound')
    throw new Error('invalid test fixture')
  return mappedColumn.source
})()

const contract = {
  format: RECORD_REFERENCE_CELL_FORMAT,
  targetModelKey: 'sample',
  nullable: true,
  cardinality: 'one' as const,
  readOnly: false,
  writeTarget: { kind: 'dataset' as const },
}

function clientWithRpc(rpc: DataClient['rpc']): DataClient {
  return { rpc } as unknown as DataClient
}

async function composition() {
  return fetchComposedSheetRows(
    INSTANCE,
    {},
    clientWithRpc(
      vi.fn().mockResolvedValue({
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
                rowId: ROW,
                revision: 4,
                matched: true,
                values: { [mappedSource.sourceFieldId]: RECORD },
              },
              {
                sourceKind: 'dataset',
                bindingId:
                  configuration.columns[1].source.kind === 'bound'
                    ? configuration.columns[1].source.bindingId
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
      }),
    ),
  )
}

describe('Sheet Record link write-back', () => {
  it('writes the Record UUID to the Sheet target and never creates a notebook link', async () => {
    const snapshot = await composition()
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    await linkSheetRecordReference(
      {
        composition: snapshot,
        rowKey: snapshot.rows[0].rowKey,
        columnId: mappedColumn.id,
        retryToken: TOKEN,
        contract,
        record: {
          recordId: SAMPLE,
          modelKey: 'sample',
          archived: false,
          deleted: false,
        },
      },
      clientWithRpc(rpc),
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'commit_dataset_row_batch',
      expect.objectContaining({
        p_rows: [
          expect.objectContaining({
            values: { [mappedSource.sourceFieldId]: SAMPLE },
          }),
        ],
      }),
    )
    expect(
      rpc.mock.calls.some((call) => call[0] === 'create_record_link'),
    ).toBe(false)
  })

  it('unlinks by writing null through the same target', async () => {
    const snapshot = await composition()
    const rpc = vi.fn().mockResolvedValue({ ok: true })
    await unlinkSheetRecordReference(
      {
        composition: snapshot,
        rowKey: snapshot.rows[0].rowKey,
        columnId: mappedColumn.id,
        retryToken: TOKEN,
        contract,
      },
      clientWithRpc(rpc),
    )
    expect(rpc).toHaveBeenCalledWith(
      'commit_dataset_row_batch',
      expect.objectContaining({
        p_rows: [
          expect.objectContaining({
            values: { [mappedSource.sourceFieldId]: null },
          }),
        ],
      }),
    )
  })
})
