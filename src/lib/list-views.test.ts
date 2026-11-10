import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { z } from 'zod'

import { LIST_VIEW_SAVE_MS, toListViewChoice, useListView } from './list-views'
import { createDataClient } from './data-client'

afterEach(cleanup)

describe('toListViewChoice', () => {
  it('has no choice when nothing is stored', () => {
    expect(toListViewChoice(undefined)).toEqual({ sorting: [], hidden: [] })
  })

  it('reads a stored sorting and hidden columns', () => {
    expect(
      toListViewChoice({
        sorting: [{ id: 'name', desc: true }],
        hidden_columns: ['type', 'location'],
      }),
    ).toEqual({
      sorting: [{ id: 'name', desc: true }],
      hidden: ['type', 'location'],
    })
  })

  it('treats anything malformed as no choice instead of breaking the table', () => {
    expect(
      toListViewChoice({
        sorting: [{ id: 5 }, null, 'x', { id: 'ok' }],
        hidden_columns: [1, 'type', null],
      }),
    ).toEqual({ sorting: [{ id: 'ok', desc: false }], hidden: ['type'] })
    expect(toListViewChoice({ sorting: 'x', hidden_columns: {} })).toEqual({
      sorting: [],
      hidden: [],
    })
  })

  it('filters independently before the four-sort cap and preserves hidden duplicates and empty strings', () => {
    expect(
      toListViewChoice({
        sorting: [
          null,
          { id: 'a', desc: true },
          false,
          { id: 'b', desc: 1 },
          { id: 'c', desc: 'true' },
          { id: 'd' },
          { id: 'e', desc: true },
        ],
        hidden_columns: ['', 'x', 'x', false],
      }),
    ).toEqual({
      sorting: [
        { id: 'a', desc: true },
        { id: 'b', desc: false },
        { id: 'c', desc: false },
        { id: 'd', desc: false },
      ],
      hidden: ['', 'x', 'x'],
    })
  })

  it('accepts native arrays with sorting properties', () => {
    const entry = Object.assign([], { id: 'array-property', desc: true })
    expect(toListViewChoice({ sorting: [entry], hidden_columns: [] })).toEqual({
      sorting: [{ id: 'array-property', desc: true }],
      hidden: [],
    })
  })

  it.each(['changed', 42])(
    'preserves two native id reads before desc, including an unchecked second value %s',
    (second) => {
      const order: string[] = []
      let reads = 0

      const entry = {
        get id() {
          order.push('id')

          return ++reads === 1 ? 'first' : second
        },
        get desc() {
          order.push('desc')

          return true
        },
      }

      expect(
        toListViewChoice({ sorting: [entry], hidden_columns: [] }),
      ).toEqual({ sorting: [{ id: second, desc: true }], hidden: [] })
      expect(order).toEqual(['id', 'id', 'desc'])
    },
  )

  it('propagates a second-read throw without reading desc', () => {
    const order: string[] = []
    const error = new Error('second id read')
    let reads = 0

    const entry = {
      get id() {
        order.push('id')

        if (++reads === 1) return 'first'
        throw error
      },
      get desc() {
        order.push('desc')

        return true
      },
    }

    expect(() =>
      toListViewChoice({ sorting: [entry], hidden_columns: [] }),
    ).toThrow(error)
    expect(order).toEqual(['id', 'id'])
  })
})

function listViewHarness(fetchImpl: typeof fetch) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  const client = createDataClient(fetchImpl)

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)

  return { client, wrapper }
}

const savedChoice = z.object({
  p_list_key: z.string(),
  p_sorting: z.array(z.object({ id: z.string(), desc: z.boolean() })),
  p_hidden_columns: z.array(z.string()),
})

describe('remembered list views over the real HTTP client', () => {
  it('loads and roundtrips sorting/hidden changes as one debounced write', async () => {
    const writes: z.infer<typeof savedChoice>[] = []
    const requests: string[] = []

    const { client, wrapper } = listViewHarness(async (input, init) => {
      const path = input instanceof Request ? input.url : input.toString()
      requests.push(`${init?.method} ${path}`)

      if (init?.method === 'GET')
        return Response.json([
          { sorting: [{ id: 'name', desc: true }], hidden_columns: ['status'] },
        ])
      writes.push(savedChoice.parse(await new Response(init?.body).json()))

      return Response.json(null)
    })

    const { result, unmount } = renderHook(
      () => useListView('sample / IDs', client),
      { wrapper },
    )

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.sorting).toEqual([{ id: 'name', desc: true }])
    expect(result.current.hidden).toEqual(['status'])
    expect(requests).toEqual([
      'GET /api/db/list_views?list_key=eq.sample%20%2F%20IDs&select=sorting,hidden_columns&limit=1',
    ])
    act(() => {
      result.current.setSorting([{ id: 'created', desc: false }])
      result.current.setSorting((current) => [
        ...current,
        { id: 'name', desc: true },
      ])
      result.current.setHidden((current) => [...current, 'location'])
    })
    await waitFor(() =>
      expect(result.current.sorting).toEqual([
        { id: 'created', desc: false },
        { id: 'name', desc: true },
      ]),
    )
    expect(result.current.hidden).toEqual(['status', 'location'])
    expect(writes).toEqual([])
    await waitFor(
      () =>
        expect(writes).toEqual([
          {
            p_list_key: 'sample / IDs',
            p_sorting: [
              { id: 'created', desc: false },
              { id: 'name', desc: true },
            ],
            p_hidden_columns: ['status', 'location'],
          },
        ]),
      { timeout: LIST_VIEW_SAVE_MS + 1000 },
    )
    expect(requests.at(-1)).toBe('POST /api/db/rpc/set_list_view')
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes).toHaveLength(1)
  })

  it('keeps local choices after refused reads/writes and flushes pending reset on unmount', async () => {
    const writes: z.infer<typeof savedChoice>[] = []

    const { client, wrapper } = listViewHarness(async (_input, init) => {
      if (init?.method !== 'GET')
        writes.push(savedChoice.parse(await new Response(init?.body).json()))

      return Response.json(
        { error: { code: 'forbidden', message: 'Not permitted' } },
        { status: 403 },
      )
    })

    const { result, unmount } = renderHook(
      () => useListView('samples', client),
      { wrapper },
    )

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.sorting).toEqual([])
    act(() => {
      result.current.setHidden(['', 'status', 'status'])
    })
    await waitFor(() => expect(writes).toHaveLength(1), {
      timeout: LIST_VIEW_SAVE_MS + 1000,
    })
    expect(result.current.hidden).toEqual(['', 'status', 'status'])
    act(() => {
      result.current.reset()
    })
    await waitFor(() => expect(result.current.hidden).toEqual([]))
    unmount()
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1]).toEqual({
      p_list_key: 'samples',
      p_sorting: [],
      p_hidden_columns: [],
    })
  })

  it('does not let an in-flight stored choice overwrite a local choice', async () => {
    let release = () => {}

    const response = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          Response.json([
            {
              sorting: [{ id: 'name', desc: true }],
              hidden_columns: ['status'],
            },
          ]),
        )
    })

    const { client, wrapper } = listViewHarness((_input, init) =>
      init?.method === 'GET' ? response : Promise.resolve(Response.json(null)),
    )

    const { result } = renderHook(() => useListView('samples', client), {
      wrapper,
    })

    expect(result.current.ready).toBe(false)
    act(() => {
      result.current.setHidden(['location'])
    })
    await act(async () => {
      release()
    })
    await waitFor(() => expect(result.current.hidden).toEqual(['location']))
    expect(result.current.sorting).toEqual([])
  })
})
