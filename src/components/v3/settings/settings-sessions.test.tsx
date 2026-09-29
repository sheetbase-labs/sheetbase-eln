import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsSessions } from './settings-sessions'

vi.mock('#/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { session: { id: 's1' } } }),
    listSessions: vi.fn(async () => ({
      data: [
        {
          id: 's1',
          token: 't1',
          userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120.0',
          ipAddress: '10.0.0.1',
          createdAt: '2026-09-25T08:00:00Z',
          expiresAt: '2026-10-25T08:00:00Z',
        },
        {
          id: 's2',
          token: 't2',
          userAgent: 'Mozilla/5.0 (Windows) Firefox/121.0',
          ipAddress: '10.0.0.2',
          createdAt: '2026-09-24T08:00:00Z',
          expiresAt: '2026-10-24T08:00:00Z',
        },
      ],
      error: null,
    })),
    revokeSession: vi.fn(async () => ({ error: null })),
  },
}))

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SettingsSessions />
    </QueryClientProvider>,
  )
}

describe('SettingsSessions', () => {
  it('lists the devices and offers sign-out for the other session', async () => {
    renderSection()
    expect(await screen.findByText(/Chrome · macOS/)).toBeTruthy()
    expect(screen.getByText(/this device/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })
})
