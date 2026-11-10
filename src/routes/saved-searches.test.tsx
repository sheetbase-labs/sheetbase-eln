import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as router from '@tanstack/react-router'

import type { SavedSearchFacets } from '#/lib/search'

import { Route } from './saved-searches'

/** What the page's route hands createFileRoute: its component. */
interface SavedSearchesRouteOptions {
  component: () => React.JSX.Element
}

/** One `saved_searches` row as PostgREST returns it. */
interface SavedSearchRow {
  id: string
  name: string
  query: string
  facets: SavedSearchFacets | null
  created_at: string
  visibility?: 'private' | 'workspace'
  user_id?: string
}

const mocks = vi.hoisted(() => {
  const rows: SavedSearchRow[] = []

  return {
    rows,
    list: vi.fn(),
    rpc: vi.fn(),
    navigate: vi.fn(),
    role: 'scientist',
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- the page builds its route with the router's createFileRoute at import time, so the route's context and navigation are the only seam a unit test has; every other router export stays real.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()

  return {
    ...actual,
    createFileRoute:
      () =>
      <Options extends SavedSearchesRouteOptions>(options: Options) => ({
        options,
        useRouteContext: () => ({
          context: {
            user: { id: 'u-me' },
            workspace: { id: 'ws-1', role: mocks.role },
          },
        }),
      }),
    useNavigate: () => mocks.navigate,
    redirect: <Options,>(options: Options) => options,
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- the page reads through the shared notebookDataClient module instance and takes no client parameter, so that client is the only seam; the test asserts the queries and RPCs the real hooks issue.
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: mocks.list, rpc: mocks.rpc },
}))

const PageOption = Route.options.component

if (!PageOption) throw new Error('the route declares its component')

const Page = PageOption

function row(over: Partial<SavedSearchRow>): SavedSearchRow {
  return {
    id: 's-1',
    name: 'Buffers',
    query: 'buffer',
    facets: { text: 'buffer' },
    created_at: '2026-10-29T12:00:00Z',
    visibility: 'private',
    user_id: 'u-me',
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
  mocks.role = 'scientist'
  mocks.rows = [
    row({}),
    row({
      id: 's-2',
      name: 'Ana’s plates',
      query: 'plate',
      facets: { text: 'plate' },
      visibility: 'workspace',
      user_id: 'u-ana',
    }),
    row({
      id: 's-3',
      name: 'Team runs',
      query: 'run',
      visibility: 'workspace',
    }),
  ]
  mocks.list.mockImplementation(async () => mocks.rows)
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'workspace_members_list')
      return [{ user_id: 'u-ana', name: 'Ana', role: 'member' }]

    if (name === 'delete_saved_search')
      mocks.rows = mocks.rows.filter((r) => r.id !== args.p_id)

    return null
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  )
}

describe('saved searches page', () => {
  it('lists every search with who can see it and who saved it', async () => {
    mount()
    expect(await screen.findByText('Ana’s plates')).toBeTruthy()
    expect(screen.getByText('Buffers')).toBeTruthy()
    expect(screen.getAllByText('Everyone in the workspace')).toHaveLength(2)
    expect(await screen.findByText('Ana')).toBeTruthy()
  })

  it('narrows the list by words and by who can see it', async () => {
    mount()
    await screen.findByText('Ana’s plates')
    fireEvent.change(screen.getByLabelText('Show'), {
      target: { value: 'mine' },
    })
    expect(screen.queryByText('Ana’s plates')).toBeNull()
    expect(screen.getByText('Buffers')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Show'), {
      target: { value: 'all' },
    })
    fireEvent.change(screen.getByLabelText('Filter saved searches'), {
      target: { value: 'plate' },
    })
    await waitFor(() => expect(screen.queryByText('Buffers')).toBeNull())
    expect(screen.getByText('Ana’s plates')).toBeTruthy()
  })

  it('opens a saved search on the results page', async () => {
    mount()
    fireEvent.click(await screen.findByText('Buffers'))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/search',
      search: { q: 'buffer' },
    })
  })

  it('offers changes only on searches the person may change', async () => {
    mount()
    await screen.findByText('Ana’s plates')
    expect(
      screen.getByRole('button', { name: 'Options for saved search Buffers' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Options for saved search Ana’s plates',
      }),
    ).toBeNull()
  })

  it('lets a manager change a shared search someone else saved', async () => {
    mocks.role = 'admin'
    mount()
    expect(
      await screen.findByRole('button', {
        name: 'Options for saved search Ana’s plates',
      }),
    ).toBeTruthy()
  })

  it('asks before deleting, then deletes', async () => {
    mount()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Options for saved search Team runs',
      }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Delete “Team runs” for everyone/),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('delete_saved_search', {
        p_id: 's-3',
      }),
    )
  })

  it('stops sharing a search from its menu', async () => {
    mount()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Options for saved search Team runs',
      }),
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Stop sharing' }),
    )
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('update_saved_search', {
        p_id: 's-3',
        p_visibility: 'private',
      }),
    )
  })

  it('says so when there are none yet', async () => {
    mocks.rows = []
    mount()
    expect(await screen.findByText('No saved searches yet')).toBeTruthy()
  })
})
