import { describe, expect, it, vi } from 'vitest'

import {
  commitSheetRecordBatch,
  composedSheetRecordLinkBatchRows,
  createAndLinkSheetRecord,
} from './sheet-record-commit'

describe('Sheet Record create and commit clients', () => {
  it('calls the atomic create+link RPC with a write-back target', async () => {
    const rpc = vi.fn().mockResolvedValue({
      ok: true,
      recordId: '11111111-1111-4111-8111-111111111111',
      identifier: 'SMP-2026-0001',
      notebookRecordLink: false,
    })
    await createAndLinkSheetRecord(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        modelKey: 'sample',
        title: 'LV harvest',
        customFields: { note: 'cold' },
        writeTarget: {
          kind: 'dataset',
          datasetId: '33333333-3333-4333-8333-333333333333',
          rowId: '44444444-4444-4444-8444-444444444444',
          fieldId: '55555555-5555-4555-8555-555555555555',
          expectedDatasetRevision: 1,
          expectedRowRevision: 1,
        },
      },
      { rpc } as never,
    )
    expect(rpc).toHaveBeenCalledWith(
      'create_and_link_sheet_record',
      expect.objectContaining({
        p_model_key: 'sample',
        p_title: 'LV harvest',
      }),
    )
    expect(rpc.mock.calls[0][0]).not.toBe('create_record_link')
  })

  it('commits a batch with one idempotency key rather than one HTTP create per row', async () => {
    const rpc = vi.fn().mockResolvedValue({ ok: true, mutated: true, rows: [] })
    await commitSheetRecordBatch(
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        modelKey: 'sample',
        idempotencyKey: 'retry-1',
        rows: [{ rowKey: 'a' }, { rowKey: 'b' }],
      },
      { rpc } as never,
    )
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'commit_sheet_record_batch',
      expect.objectContaining({ p_idempotency_key: 'retry-1' }),
    )
  })

  it('does not invent link rows when composition cannot resolve a write-back target', () => {
    expect(
      composedSheetRecordLinkBatchRows({
        instanceId: '30000000-0000-4000-8000-000000000010',
        revision: 1,
        offset: 0,
        limit: 50,
        hasMore: false,
        localFieldIds: [],
        identity: {
          kind: 'source',
          columnIds: ['10000000-0000-4000-8000-000000000001'],
          logicalTypes: ['reference'],
        },
        rows: [],
        boundProjection: {
          columns: [
            {
              id: '10000000-0000-4000-8000-000000000001',
              key: 'sample',
              label: 'Sample',
              presentation: { kind: 'record-picker', inputType: 'text' },
              permission: { editability: 'editable' },
            },
          ],
          rows: [
            {
              rowKey: 'sb-row-v1:abc',
              values: {
                '10000000-0000-4000-8000-000000000001': {
                  kind: 'present',
                  value: '11111111-1111-4111-8111-111111111111',
                },
              },
            },
          ],
        },
      } as never),
    ).toEqual([])
  })
})
