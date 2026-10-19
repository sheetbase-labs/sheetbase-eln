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
    rpc: vi.fn(async (_name?: string): Promise<unknown> => []),
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
      useRouteContext: () => ({ context: { workspace: { id: 'ws-1' } } }),
    }),
    Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
      <a href={typeof to === 'string' ? to : '#'}>{children}</a>
    ),
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

/**
 * Mount the results page against a router search state the test owns, so a
 * test can move the URL (`mocks.search`) and re-render the page exactly as a
 * navigation does.
 */
function mountSearch(search: Record<string, unknown> = {}) {
  mocks.search = search
  const SearchPage = Route.options.component as React.ComponentType
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const element = () => (
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>
  )
  const view = render(element())
  return {
    view,
    setUrl: (next: Record<string, unknown>) => {
      mocks.search = next
      view.rerender(element())
    },
  }
}

afterEach(() => {
  cleanup()
  mocks.rpc.mockReset()
  mocks.navigate.mockReset()
})

describe('Search results page (SRCH-02)', () => {
  it('reports a failed search as a failure, not as no matches, and retries it', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('search unavailable'))
    mountSearch({ q: 'plate' })

    expect(await screen.findByText('Search could not run')).toBeTruthy()
    expect(screen.queryByText(/No matches/)).toBeNull()

    mocks.rpc.mockImplementation(async () => [RECORD_ROW])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('EXP-0142')).toBeTruthy()
  })

  it('pushes the owner and the date range to the search service', async () => {
    mocks.rpc.mockImplementation(async (name: unknown) =>
      name === 'workspace_members_list'
        ? [{ user_id: 'user-1', name: 'Ada Lovelace', role: 'member' }]
        : [RECORD_ROW],
    )
    mountSearch({
      q: 'plate',
      owner: 'user-1',
      from: '2026-09-01',
      to: '2026-09-30',
    })

    expect(await screen.findByText('EXP-0142')).toBeTruthy()
    const calls = mocks.rpc.mock.calls as unknown as [
      string,
      Record<string, unknown>,
    ][]
    const searchCall = calls.find(([name]) => name === 'search')
    expect(searchCall?.[1]).toMatchObject({
      p_owner_id: 'user-1',
      p_date_from: '2026-09-01T00:00:00.000Z',
      p_date_to: '2026-09-30T23:59:59.999Z',
    })
    expect(
      (await screen.findAllByRole('option', { name: 'Ada Lovelace' })).length,
    ).toBeGreaterThan(0)
  })

  it('clears the 7-day shortcut when a date range is typed', async () => {
    mountSearch({ q: 'plate', updated: '7d' })
    await screen.findByText('EXP-0142').catch(() => undefined)
    fireEvent.change(screen.getAllByLabelText('From')[0], {
      target: { value: '2026-09-01' },
    })
    const call = mocks.navigate.mock.calls[0][0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>
    }
    expect(call.search({ q: 'plate', updated: '7d' })).toEqual({
      q: 'plate',
      updated: undefined,
      from: '2026-09-01',
    })
  })

  it('pushes a new query into the history so Back returns to the previous one', async () => {
    mountSearch()
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

  it('re-runs the search when the query changes, and follows it in the heading and rows', async () => {
    mocks.rpc.mockImplementation(async () => [
      { ...RECORD_ROW, identifier: 'EXP-0091', record_id: 'rec-2' },
    ])
    const { setUrl } = mountSearch({ q: 'clarification' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Results for “clarification”',
      }),
    ).toBeTruthy()
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({ p_query: 'clarification' }),
    )

    // A submitted query is a new URL; the page reads it rather than replaying
    // what it already had on screen.
    setUrl({ q: 'EXP-0091' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Results for “EXP-0091”',
      }),
    ).toBeTruthy()
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({ p_query: 'EXP-0091' }),
    )
    expect(screen.queryByText('Results for “clarification”')).toBeNull()
  })
})

describe('Search count and no-results state (QA3-search-1, QA3-search-2)', () => {
  it('states the whole match count, not the rows loaded so far', async () => {
    mocks.rpc.mockImplementation(async () => [
      { ...RECORD_ROW, total_count: '25' },
    ])
    mountSearch({ q: 'plate' })
    // The heading and the "All" facet both state the service's total.
    expect(await screen.findAllByText('25')).toHaveLength(2)
  })

  it('does not blame filters for a miss when only archived is on', async () => {
    mocks.rpc.mockImplementation(async () => [])
    mountSearch({ q: 'zzz', archived: true })
    // The scope is reversible from the panel, and no facet is set, so there is
    // no "Clear filters" that would change nothing.
    expect(
      await screen.findByRole('button', { name: 'Search active work only' }),
    ).toBeTruthy()
    expect(screen.queryByText('Nothing matches with these filters.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('keeps Clear filters when a facet emptied the list, and it clears it', async () => {
    mocks.rpc.mockImplementation(async () => [])
    mountSearch({ q: 'zzz', type: ['Records'] })
    expect(
      await screen.findByText('Nothing matches with these filters.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    const call = mocks.navigate.mock.calls.at(-1)?.[0] as {
      search: (previous: Record<string, unknown>) => Record<string, unknown>
    }
    expect(call.search({ type: ['Records'] })).toEqual({
      type: undefined,
      project: undefined,
      updated: undefined,
    })
  })
})
