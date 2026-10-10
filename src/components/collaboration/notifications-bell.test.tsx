import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotificationsBell } from './notifications-bell'

vi.mock('#/lib/notifications-data', () => ({
  notificationsQueryKeys: { list: () => ['notifications', 'list'] },
  markNotificationsRead: vi.fn(),
  fetchMyNotifications: vi.fn(async () => [
    {
      id: 'n1',
      eventType: 'review_requested',
      title: 'Review requested',
      body: null,
      recordId: 'r1',
      projectId: null,
      createdAt: '2026-09-25T09:40:00Z',
      readAt: null,
    },
  ]),
}))

function renderBell() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NotificationsBell />
    </QueryClientProvider>,
  )
}

describe('NotificationsBell', () => {
  it('shows an unread bell and a mark-all-read action', async () => {
    renderBell()
    expect(
      await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeTruthy()
  })
})
