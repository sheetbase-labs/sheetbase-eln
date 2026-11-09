import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { useRecordModelUsedBy } from './models-data'

describe('useRecordModelUsedBy', () => {
  it('reads the link type and date the database returns', async () => {
    const client = {
      list: async () => [
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
      ],
    } as unknown as DataClient

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
  })
})
