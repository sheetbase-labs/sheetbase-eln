/**
 * SRCH-02 — the Search results page.
 *
 * A search that fails is reported as a failure, with a retry: it is never
 * rendered as a genuine miss with a did-you-mean. A new query is a new place in
 * the history, so the browser's Back button returns to the previous one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { z } from 'zod'

import { Route } from './search'
import type * as router from '@tanstack/react-router'
import { dropSharedReads } from '#/lib/data-client'

/** The URL state `useSearch` hands the page. */
type SearchState = ReturnType<typeof Route.useSearch>

/** What the page hands `navigate`. */
interface SearchNavigation {
  to?: string
  replace?: boolean
  search: (previous: SearchState) => SearchState
}

/** The router context the page reads: where it is, and where it sends people. */
interface PageDouble {
  navigate: Mock<(options: SearchNavigation) => void>
  search: SearchState
}

/** One call the app made through the `/api/db` transport. */
interface TransportCall {
  path: string
  method: string
  body: string | null
}

/** What the fake transport answers with, and what the app asked it for. */
interface TransportState {
  calls: TransportCall[]
  /** Rows per `/api/db` resource, in the app's own wire shape. */
  rows: Record<string, unknown[]>
  /** Reply per RPC name, as PostgREST would return it. */
  rpc: Record<string, z.core.util.JSONType>
  /** RPC names that answer 500 this many more times. */
  failOnce: Record<string, number>
}

/**
 * The two seams these cases fake. The data transport is faked at `/api/db`, so
 * the real client runs underneath. The router is a double because the page is a
 * file route bound to the generated route tree at build time.
 */
const mocks = vi.hoisted(() => {
  const state: TransportState = {
    calls: [],
    rows: {},
    rpc: {},
    failOnce: {},
  }

  const page: PageDouble = {
    navigate: vi.fn<(options: SearchNavigation) => void>(),
    search: {},
  }

  globalThis.fetch = async (input, init) => {
    const url = new URL(
      z
        .union([z.string(), z.instanceof(URL), z.instanceof(Request)])
        .transform((value) => {
          if (value instanceof URL) return value.toString()

          if (value instanceof Request) return value.url

          return value
        })
        .parse(input),
      'http://localhost',
    )

    const sent = z.string().safeParse(init?.body ?? null)

    state.calls.push({
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
      body: sent.success ? sent.data : null,
    })

    if (url.pathname.startsWith('/api/db/rpc/')) {
      const name = url.pathname.slice('/api/db/rpc/'.length)

      if ((state.failOnce[name] ?? 0) > 0) {
        state.failOnce[name] = (state.failOnce[name] ?? 0) - 1

        return new Response(
          JSON.stringify({ message: `${name} unavailable` }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response(JSON.stringify(state.rpc[name] ?? null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const resource = url.pathname.slice('/api/db/'.length)
    const rows = state.rows[resource] ?? []

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range':
          rows.length === 0 ? '*/0' : `0-${rows.length - 1}/${rows.length}`,
      },
    })
  }

  return { page, transport: state }
})

const page = mocks.page
const transport = mocks.transport

/** Every argument the page sent to one RPC, newest last. */
function rpcCalls(name: string): Array<z.core.util.JSONType | null> {
  return transport.calls
    .filter((call) => call.path === `/api/db/rpc/${name}`)
    .map((call) => (call.body === null ? null : JSON.parse(call.body)))
}

// The file route's factory is bound to the generated route tree at build time.
// oxlint-disable-next-line anti-slop/no-module-mocking -- `createFileRoute` is bound to the generated route tree at build time, so this suite renders the route component directly and supplies the router context the shell would; the factory only stores the options it is given.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()

  /** The options the file-route factory receives; the mock stores them. */
  type FileRouteOptions = Parameters<
    ReturnType<typeof router.createFileRoute>
  >[0]

  return {
    ...actual,
    // The route object the module holds: `useSearch`/`useNavigate` read the
    // state this test sets, so no router is mounted.
    createFileRoute: () => (options: FileRouteOptions) => ({
      options,
      useSearch: () => page.search,
      useNavigate: () => page.navigate,
      useRouteContext: () => ({
        context: { user: { id: 'u-1' }, workspace: { id: 'ws-1' } },
      }),
    }),
    Link: ({ to, children }: React.ComponentProps<'a'> & { to?: string }) => (
      <a href={to ?? '#'}>{children}</a>
    ),
    redirect: (options: { to: string }) => options,
  }
})

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

/** The page resolves a result's project id to its name through this lookup. */
const PROJECTS = [{ id: 'project-a', title: 'Process Development' }]

/**
 * Mount the results page against a router search state the test owns, so a
 * test can move the URL (`page.search`) and re-render the page exactly as a
 * navigation does.
 */
function mountSearch(search: SearchState = {}) {
  page.search = search
  const SearchPage = Route.options.component

  if (!SearchPage) throw new Error('the search route has no component')

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
    setUrl: (next: SearchState) => {
      page.search = next
      view.rerender(element())
    },
  }
}

