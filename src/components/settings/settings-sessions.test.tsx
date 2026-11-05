import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsSessions } from './settings-sessions'

vi.mock('./settings-sessions-data', () => ({
  listMySessionsFn: vi.fn(async () => [
    {
      id: 's1',
      token: null,
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120.0',
      ipAddress: '10.0.0.1',
      createdAt: '2026-09-25T08:00:00Z',
      expiresAt: '2026-10-25T08:00:00Z',
      current: true,
    },
    {
      id: 's2',
      token: 't2',
      userAgent: 'Mozilla/5.0 (Windows) Firefox/121.0',
      ipAddress: '10.0.0.2',
      createdAt: '2026-09-24T08:00:00Z',
      expiresAt: '2026-10-24T08:00:00Z',
      current: false,
    },
  ]),
}))

vi.mock('#/lib/auth-client', () => ({
  authClient: { revokeSession: vi.fn(async () => ({ error: null })) },
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
  afterEach(() => {
    cleanup()
  })

  it('lists the devices and offers sign-out only for the other session', async () => {
    renderSection()
    expect(await screen.findByText(/Chrome · macOS/)).toBeTruthy()
    expect(screen.getByText(/this device/)).toBeTruthy()
    const signOut = screen.getAllByRole('button', { name: 'Sign out' })
    expect(signOut).toHaveLength(1)
  })

  it('reports a deployment session without a sign-out it cannot perform', async () => {
    const { listMySessionsFn } = await import('./settings-sessions-data')
    vi.mocked(listMySessionsFn).mockResolvedValueOnce([
      {
        id: 'dev-auth-free-session',
        token: null,
        userAgent: null,
        ipAddress: null,
        createdAt: '2026-09-25T08:00:00Z',
        expiresAt: '2026-09-25T08:30:00Z',
        current: true,
      },
    ])
    renderSection()
    expect(await screen.findByText(/this device/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })
})
