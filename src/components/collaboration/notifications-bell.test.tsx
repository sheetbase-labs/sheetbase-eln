import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotificationsBell } from './notifications-bell'
import type * as RouterModule from '@tanstack/react-router'
import type * as NotificationsData from '#/lib/notifications-data'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: ({ to, children }: { to?: unknown; children?: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
}))

vi.mock('#/lib/notifications-data', async (importOriginal) => ({
  ...(await importOriginal<typeof NotificationsData>()),
  markNotificationsRead: vi.fn(),
  fetchLatestReviews: vi.fn(
    async () => new Map([['r1', { revisionId: 'rev-1', state: 'submitted' }]]),
  ),
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

  it('opens a review notification on the review, not only the record', async () => {
    renderBell()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
    )
    const link = await screen.findByRole('link', { name: /Review requested/ })
    await vi.waitFor(() =>
      expect(link.getAttribute('href')).toBe('/review/rev-1'),
    )
  })
})
