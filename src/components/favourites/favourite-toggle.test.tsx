// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FavouriteToggle } from './favourite-toggle'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

function stubClient(options: {
  rows?: Array<{ object_kind: string; object_id: string; created_at: string }>
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
}): DataClient {
  return {
    list: () => Promise.resolve(options.rows ?? []),
    count: () => Promise.resolve(0),
    rpc: options.rpc ?? (() => Promise.resolve('2026-08-31T12:00:00Z')),
    insert: () => Promise.resolve({}),
    patch: () => Promise.resolve([]),
    remove: () => Promise.resolve([]),
  } as unknown as DataClient
}

describe('FavouriteToggle', () => {
  it('renders nothing when there is no canonical object selected', () => {
    const { container } = renderWithQuery(
      <FavouriteToggle
        kind="dataset"
        objectId={null}
        client={stubClient({})}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('stars optimistically and stays starred after the refetch', async () => {
    const rows: Array<{
      object_kind: string
      object_id: string
      created_at: string
    }> = []
    const rpc = vi.fn((_name: string, args: Record<string, unknown>) => {
      // Model the server: the write lands, so the RLS read returns the row.
      rows.push({
        object_kind: String(args.p_object_kind),
        object_id: String(args.p_object_id),
        created_at: '2026-08-31T12:00:00Z',
      })
      return Promise.resolve('2026-08-31T12:00:00Z')
    })
    renderWithQuery(
      <FavouriteToggle
        kind="record"
        objectId="r-1"
        client={stubClient({ rows, rpc })}
      />,
    )

    const button = await screen.findByRole('button', {
      name: 'Add favourite',
    })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)

    await waitFor(() => {
      const starred = screen.getByRole('button', { name: 'Remove favourite' })
      expect(starred.getAttribute('aria-pressed')).toBe('true')
    })
    expect(rpc).toHaveBeenCalledWith('set_record_favourite', {
      p_object_kind: 'record',
      p_object_id: 'r-1',
      p_favourite: true,
    })
  })

  it('rolls the star back and surfaces an error when the write fails', async () => {
    const rpc = vi.fn(() =>
      Promise.reject(new DataClientError('upstream_error', 'boom', 500)),
    )
    renderWithQuery(
      <FavouriteToggle
        kind="sheet"
        objectId="s-1"
        client={stubClient({ rpc })}
      />,
    )

    const button = await screen.findByRole('button', { name: 'Add favourite' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Couldn’t save favourite',
      )
    })
    // Rollback: the star is unstarred again.
    expect(screen.getByRole('button', { name: 'Add favourite' })).toBeTruthy()
  })
})
