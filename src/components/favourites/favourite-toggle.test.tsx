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
import { z } from 'zod'

import { FavouriteToggle } from './favourite-toggle'
import { createDataClient } from '#/lib/data-client'
import { registerShellRefresh } from '#/lib/shell-refresh'
import { favouritesQueryKeys } from '#/lib/favourites'
import type { Favourite, FavouriteItem, FavouriteWire } from '#/lib/favourites'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.length = 0
  vi.restoreAllMocks()
})

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  clients.push(queryClient)

  const rendered = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )

  return { ...rendered, queryClient }
}

function favouriteClient(
  options: {
    rows?: FavouriteWire[]
    write?: (request: Request) => Promise<Response>
  } = {},
) {
  return createDataClient(async (input, init) => {
    const request = new Request(
      new URL(
        input instanceof Request ? input.url : input.toString(),
        'http://localhost',
      ),
      init,
    )

    const path = new URL(request.url).pathname

    if (request.method === 'GET') {
      expect(path).toBe('/api/db/user_favourites')

      return Response.json(options.rows ?? [])
    }

    expect(request.method).toBe('POST')
    expect(path).toBe('/api/db/rpc/set_record_favourite')

    return options.write
      ? options.write(request)
      : Response.json('2026-08-31T12:00:00Z')
  })
}

