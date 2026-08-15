import { describe, expect, it, vi } from 'vitest'

import { searchSheetRecords } from './sheet-record-search'

describe('Sheet Record search', () => {
  it('requests a bounded Model-scoped search and does not load a full registry', async () => {
    const rpc = vi.fn().mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'sample',
        identifier: 'SMP-2026-0001',
        title: 'LV harvest',
        status: 'available',
        archived: false,
      },
    ])
    const hits = await searchSheetRecords(
      { modelKey: 'sample', query: 'SMP-2026-0001', limit: 200 },
      { rpc } as never,
    )
    expect(rpc).toHaveBeenCalledWith('search_sheet_records', {
      p_model_key: 'sample',
      p_query: 'SMP-2026-0001',
      p_limit: 50,
      p_include_archived: false,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('11111111-1111-4111-8111-111111111111')
  })
})