afterEach(() => {
  cleanup()
  // The client shares reads for a second: two cases wire different rows for
  // the same table, so each must start from an empty cache.
  dropSharedReads()
  transport.calls.length = 0
  transport.rows = {}
  transport.rpc = {}
  transport.failOnce = {}
  page.navigate.mockReset()
})

describe('Search results page (SRCH-02)', () => {
  it('reports a failed search as a failure, not as no matches, and retries it', async () => {
    transport.failOnce = { search: 1 }
    transport.rpc = { search: [RECORD_ROW], workspace_members_list: [] }
    transport.rows = { projects: PROJECTS }
    mountSearch({ q: 'plate' })

    expect(await screen.findByText('Search couldn’t run')).toBeTruthy()
    expect(screen.queryByText(/No matches/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findAllByText('EXP-0142')).length).toBeGreaterThan(0)
  })

  it('pushes the owner and the date range to the search service', async () => {
    transport.rpc = {
      workspace_members_list: [
        { user_id: 'user-1', name: 'Ada Lovelace', role: 'member' },
      ],
      search: [RECORD_ROW],
    }
    transport.rows = { projects: PROJECTS }
    mountSearch({
      q: 'plate',
      owner: 'user-1',
      from: '2026-09-01',
      to: '2026-09-30',
    })

    expect((await screen.findAllByText('EXP-0142')).length).toBeGreaterThan(0)

    expect(rpcCalls('search')[0]).toMatchObject({
      p_owner_id: 'user-1',
      p_date_from: '2026-09-01T00:00:00.000Z',
      p_date_to: '2026-09-30T23:59:59.999Z',
    })
    expect(
      await screen.findByRole('button', { name: /Owner: Ada Lovelace/ }),
    ).toBeTruthy()
  })

  it('shows a date range as a chip that removes it', async () => {
    mountSearch({ q: 'plate', from: '2026-09-01', to: '2026-09-30' })
    await screen.findAllByText('EXP-0142').catch(() => undefined)
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove the date range' }),
    )

    const call = page.navigate.mock.calls.at(-1)?.[0]

    expect(
      call?.search({ q: 'plate', from: '2026-09-01', to: '2026-09-30' }),
    ).toEqual({ q: 'plate', from: undefined, to: undefined })
  })

  it('pushes a new query into the history so Back returns to the previous one', async () => {
    mountSearch()
    const input = screen.getAllByPlaceholderText('Search everything')[0]
    fireEvent.change(input, { target: { value: 'plate' } })
    const form = input.closest('form')

    if (!form) throw new Error('the search box is not in a form')

    fireEvent.submit(form)

    await waitFor(() => expect(page.navigate).toHaveBeenCalledTimes(1))

    const call = page.navigate.mock.calls[0][0]

    expect(call.to).toBe('/search')
    expect(call.replace).toBeUndefined()
    expect(call.search({ q: 'earlier' })).toEqual({ q: 'plate' })
  })

  it('turns type:sample -project:"AAV8 TFF" typed in the box into filters', async () => {
    transport.rows = { projects: [{ id: 'project-a', title: 'AAV8 TFF' }] }
    mountSearch()
    const input = screen.getAllByPlaceholderText('Search everything')[0]
    fireEvent.change(input, {
      target: { value: 'buffer type:sample -project:"AAV8 TFF"' },
    })
    const form = input.closest('form')

    if (!form) throw new Error('the search box is not in a form')

    fireEvent.submit(form)

    await waitFor(() => expect(page.navigate).toHaveBeenCalledTimes(1))

    const call = page.navigate.mock.calls[0][0]

    expect(call.search({})).toEqual({
      q: 'buffer',
      filter: {
        g: 'AND',
        k: [
          { f: 'type', o: 'eq', v: 'sample' },
          { g: 'NOT', k: [{ f: 'project', o: 'eq', v: 'project-a' }] },
        ],
      },
    })
  })

  it('sends the filter in the URL and the sort to the search service, and shows it as chips', async () => {
    mountSearch({
      q: 'buffer',
      sort: 'updated',
      filter: {
        g: 'AND',
        k: [
          { f: 'status', o: 'eq', v: 'approved' },
          { g: 'NOT', k: [{ f: 'tags', o: 'contains', v: 'old' }] },
        ],
      },
    })
    await waitFor(() =>
      expect(rpcCalls('search')).toContainEqual(
        expect.objectContaining({
          p_query: 'buffer',
          p_sort: 'updated',
          p_filter: {
            type: 'group',
            combinator: 'AND',
            children: [
              {
                type: 'condition',
                field: 'status',
                operator: 'eq',
                value: 'approved',
              },
              {
                type: 'group',
                combinator: 'NOT',
                children: [
                  {
                    type: 'condition',
                    field: 'tags',
                    operator: 'contains',
                    value: 'old',
                  },
                ],
              },
            ],
          },
        }),
      ),
    )
    expect(await screen.findByText(/None of/)).toBeTruthy()
  })

  it('re-runs the search when the query changes, and follows it in the heading and rows', async () => {
    transport.rpc = {
      search: [{ ...RECORD_ROW, identifier: 'EXP-0091', record_id: 'rec-2' }],
    }
    transport.rows = { projects: PROJECTS }
    const { setUrl } = mountSearch({ q: 'clarification' })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Results for “clarification”',
      }),
    ).toBeTruthy()
    expect(rpcCalls('search')).toContainEqual(
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
    expect(rpcCalls('search')).toContainEqual(
      expect.objectContaining({ p_query: 'EXP-0091' }),
    )
    expect(screen.queryByText('Results for “clarification”')).toBeNull()
  })
})

