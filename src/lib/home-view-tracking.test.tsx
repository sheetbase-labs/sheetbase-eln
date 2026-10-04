import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { notebookDataClient } from './notebook-data'
import { useRecentViewTracking } from './recents'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Home project-view authority', () => {
  function setup(objectId: string | null) {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const hook = renderHook(() => useRecentViewTracking('project', objectId), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    return { ...hook, invalidate }
  }

  it('invalidates personal Home state only after the canonical view is recorded', async () => {
    let complete: (value: string) => void = () => {}
    const recorded = new Promise<string>((resolve) => {
      complete = resolve
    })
    const rpc = vi.spyOn(notebookDataClient, 'rpc').mockReturnValue(recorded)
    const { invalidate } = setup('00000000-0000-4000-8000-000000000320')
    expect(rpc).toHaveBeenCalledWith('record_recent_view', {
      p_object_kind: 'project',
      p_object_id: '00000000-0000-4000-8000-000000000320',
    })
    expect(invalidate).not.toHaveBeenCalled()
    complete('2026-09-25T09:30:00Z')
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3))
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [['recents'], ['home-recents'], ['home-first-run-project-opens']],
    )
  })

  it.each(['ignored', 'denied'])(
    'does not infer an open when tracking is %s',
    async (outcome) => {
      const rpc = vi.spyOn(notebookDataClient, 'rpc')
      if (outcome === 'ignored') rpc.mockResolvedValue(null)
      else rpc.mockRejectedValue(new Error('permission denied'))
      const { invalidate } = setup('00000000-0000-4000-8000-000000000320')
      await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce())
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(invalidate).not.toHaveBeenCalled()
    },
  )

  it('does not record a view before a readable canonical project is resolved', () => {
    const rpc = vi.spyOn(notebookDataClient, 'rpc')
    const { invalidate } = setup(null)
    expect(rpc).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
