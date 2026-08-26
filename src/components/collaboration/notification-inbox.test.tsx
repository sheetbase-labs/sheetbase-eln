/**
 * COLLAB-03 NotificationInbox tests. The Liveblocks inbox hooks are mocked
 * at the project's single import surface ('#/lib/collaboration/
 * liveblocks.config') and global fetch stands in for the two resolve
 * endpoints, so badge counting, deep-link click-through, mark-read
 * behaviour and the permission-aware generic fallback can be exercised
 * deterministically.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserEvent } from '@testing-library/user-event'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { NotificationInbox } from './notification-inbox'

const h = vi.hoisted(() => ({
  enabled: true,
  notifications: [] as Array<Record<string, unknown>>,
  unreadCount: 0,
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('#/lib/collaboration/liveblocks.config', () => ({
  useInboxNotifications: () => ({ inboxNotifications: h.notifications }),
  useCollaborationEnabled: () => h.enabled,
  useUnreadInboxNotificationsCount: () => ({ count: h.unreadCount }),
  useMarkInboxNotificationAsRead: () => h.markAsRead,
  useMarkAllInboxNotificationsAsRead: () => h.markAllAsRead,
  useInboxNotificationThread: () => {
    throw new Error('thread lookup not expected in these scenarios')
  },
}))

// No route tree is required; navigation is observed through the hook.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
}))

const ROOM_A = 'workspace:w1:record:r1'
const ROOM_URL = '/workspaces/w1/records/r1'

/** Two resolve endpoints backed by one fixture table per call. */
function fakeFetch(
  response: (
    url: string,
  ) => { status: number; body: Record<string, unknown> } | undefined,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : String(input)
    const result = response(url)
    if (!result) {
      throw new Error(`Unexpected fetch: ${url}`)
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function customNotification(overrides: Record<string, unknown> = {}) {
  return {
    kind: '$sampleAnalysed',
    id: 'n1',
    roomId: ROOM_A,
    subjectId: 's1',
    notifiedAt: new Date(Date.now() - 5 * 60_000),
    readAt: null,
    activities: [
      {
        id: 'a1',
        createdAt: new Date(Date.now() - 5 * 60_000),
        data: { userId: 'user-1', excerpt: 'Sample S-12 analysed' },
      },
    ],
    ...overrides,
  }
}

function renderInbox() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationInbox />
    </QueryClientProvider>,
  )
}

async function openInbox(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Notifications' }))
}

beforeAll(() => {
  // jsdom does not implement ResizeObserver; Radix popover reads it.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  h.enabled = true
  h.unreadCount = 0
  h.notifications = []
})

afterEach(() => {
  cleanup()
  h.markAsRead.mockClear()
  h.markAllAsRead.mockClear()
  h.navigate.mockClear()
  vi.unstubAllGlobals()
})

describe('NotificationInbox', () => {
  it('renders nothing when collaboration is disabled', () => {
    h.enabled = false
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => undefined),
    )
    const { container } = renderInbox()
    expect(container.children).toHaveLength(0)
  })

  it('shows an Empty state inside the popover for an empty inbox', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => undefined),
    )
    renderInbox()
    await openInbox(user)
    expect(screen.getByText('No notifications')).toBeTruthy()
    expect(screen.queryByTestId('notification-list')).toBeNull()
  })

  it('surfaces the unread count badge plus actor, room context and excerpt', async () => {
    h.unreadCount = 2
    h.notifications = [customNotification()]
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) =>
        url.includes('/resolve/rooms')
          ? {
              status: 200,
              body: {
                rooms: [{ id: ROOM_A, name: 'Experiment A', url: ROOM_URL }],
              },
            }
          : {
              status: 200,
              body: {
                users: [{ id: 'user-1', name: 'Ada Lovelace', avatar: null }],
              },
            },
      ),
    )
    const user = userEvent.setup()
    renderInbox()
    expect(screen.getByText('2')).toBeTruthy()
    await openInbox(user)
    expect(await screen.findByText('Experiment A')).toBeTruthy()
    expect(screen.getByText(/Sample S-12 analysed/)).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByLabelText('Unread')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeTruthy()
  })

  it('marks read and navigates to the resolved room url on click-through', async () => {
    h.unreadCount = 1
    h.notifications = [customNotification()]
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) =>
        url.includes('/resolve/rooms')
          ? {
              status: 200,
              body: {
                rooms: [{ id: ROOM_A, name: 'Experiment A', url: ROOM_URL }],
              },
            }
          : {
              status: 200,
              body: {
                users: [{ id: 'user-1', name: 'Ada Lovelace', avatar: null }],
              },
            },
      ),
    )
    const user = userEvent.setup()
    renderInbox()
    await openInbox(user)
    fireEvent.click(await screen.findByText('Experiment A'))
    await waitFor(() => {
      expect(h.markAsRead).toHaveBeenCalledWith('n1')
    })
    expect(h.navigate).toHaveBeenCalledWith({ to: ROOM_URL })
  })

  it('renders a generic non-linking item when the room cannot be resolved', async () => {
    h.notifications = [
      customNotification({ id: 'n-secret', roomId: 'workspace:w1:secret:s9' }),
    ]
    // Permission filtering omits inaccessible rooms entirely.
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) =>
        url.includes('/resolve/rooms')
          ? { status: 200, body: { rooms: [] } }
          : {
              status: 200,
              body: {
                users: [{ id: 'user-1', name: 'Ada Lovelace', avatar: null }],
              },
            },
      ),
    )
    const user = userEvent.setup()
    renderInbox()
    await openInbox(user)
    expect(await screen.findByText('New activity')).toBeTruthy()
    expect(h.markAsRead).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('New activity'))
    await waitFor(() => {
      expect(h.markAsRead).toHaveBeenCalledWith('n-secret')
    })
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('marks every notification read from the header control', async () => {
    h.unreadCount = 3
    h.notifications = [customNotification()]
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => ({ status: 200, body: {} })),
    )
    const user = userEvent.setup()
    renderInbox()
    await openInbox(user)
    await user.click(
      await screen.findByRole('button', { name: 'Mark all read' }),
    )
    expect(h.markAllAsRead).toHaveBeenCalledTimes(1)
  })
})
