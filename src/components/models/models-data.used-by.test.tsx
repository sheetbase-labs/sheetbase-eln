import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createDataClient } from '#/lib/data-client'

import { useRecordModelUsedBy } from './models-data'

describe('useRecordModelUsedBy', () => {
  it('reads the link type and date the database returns', async () => {
    const requests: URL[] = []

    const client = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      requests.push(url)

      return Response.json([
        {
          link_type: 'sample',
          created_at: '2026-11-05T10:00:00Z',
          source: {
            id: 's1',
            identifier: 'CON-0007',
            title: 'pAAV',
            kind: 'construct',
          },
        },
      ])
    })

    const queryClient = new QueryClient()

    const { result } = renderHook(() => useRecordModelUsedBy('r1', client), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data?.[0]).toMatchObject({
      linkType: 'sample',
      createdAt: '2026-11-05T10:00:00Z',
    })
    expect(requests[0]?.pathname).toBe('/api/db/record_links')
    expect(requests[0]?.searchParams.get('target_record_id')).toBe('eq.r1')
    expect(requests[0]?.searchParams.get('select')).toBe(
      'link_type,created_at,source:source_record_id(id,identifier,title,kind)',
    )
    expect(requests[0]?.searchParams.get('order')).toBe('created_at.desc')
    queryClient.clear()
  })
})
