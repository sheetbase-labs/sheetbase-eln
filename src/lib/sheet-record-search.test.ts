import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createDataClient } from './data-client'
import { searchSheetRecords } from './sheet-record-search'

describe('Sheet Record search', () => {
  it('requests a bounded Model-scoped search and does not load a full registry', async () => {
    const calls: { path: string; args: z.infer<ReturnType<typeof z.json>> }[] =
      []

    const client = createDataClient(async (input, init) => {
      expect(input instanceof Request ? input.url : input.toString()).toBe(
        '/api/db/rpc/search_sheet_records',
      )
      expect(init?.method).toBe('POST')
      calls.push({
        path: '/api/db/rpc/search_sheet_records',
        args: z.json().parse(await new Response(init?.body).json()),
      })

      return Response.json([
        {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'sample',
          identifier: 'SMP-2026-0001',
          title: 'LV harvest',
          status: 'available',
          archived: false,
        },
      ])
    })

    const hits = await searchSheetRecords(
      { modelKey: 'sample', query: 'SMP-2026-0001', limit: 200 },
      client,
    )

    expect(calls).toEqual([
      {
        path: '/api/db/rpc/search_sheet_records',
        args: {
          p_model_key: 'sample',
          p_query: 'SMP-2026-0001',
          p_limit: 50,
          p_include_archived: false,
        },
      },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('11111111-1111-4111-8111-111111111111')
  })
})
