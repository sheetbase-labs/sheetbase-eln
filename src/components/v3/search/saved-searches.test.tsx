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
  rpc: vi.fn(),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: mocks.list, rpc: mocks.rpc },
}))

beforeEach(() => {
  localStorage.clear()
  mocks.rows = []
  mocks.list.mockImplementation(async () => mocks.rows)
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'save_search') {
      mocks.rows = [
        {
          id: `s-${mocks.rows.length + 1}`,
          name: args.p_name,
          query: args.p_query,
          facets: args.p_facets,
          created_at: '2026-10-30T12:00:00Z',
        },
        ...mocks.rows,
      ]
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

function mount(
  current: { q: string } & Record<string, unknown>,
  onApply = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SavedSearches workspaceId="ws-1" current={current} onApply={onApply} />
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
      expect(mocks.rpc).toHaveBeenCalledWith('save_search', {
        p_name: 'My plates',
        p_query: 'plate',
        p_facets: { owner: 'u-1', from: '2026-09-01', text: 'plate' },
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'My plates' }))
    expect(onApply).toHaveBeenCalledWith({
      q: 'plate',
      owner: 'u-1',
      from: '2026-09-01',
    })
  })

  it('shows searches already on the account and deletes one', async () => {
    mocks.rows = [
      {
        id: 's-9',
        name: 'Plates',
        query: 'plate',
        facets: {},
        created_at: '2026-10-29T12:00:00Z',
      },
    ]
    mount({ q: 'plate' })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete saved search Plates' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Plates' })).toBeNull(),
    )
    expect(mocks.rpc).toHaveBeenCalledWith('delete_saved_search', {
      p_id: 's-9',
    })
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
      expect(mocks.rpc).toHaveBeenCalledWith('save_search', {
        p_name: 'All samples',
        p_query: '',
        p_facets: { filter, sort: 'updated', text: '' },
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'All samples' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Old' }))
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
      await screen.findByRole('button', { name: 'Old plates' }),
    ).toBeTruthy()
    expect(localStorage.getItem('sheetbase-saved-searches-ws-1')).toBeNull()
  })

  it('says so when a search could not be saved', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('offline'))
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
})
