import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import { notificationsQueryKeys } from '#/lib/notifications-data'
import { NotificationsBell } from './notifications-bell'

const notification = {
  id: 'n1',
  event_type: 'review_requested',
  title: 'Review requested',
  body: null,
  record_id: 'r1',
  project_id: null,
  created_at: '2026-09-25T09:40:00Z',
  read_at: null,
}

const review = {
  record_id: 'r1',
  revision_id: 'rev-1',
  state: 'submitted',
}

const clients = new Set<QueryClient>()

afterEach(() => {
  cleanup()

  for (const client of clients) client.clear()
  clients.clear()
})

async function renderBell({
  notifications = Response.json([notification]),
  reviews = Response.json([review]),
  mutation = Response.json(1),
}: {
  notifications?: Response | Promise<Response>
  reviews?: Response | Promise<Response>
  mutation?: Response | Promise<Response>
} = {}) {
  const requests: Request[] = []
  let read = false

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    requests.push(request)

    switch (request.url.split('?')[0]) {
      case 'http://localhost/api/db/my_notifications':
        return read
          ? Response.json([
              { ...notification, read_at: '2026-09-25T10:00:00Z' },
            ])
          : (await notifications).clone()
      case 'http://localhost/api/db/review_submissions':
        return (await reviews).clone()
      case 'http://localhost/api/db/rpc/mark_notifications_read': {
        const response = await mutation

        if (response.ok) read = true

        return response.clone()
      }

      default:
        throw new Error(`Unexpected request: ${request.url}`)
    }
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  clients.add(queryClient)
  queryClient.setQueryData(['unrelated'], 'unchanged')

  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <NotificationsBell client={client} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { requests, queryClient }
}

async function openUnreadBell() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
  )
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Response resolver not initialized')
  }

  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse
  })

  return { promise, resolve }
}

describe('NotificationsBell', () => {
  it('shows an unread bell and a mark-all-read action', async () => {
    await renderBell()
    expect(
      await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
    await openUnreadBell()
    expect(
      screen
        .getByRole('button', { name: 'Mark all read' })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(
      screen.getByRole('link', { name: 'Open inbox' }).getAttribute('href'),
    ).toBe('/inbox')
    expect(
      screen
        .getByRole('link', { name: 'Notification settings' })
        .getAttribute('href'),
    ).toBe('/settings')
  })

  it('opens a review notification on the review, not only the record', async () => {
    const { requests } = await renderBell()
    await openUnreadBell()
    const link = await screen.findByRole('link', { name: /Review requested/ })
    await vi.waitFor(() =>
      expect(link.getAttribute('href')).toBe('/review/rev-1'),
    )
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET'])
    expect(requests[0]?.url).toBe(
      'http://localhost/api/db/my_notifications?select=id,event_type,title,body,record_id,project_id,link,created_at,read_at&order=created_at.desc&limit=50',
    )
    expect(requests[1]?.url).toBe(
      'http://localhost/api/db/review_submissions?record_id=in.(r1)&select=record_id,revision_id,state&order=submitted_at.desc',
    )
  })

  it('marks all read through the RPC and refetches only the owning cache', async () => {
    const pending = deferredResponse()

    const { requests, queryClient } = await renderBell({
      mutation: pending.promise,
    })

    await openUnreadBell()
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState([
          ...notificationsQueryKeys.list(),
          'reviews',
          1,
        ])?.status,
      ).toBe('success'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2]?.method).toBe('POST')
    expect(requests[2]?.url).toBe(
      'http://localhost/api/db/rpc/mark_notifications_read',
    )
    expect(await requests[2]?.json()).toEqual({ p_ids: null })
    expect(
      screen
        .getByRole('button', { name: 'Mark all read' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
    await act(async () => pending.resolve(Response.json(1)))
    await screen.findByRole('button', { name: 'Notifications' })
    await vi.waitFor(() => expect(requests).toHaveLength(5))
    expect(
      requests
        .slice(3)
        .map((request) => new URL(request.url).pathname)
        .sort(),
    ).toEqual(['/api/db/my_notifications', '/api/db/review_submissions'])
    expect(queryClient.getQueryData(notificationsQueryKeys.list())).toEqual([
      expect.objectContaining({ readAt: '2026-09-25T10:00:00Z' }),
    ])
    expect(queryClient.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(['unrelated'])).toBe('unchanged')
    expect(
      screen
        .getByRole('button', { name: 'Mark all read' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps unread data and the existing UI when marking read is refused', async () => {
    const { requests, queryClient } = await renderBell({
      mutation: Response.json(
        { error: { code: 'permission_denied', message: 'Denied' } },
        { status: 403 },
      ),
    })

    await openUnreadBell()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await vi.waitFor(() =>
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'error',
      ),
    )
    await vi.waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Mark all read' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(
      screen.getByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /Review requested/ })).toBeTruthy()
    expect(requests).toHaveLength(3)
    expect(
      queryClient.getQueryState(notificationsQueryKeys.list())?.isInvalidated,
    ).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows loading with no mark-read action until the list arrives', async () => {
    const pending = deferredResponse()
    const { requests } = await renderBell({ notifications: pending.promise })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Notifications' }),
    )
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Mark all read' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await act(async () => pending.resolve(Response.json([notification])))
    expect(
      await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
  })

  it.each([
    ['empty', () => Response.json([]), 'success'],
    [
      'refused',
      () =>
        Response.json(
          { error: { code: 'permission_denied', message: 'Denied' } },
          { status: 403 },
        ),
      'error',
    ],
  ])(
    'keeps the existing empty UI for a %s list',
    async (_label, response, status) => {
      const { requests, queryClient } = await renderBell({
        notifications: response(),
      })

      await vi.waitFor(() =>
        expect(
          queryClient.getQueryState(notificationsQueryKeys.list())?.status,
        ).toBe(status),
      )
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'Notifications',
        }),
      )
      expect(await screen.findByText('Nothing new right now')).toBeTruthy()
      expect(
        screen
          .getByRole('button', { name: 'Mark all read' })
          .hasAttribute('disabled'),
      ).toBe(true)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(requests).toHaveLength(1)
    },
  )

  it.each([
    [
      'returned',
      () => Response.json([{ ...review, state: 'returned' }]),
      'success',
    ],
    ['missing', () => Response.json([]), 'success'],
    [
      'refused',
      () =>
        Response.json(
          { error: { code: 'permission_denied', message: 'Denied' } },
          { status: 403 },
        ),
      'error',
    ],
  ])('opens the record for a %s review', async (_label, response, status) => {
    const { queryClient } = await renderBell({ reviews: response() })
    await openUnreadBell()
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState([
          ...notificationsQueryKeys.list(),
          'reviews',
          1,
        ])?.status,
      ).toBe(status),
    )
    expect(
      (
        await screen.findByRole('link', { name: /Review requested/ })
      ).getAttribute('href'),
    ).toBe('/records/r1')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('uses the record until the newest review resolves', async () => {
    const pending = deferredResponse()
    await renderBell({ reviews: pending.promise })
    await openUnreadBell()
    const link = await screen.findByRole('link', { name: /Review requested/ })
    expect(link.getAttribute('href')).toBe('/records/r1')
    await act(async () =>
      pending.resolve(
        Response.json([review, { ...review, revision_id: 'older-review' }]),
      ),
    )
    await vi.waitFor(() =>
      expect(link.getAttribute('href')).toBe('/review/rev-1'),
    )
  })
})
