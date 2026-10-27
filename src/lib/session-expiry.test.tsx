import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionExpiredBanner } from '#/components/v3/shell/session-expired-banner'
import { createDataClient } from './data-client'
import {
  resetSessionExpired,
  signInHrefFor,
  useSessionExpired,
} from './session-expiry'

vi.mock('#/components/live/live-event-provider', () => ({
  useLiveStatus: () => ({
    status: 'offline',
    lastAppliedSeq: 0,
    workspaceId: null,
    lastResetReason: null,
  }),
}))

afterEach(() => {
  cleanup()
  resetSessionExpired()
})

describe('session expiry', () => {
  it('a 401 from the data boundary marks the session as ended', async () => {
    const { result } = renderHook(() => useSessionExpired())
    expect(result.current).toBe(false)
    const client = createDataClient(
      async () => new Response('{}', { status: 401 }),
    )
    await act(async () => {
      await client.list('records').catch(() => undefined)
    })
    expect(result.current).toBe(true)
  })

  it('a 403 does not claim the session ended', async () => {
    const { result } = renderHook(() => useSessionExpired())
    const client = createDataClient(
      async () => new Response('{}', { status: 403 }),
    )
    await act(async () => {
      await client.list('records').catch(() => undefined)
    })
    expect(result.current).toBe(false)
  })

  it('the banner names the cause and signs back in to the same page', () => {
    render(<SessionExpiredBanner expired path="/records/r1/notebook?tab=x" />)
    expect(screen.getByText('Your session ended.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Sign in' }).getAttribute('href'),
    ).toBe('/sign-in?next=%2Frecords%2Fr1%2Fnotebook%3Ftab%3Dx')
  })

  it('tells the shell how far down to start while it is showing', () => {
    const { unmount } = render(<SessionExpiredBanner expired path="/" />)
    expect(
      document.documentElement.style.getPropertyValue('--session-banner-h'),
    ).not.toBe('')
    unmount()
    expect(
      document.documentElement.style.getPropertyValue('--session-banner-h'),
    ).toBe('')
  })

  it('renders nothing while the session is live', () => {
    render(<SessionExpiredBanner />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('never returns to the sign-in page itself', () => {
    expect(signInHrefFor('/sign-in?x=1')).toBe('/sign-in?next=%2F')
  })
})
