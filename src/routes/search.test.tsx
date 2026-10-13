/**
 * SRCH-02 — the Search results page.
 *
 * A search that fails is reported as a failure, with a retry: it is never
 * rendered as a genuine miss with a did-you-mean. A new query is a new place in
 * the history, so the browser's Back button returns to the previous one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './search'
import type * as router from '@tanstack/react-router'

const mocks = vi.hoisted(() => {
  const search: Record<string, unknown> = {}
  return {
    rpc: vi.fn(async (): Promise<unknown> => []),
    navigate: vi.fn(),
    search,
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    // The route object the module holds: `useSearch`/`useNavigate` read the
    // state this test sets, so no router is mounted.
    createFileRoute: () => (options: unknown) => ({
      options,
      useSearch: () => mocks.search,
      useNavigate: () => mocks.navigate,
    }),
    Link: ({
      to,
      children,
    }: {
      to?: unknown
      children?: React.ReactNode
    }) => <a href={typeof to === 'string' ? to : '#'}>{children}</a>,
    redirect: (options: unknown) => options,
  }
})

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: vi.fn(async () => []), rpc: mocks.rpc },
}))

vi.mock('#/components/v3/experiments/experiments-data', () => ({
  // The page resolves a result's project id to its name through this map.
  useProjectNameMap: () => ({
    data: new Map([['project-a', 'Process Development']]),
  }),
}))

/** A search row in the wire shape the RPC returns. */
const RECORD_ROW = {
  result_type: 'record',
  record_id: 'rec-1',
  kind: 'experiment',
  identifier: 'EXP-0142',
  title: 'Plate reader run',
  status: 'approved',
  project_id: 'project-a',
  archived: false,
  created_by_user_id: 'user-1',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
  matched_context: 'plate reader run',
  matched_field: 'title',
  rank: 0.5,
  deep_link: '/records/rec-1',
  total_count: 1,
}

function renderSearch(search: Record<string, unknown> = {}) {
  mocks.search = search
  const SearchPage = Route.options.component as React.ComponentType
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SearchPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  mocks.rpc.mockReset()
  mocks.navigate.mockReset()
})

describe('Search results page (SRCH-02)', () => {
  it('reports a failed search as a failure, not as no matches, and retries it', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('search unavailable'))
    renderSearch({ q: 'plate' })

    expect(await screen.findByText('Search could not run')).toBeTruthy()
    expect(screen.queryByText(/No matches/)).toBeNull()

    mocks.rpc.mockImplementation(async () => [RECORD_ROW])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('EXP-0142')).toBeTruthy()
  })

  it('pushes a new query into the history so Back returns to the previous one', async () => {
    renderSearch()
    const input = screen.getAllByPlaceholderText('Search everything')[0]
    fireEvent.change(input, { target: { value: 'plate' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    const call = mocks.navigate.mock.calls[0][0] as {
      to: string
      replace?: boolean
      search: (previous: Record<string, unknown>) => Record<string, unknown>
    }
    expect(call.to).toBe('/search')
    expect(call.replace).toBeUndefined()
    expect(call.search({ q: 'earlier' })).toEqual({ q: 'plate' })
  })
})