describe('Search count and no-results state (QA3-search-1, QA3-search-2)', () => {
  it('states the whole match count, not the rows loaded so far', async () => {
    transport.rpc = { search: [{ ...RECORD_ROW, total_count: '25' }] }
    transport.rows = { projects: PROJECTS }
    mountSearch({ q: 'plate' })
    // The service's total is stated, with how many are on screen so far; the
    // "All" facet states the whole of it.
    expect(await screen.findByText('1 of 25')).toBeTruthy()
    expect(screen.getAllByText('25')).toHaveLength(1)
  })

  it('does not blame filters for a miss when only archived is on', async () => {
    transport.rpc = { search: [] }
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
    transport.rpc = { search: [] }
    mountSearch({ q: 'zzz', type: ['Records'] })
    expect(
      await screen.findByText('Nothing matches with these filters.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    const call = page.navigate.mock.calls.at(-1)?.[0]

    expect(call?.search({ type: ['Records'] })).toEqual({
      type: undefined,
      project: undefined,
      updated: undefined,
    })
  })

  it('counts the types and projects from the server, not the rows loaded', async () => {
    // One page holds a single row, but the server knows of 268 matches.
    transport.rpc = {
      search_facets: [
        {
          result_type: 'record',
          kind: 'experiment',
          project_id: 'project-a',
          in_text: false,
          match_count: '268',
        },
      ],
      search: [{ ...RECORD_ROW, total_count: 268 }],
    }
    transport.rows = { projects: PROJECTS }
    mountSearch({ q: 'a' })

    const types = await screen.findByRole('navigation', { name: 'Type' })
    await waitFor(() => expect(types.textContent).toContain('268'))
    expect(types.textContent).toContain('Records')
    expect(types.textContent).toContain('268')
    expect(types.textContent).not.toContain('+')
    expect(rpcCalls('search_facets')).toContainEqual(
      expect.objectContaining({ p_query: 'a' }),
    )
  })
})
