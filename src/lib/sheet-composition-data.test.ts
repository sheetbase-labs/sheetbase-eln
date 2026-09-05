import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import { rowIdentityKey } from './row-identity'
import {
  fetchComposedSheetRows,
  mergeComposedSheetSnapshots,
} from './sheet-composition-data'
import type { ComposedSheetSnapshot } from './sheet-composition-data'

const ID = '20000000-0000-4000-8000-000000000001'
const ROW = '20000000-0000-4000-8000-000000000002'

describe('fetchComposedSheetRows', () => {
  it('maps the bounded RPC response and derives the existing sb-row-v1 key', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return {
          instanceId: ID,
          revision: 2,
          offset: 3,
          limit: 25,
          hasMore: true,
          localFieldIds: [],
          identity: {
            kind: 'source',
            columnIds: [ID],
            logicalTypes: ['reference'],
          },
          rows: [
            {
              identityValues: [ROW],
              sources: [
                {
                  sourceKind: 'dataset',
                  bindingId: ID,
                  datasetId: ID,
                  datasetRevision: 1,
                  rowId: ROW,
                  revision: 1,
                  matched: true,
                  values: { [ID]: ROW },
                },
              ],
            },
          ],
        }
      },
    } as unknown as DataClient

    const result = await fetchComposedSheetRows(
      ID,
      { limit: 25, offset: 3 },
      client,
    )

    expect(calls).toEqual([
      {
        name: 'query_sheet_instance_rows',
        args: { p_instance_id: ID, p_limit: 25, p_offset: 3 },
      },
    ])
    expect(result.rows[0].rowKey).toBe(
      rowIdentityKey(
        { kind: 'source', columnIds: [ID], logicalTypes: ['reference'] },
        [ROW],
      ),
    )
  })
})

describe('mergeComposedSheetSnapshots', () => {
  it('concatenates pages and takes hasMore from the last page', () => {
    const page = (offset: number, hasMore: boolean) =>
      ({
        instanceId: ID,
        revision: 1,
        offset,
        limit: 200,
        hasMore,
        localFieldIds: [],
        rows: [{ rowKey: `sb-row-v1:row-${offset}`, compositionOffset: offset }],
        boundProjection: {
          columns: [{ id: 'col' }],
          rows: [{ rowKey: `sb-row-v1:row-${offset}`, values: {} }],
        },
      }) as unknown as ComposedSheetSnapshot
    const merged = mergeComposedSheetSnapshots([
      page(0, true),
      page(200, false),
    ])
    expect(merged?.rows.map((row) => row.rowKey)).toEqual([
      'sb-row-v1:row-0',
      'sb-row-v1:row-200',
    ])
    expect(merged?.hasMore).toBe(false)
    expect(merged?.offset).toBe(0)
    expect(merged?.boundProjection?.rows.map((row) => row.rowKey)).toEqual([
      'sb-row-v1:row-0',
      'sb-row-v1:row-200',
    ])
    expect(mergeComposedSheetSnapshots([])).toBeNull()
  })
})
