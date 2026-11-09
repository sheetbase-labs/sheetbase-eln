import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SavedSearches } from './saved-searches'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  list: vi.fn(),
  members: [{ user_id: 'u-ana', name: 'Ana', role: 'member' }],
  rpc: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: mocks.list, rpc: mocks.rpc },
}))

beforeEach(() => {
  localStorage.clear()
  mocks.rows = []
  mocks.list.mockImplementation(async () => mocks.rows)
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'workspace_members_list') return mocks.members

    if (name === 'save_search') {
      mocks.rows = [
        {
          id: `s-${mocks.rows.length + 1}`,
          name: args.p_name,
          query: args.p_query,
          facets: args.p_facets,
          created_at: '2026-10-30T12:00:00Z',
          visibility: args.p_visibility ?? 'private',
          user_id: 'u-me',
        },
        ...mocks.rows,
      ]
    } else if (name === 'update_saved_search') {
      mocks.rows = mocks.rows.map((r) =>
        r.id === args.p_id
          ? { ...r, visibility: args.p_visibility ?? r.visibility }
          : r,
      )
    } else if (name === 'delete_saved_search') {
      mocks.rows = mocks.rows.filter((r) => r.id !== args.p_id)
    }

    return null
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Make the next save fail; the other calls still answer. */
function row(id: string, name: string, created: string, used?: string) {
  return {
    id,
    name,
    query: 'plate',
    facets: {},
    created_at: created,
    visibility: 'private',
    user_id: 'u-me',
    saved_search_uses: used ? [{ last_used_at: used }] : [],
  }
}

function failSave(message: string) {
  const answer = mocks.rpc.getMockImplementation()!
  mocks.rpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === 'save_search') throw new Error(message)

    return answer(name, args)
  })
}

function mount(
  current: { q: string } & Record<string, unknown>,
  onApply = vi.fn(),
  who: { role?: string; userId?: string } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SavedSearches
        workspaceId="ws-1"
        current={current}
        onApply={onApply}
        userId={who.userId ?? 'u-me'}
        role={who.role ?? 'scientist'}
      />
    </QueryClientProvider>,
  )

  return onApply
}

describe('SavedSearches', () => {
  it('saves the current search on the account and applies it later', async () => {
    const onApply = mount({ q: 'plate', owner: 'u-1', from: '2026-09-01' })
    expect(
      await screen.findByText(/Saved searches stay with your account/),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save this search' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My plates' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'save_search',
        expect.objectContaining({
          p_name: 'My plates',
          p_query: 'plate',
          p_facets: { owner: 'u-1', from: '2026-09-01', text: 'plate' },
          p_visibility: 'private',
          p_arguments: expect.objectContaining({ p_query: 'plate' }),
        }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: /^My plates/ }))
    expect(onApply).toHaveBeenCalledWith({
      q: 'plate',
      owner: 'u-1',
      from: '2026-09-01',
    })
  })

  it('lists the searches opened most recently, then the newest, and links to the full list', async () => {
    mocks.rows = Array.from({ length: 8 }, (_, i) => ({
      id: `s-${i}`,
      name: `Search ${i}`,
      query: 'plate',
      facets: {},
      created_at: `2026-10-${20 + i}T12:00:00Z`,
      visibility: i === 7 ? 'workspace' : 'private',
      user_id: 'u-ana',
    }))
    mount({ q: '' })
    expect(await screen.findByRole('button', { name: /Search 7/ })).toBeTruthy()
    expect(screen.getByText('Everyone in the workspace')).toBeTruthy()
    expect(screen.getByText('Recently used')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Search 0/ })).toBeNull()

    const all = screen.getByRole('link', {
      name: 'View all 8 saved searches',
    })

    expect(all.getAttribute('href')).toBe('/saved-searches')
  })

  it('saves the filter tree and sort with the words, and applies them again', async () => {
    const filter = { g: 'AND', k: [{ f: 'type', o: 'eq', v: 'sample' }] }
    const onApply = mount({ q: '', filter, sort: 'updated' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save this search' }),
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'All samples' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // Filters alone are saved with an empty query.
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'save_search',
        expect.objectContaining({
          p_name: 'All samples',
          p_query: '',
          p_facets: { filter, sort: 'updated', text: '' },
        }),
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^All samples/ }))
    expect(onApply).toHaveBeenCalledWith({ q: '', filter, sort: 'updated' })
  })

  it('still loads a saved search from before filters existed', async () => {
    mocks.rows = [
      {
        id: 's-1',
        name: 'Old',
        query: 'plate',
        facets: { owner: 'u-1' },
        created_at: '2026-10-01T12:00:00Z',
      },
    ]
    const onApply = mount({ q: '' })
    fireEvent.click(await screen.findByRole('button', { name: /^Old/ }))
    expect(onApply).toHaveBeenCalledWith({ q: 'plate', owner: 'u-1' })
  })

  it('moves searches an earlier version kept in this browser onto the account', async () => {
    localStorage.setItem(
      'sheetbase-saved-searches-ws-1',
      JSON.stringify([
        {
          id: 'local-1',
          name: 'Old plates',
          query: 'plate',
          kind: '',
          projectId: '',
          status: '',
          ownerId: '',
          dateRange: 'all',
          ts: 1,
        },
      ]),
    )
    mount({ q: '' })
    expect(
      await screen.findByRole('button', { name: /^Old plates/ }),
    ).toBeTruthy()
    expect(localStorage.getItem('sheetbase-saved-searches-ws-1')).toBeNull()
  })

  it('says so when a search could not be saved', async () => {
    failSave('offline')
    mount({ q: 'plate' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save this search' }),
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Plates' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(/Couldn’t update your saved searches/),
    ).toBeTruthy()
  })

  it('offers no save without a query', async () => {
    mount({ q: '' })
    await screen.findByText(/Saved searches stay with your account/)
    expect(
      screen.queryByRole('button', { name: 'Save this search' }),
    ).toBeNull()
  })

  it('shares a new search with the workspace when asked', async () => {
    mount({ q: 'plate' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save this search' }),
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Team plates' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Share with everyone in the workspace',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'save_search',
        expect.objectContaining({
          p_name: 'Team plates',
          p_visibility: 'workspace',
        }),
      ),
    )
  })

  it('does not offer sharing to a viewer', async () => {
    mount({ q: 'plate' }, vi.fn(), { role: 'viewer' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save this search' }),
    )
    expect(
      screen.queryByRole('checkbox', {
        name: 'Share with everyone in the workspace',
      }),
    ).toBeNull()
  })

  it('says when a shared search name is taken', async () => {
    failSave('a shared search with that name already exists')
    mount({ q: 'plate' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save this search' }),
    )
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Plates' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/already exists/)).toBeTruthy()
  })

  it('puts the search opened last first, and notes a use when one is opened', async () => {
    mocks.rows = [
      row(
        's-1',
        'Old favourite',
        '2026-10-01T12:00:00Z',
        '2026-11-01T09:00:00Z',
      ),
      row('s-2', 'Newest saved', '2026-10-30T12:00:00Z'),
    ]
    mount({ q: '' })

    const buttons = await screen.findAllByRole('button', {
      name: /Old favourite|Newest saved/,
    })

    expect(buttons[0].textContent).toContain('Old favourite')
    fireEvent.click(buttons[1])
    expect(mocks.rpc).toHaveBeenCalledWith('touch_saved_search', {
      p_id: 's-2',
    })
  })
})