describe('FavouriteToggle', () => {
  it('renders nothing when there is no canonical object selected', () => {
    const { container } = renderWithQuery(
      <FavouriteToggle
        kind="dataset"
        objectId={null}
        client={favouriteClient()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('stars optimistically and stays starred after the refetch', async () => {
    const rows: FavouriteWire[] = []

    const calls: Array<{
      name: string
      args: { p_object_kind: string; p_object_id: string; p_favourite: boolean }
    }> = []

    const rpc = async (request: Request) => {
      const args = z
        .object({
          p_object_kind: z.literal('record'),
          p_object_id: z.literal('r-1'),
          p_favourite: z.boolean(),
        })
        .parse(await request.json())

      calls.push({
        name: new URL(request.url).pathname.split('/').at(-1) ?? '',
        args,
      })
      // Model the server: the write lands, so the RLS read returns the row.
      rows.push({
        user_id: 'u',
        object_kind: args.p_object_kind,
        object_id: args.p_object_id,
        created_at: '2026-08-31T12:00:00Z',
      })

      return Response.json('2026-08-31T12:00:00Z')
    }

    renderWithQuery(
      <FavouriteToggle
        kind="record"
        objectId="r-1"
        client={favouriteClient({ rows, write: rpc })}
      />,
    )

    const button = await screen.findByRole('button', {
      name: 'Pin to the sidebar',
    })

    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)

    await waitFor(() => {
      const starred = screen.getByRole('button', {
        name: 'Unpin from the sidebar',
      })

      expect(starred.getAttribute('aria-pressed')).toBe('true')
    })
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Unpin from the sidebar',
        }).disabled,
      ).toBe(false),
    )
    expect(calls).toEqual([
      {
        name: 'set_record_favourite',
        args: {
          p_object_kind: 'record',
          p_object_id: 'r-1',
          p_favourite: true,
        },
      },
    ])
  })

  it('rolls the star back and surfaces an error when the write fails', async () => {
    const rpc = () =>
      Promise.resolve(
        Response.json(
          { code: 'upstream_error', message: 'boom' },
          { status: 500 },
        ),
      )

    renderWithQuery(
      <FavouriteToggle
        kind="sheet"
        objectId="s-1"
        client={favouriteClient({ write: rpc })}
      />,
    )

    const button = await screen.findByRole('button', {
      name: 'Pin to the sidebar',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Couldn’t save the pin',
      )
    })
    // Rollback: the star is unstarred again.
    expect(
      screen.getByRole('button', { name: 'Pin to the sidebar' }),
    ).toBeTruthy()
  })

  it.each(['instrument', 'record', 'pipeline'] as const)(
    'asks the sidebar to refresh after pinning a %s',
    async (kind) => {
      const refresh = vi.fn()
      const stop = registerShellRefresh(refresh)
      renderWithQuery(
        <FavouriteToggle
          kind={kind}
          objectId="x-1"
          client={favouriteClient()}
        />,
      )
      fireEvent.click(
        await screen.findByRole('button', { name: 'Pin to the sidebar' }),
      )
      await waitFor(() => expect(refresh).toHaveBeenCalled())
      stop()
    },
  )

  it.each(['refused', 'success'] as const)(
    'preserves both optimistic caches and ordering through pending unpin and %s',
    async (outcome) => {
      const rows: FavouriteWire[] = [
        {
          user_id: 'u',
          object_kind: 'sheet',
          object_id: 's-1',
          created_at: '2026-08-31T12:00:00Z',
        },
        {
          user_id: 'u',
          object_kind: 'record',
          object_id: 'r-2',
          created_at: '2026-08-31T11:00:00Z',
        },
      ]

      const originalList: Favourite[] = [
        { kind: 'sheet', id: 's-1', createdAt: '2026-08-31T12:00:00Z' },
        { kind: 'record', id: 'r-2', createdAt: '2026-08-31T11:00:00Z' },
      ]

      const originalItems: FavouriteItem[] = [
        {
          ...originalList[0],
          label: 'Sheet',
          identifier: null,
          destination: '/sheets/s-1',
        },
        {
          ...originalList[1],
          label: 'Notebook',
          identifier: 'EXP-2',
          destination: '/experiments/r-2',
        },
      ]

      let resolveWrite: ((response: Response) => void) | undefined

      const pending = new Promise<Response>((resolve) => {
        resolveWrite = resolve
      })

      const args: z.infer<ReturnType<typeof z.json>>[] = []

      const client = favouriteClient({
        rows,
        write: async (request) => {
          args.push(z.json().parse(await request.json()))

          return pending
        },
      })

      const { queryClient } = renderWithQuery(
        <FavouriteToggle kind="sheet" objectId="s-1" client={client} />,
      )

      const button = await screen.findByRole('button', {
        name: 'Unpin from the sidebar',
      })

      queryClient.setQueryData(favouritesQueryKeys.items(), originalItems)
      fireEvent.click(button)

      if (!resolveWrite)
        throw new Error('Deferred HTTP response was not initialized')

      try {
        await waitFor(() =>
          expect(args).toEqual([
            { p_object_kind: 'sheet', p_object_id: 's-1', p_favourite: false },
          ]),
        )
        expect(queryClient.getQueryData(favouritesQueryKeys.list())).toEqual([
          originalList[1],
        ])
        expect(queryClient.getQueryData(favouritesQueryKeys.items())).toEqual([
          originalItems[1],
        ])
        expect(
          screen.getByRole<HTMLButtonElement>('button', {
            name: 'Pin to the sidebar',
          }).disabled,
        ).toBe(true)
      } finally {
        if (outcome === 'success') rows.splice(0, 1)

        resolveWrite(
          outcome === 'refused'
            ? Response.json(
                { code: 'permission_denied', message: 'not visible' },
                { status: 403 },
              )
            : Response.json(null),
        )
      }

      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>('button', {
            name:
              outcome === 'refused'
                ? 'Unpin from the sidebar'
                : 'Pin to the sidebar',
          }).disabled,
        ).toBe(false),
      )
      expect(queryClient.getQueryData(favouritesQueryKeys.list())).toEqual(
        outcome === 'refused' ? originalList : [originalList[1]],
      )
      expect(queryClient.getQueryData(favouritesQueryKeys.items())).toEqual(
        outcome === 'refused' ? originalItems : [originalItems[1]],
      )

      if (outcome === 'refused')
        expect(screen.getByRole('alert').textContent).toBe(
          'Couldn’t save the pin',
        )
    },
  )
})
