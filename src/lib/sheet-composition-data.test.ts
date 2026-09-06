import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { rowIdentityKey } from './row-identity'
import {
  fetchComposedSheetPaged,
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

describe('fetchComposedSheetPaged', () => {
  function stubPage(
    offset: number,
    options: { revision: number; hasMore: boolean; keys: string[] },
  ): ComposedSheetSnapshot {
    return {
      instanceId: ID,
      revision: options.revision,
      offset,
      limit: Math.max(1, options.keys.length),
      hasMore: options.hasMore,
      localFieldIds: [],
      identity: {
        kind: 'source',
        columnIds: [ID],
        logicalTypes: ['reference'],
      },
      rows: options.keys.map((rowKey) => ({
        rowKey,
        compositionOffset: offset,
        identityValues: [rowKey],
        sources: [],
      })),
      boundProjection: {
        columns: [{ id: 'col' }],
        rows: options.keys.map((rowKey) => ({ rowKey, values: {} })),
      },
    } as unknown as ComposedSheetSnapshot
  }

  it('fetches only the missing window per page — 3 pages cost exactly 3 fetches', async () => {
    const offsets: number[] = []
    const fetchPage = async (offset: number) => {
      offsets.push(offset)
      const page = offset / 2
      return stubPage(offset, {
        revision: 7,
        hasMore: page < 2,
        keys: [`k${page}a`, `k${page}b`],
      })
    }

    const first = await fetchComposedSheetPaged(ID, {
      pageCount: 1,
      pageSize: 2,
      fetchPage,
    })
    expect(first.fetchedPages).toBe(1)
    expect(first.restarted).toBe(false)
    expect(first.notice).toBeNull()
    expect(first.pinnedRevision).toBe(7)

    const second = await fetchComposedSheetPaged(ID, {
      pageCount: 2,
      pageSize: 2,
      previous: first.snapshot,
      previousPageCount: 1,
      fetchPage,
    })
    expect(second.fetchedPages).toBe(1)
    expect(second.restarted).toBe(false)

    const third = await fetchComposedSheetPaged(ID, {
      pageCount: 3,
      pageSize: 2,
      previous: second.snapshot,
      previousPageCount: 2,
      fetchPage,
    })
    expect(third.fetchedPages).toBe(1)

    // Linear, never triangular: one fetch per page at the next offset.
    expect(offsets).toEqual([0, 2, 4])
    expect(third.snapshot.rows.map((row) => row.rowKey)).toEqual([
      'k0a',
      'k0b',
      'k1a',
      'k1b',
      'k2a',
      'k2b',
    ])
    expect(third.snapshot.boundProjection?.rows.map((row) => row.rowKey)).toEqual([
      'k0a',
      'k0b',
      'k1a',
      'k1b',
      'k2a',
      'k2b',
    ])
    expect(third.snapshot.hasMore).toBe(false)
    expect(third.snapshot.offset).toBe(0)
    expect(third.snapshot.revision).toBe(7)
  })

  it('skips fetching once the previous merge ran dry', async () => {
    const fetchPage = vi.fn(async () =>
      stubPage(0, { revision: 7, hasMore: false, keys: ['k'] }),
    )
    const first = await fetchComposedSheetPaged(ID, {
      pageCount: 1,
      pageSize: 2,
      fetchPage,
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    const again = await fetchComposedSheetPaged(ID, {
      pageCount: 2,
      pageSize: 2,
      previous: first.snapshot,
      previousPageCount: 1,
      fetchPage,
    })
    expect(again.fetchedPages).toBe(0)
    expect(again.snapshot).toBe(first.snapshot)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('restarts from offset 0 with a notice when the revision moves mid-paging', async () => {
    // Offset 0 pins revision 7; the next window observes revision 8 (a
    // concurrent Dataset/Record change). After the restart every window
    // serves revision 8.
    const offsets: number[] = []
    let moved = false
    const fetchPage = async (offset: number) => {
      offsets.push(offset)
      if (!moved) {
        if (offset === 0) {
          return stubPage(0, {
            revision: 7,
            hasMore: true,
            keys: ['old-a', 'old-b'],
          })
        }
        moved = true
        return stubPage(offset, {
          revision: 8,
          hasMore: true,
          keys: ['new-c', 'new-d'],
        })
      }
      return stubPage(offset, {
        revision: 8,
        hasMore: true,
        keys: offset === 0 ? ['new-a', 'new-b'] : ['new-c', 'new-d'],
      })
    }

    const loaded = await fetchComposedSheetPaged(ID, {
      pageCount: 2,
      pageSize: 2,
      fetchPage,
    })

    expect(loaded.restarted).toBe(true)
    expect(loaded.notice).toMatch(/changed while loading/i)
    expect(loaded.pinnedRevision).toBe(8)
    expect(loaded.snapshot.revision).toBe(8)
    // Coherent new-revision rows only: nothing from revision 7 survives, so
    // offset drift can neither duplicate nor skip rows.
    expect(loaded.snapshot.rows.map((row) => row.rowKey)).toEqual([
      'new-a',
      'new-b',
      'new-c',
      'new-d',
    ])
    expect(offsets).toEqual([0, 2, 0, 2])
  })

  it('restarts the incremental path too when a later window moves revision', async () => {
    const previous = stubPage(0, {
      revision: 7,
      hasMore: true,
      keys: ['old-a', 'old-b'],
    })
    const offsets: number[] = []
    let servedRestart = false
    const fetchPage = async (offset: number) => {
      offsets.push(offset)
      if (!servedRestart && offset !== 0) {
        servedRestart = true
        return stubPage(offset, {
          revision: 8,
          hasMore: true,
          keys: ['new-c', 'new-d'],
        })
      }
      return stubPage(offset, {
        revision: 8,
        hasMore: true,
        keys: offset === 0 ? ['new-a', 'new-b'] : ['new-c', 'new-d'],
      })
    }

    const loaded = await fetchComposedSheetPaged(ID, {
      pageCount: 2,
      pageSize: 2,
      previous,
      previousPageCount: 1,
      fetchPage,
    })

    // The stale cached window is discarded, never merged across revisions.
    expect(loaded.restarted).toBe(true)
    expect(loaded.notice).toMatch(/changed while loading/i)
    expect(loaded.snapshot.rows.map((row) => row.rowKey)).toEqual([
      'new-a',
      'new-b',
      'new-c',
      'new-d',
    ])
    expect(offsets).toEqual([2, 0, 2])
  })

  it('falls back to a coherent first window when the revision keeps moving', async () => {
    const offsets: number[] = []
    let revision = 7
    const fetchPage = async (offset: number) => {
      offsets.push(offset)
      revision += 1
      return stubPage(offset, {
        revision,
        hasMore: true,
        keys: [`r${revision}-a`, `r${revision}-b`],
      })
    }

    const loaded = await fetchComposedSheetPaged(ID, {
      pageCount: 3,
      pageSize: 2,
      fetchPage,
    })

    expect(loaded.restarted).toBe(true)
    expect(loaded.notice).toMatch(/changed while loading/i)
    // One coherent window at the latest revision; bounded fetches, no loop.
    expect(loaded.snapshot.revision).toBe(loaded.pinnedRevision)
    expect(loaded.snapshot.rows.map((row) => row.rowKey)).toEqual([
      'r12-a',
      'r12-b',
    ])
    expect(loaded.snapshot.hasMore).toBe(true)
    expect(offsets).toEqual([0, 2, 0, 2, 0])
  })
})
