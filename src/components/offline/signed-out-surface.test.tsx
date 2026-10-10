/**
 * EXP-05.5 — the `SignedOut` surface and its retention marker.
 */
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SignedOutSurface, useRetainedDrafts } from './signed-out-surface'
import { createInMemorySignOutRetentionStorage } from '#/lib/offline/retention'

afterEach(cleanup)

describe('SignedOutSurface', () => {
  it('tells the user their unsynced edits were kept and will sync', () => {
    render(<SignedOutSurface retained={2} />)

    const notice = screen.getByText(/Unsaved edits on this device/)
    expect(notice.textContent).toContain(
      'were kept and will sync when you sign in again',
    )
    expect(notice.textContent).toContain(
      'Signing out ends your session on this browser only',
    )
  })

  it('does not claim retained edits when nothing is waiting', () => {
    render(<SignedOutSurface retained={0} />)

    expect(screen.getByText(/You signed out of this browser/)).toBeTruthy()
    expect(screen.queryByText(/Unsaved edits on this device/)).toBeNull()
  })
})

describe('useRetainedDrafts', () => {
  it('reports the drafts the device kept when its last user signed out', async () => {
    const storage = createInMemorySignOutRetentionStorage({
      userId: 'user-alice',
      retained: 3,
      signedOutAt: '2026-10-10T09:00:00.000Z',
    })

    const { result } = renderHook(() => useRetainedDrafts(storage))

    await waitFor(() => expect(result.current).toBe(3))
  })

  it('reports zero when the device has no retention marker', async () => {
    const { result } = renderHook(() =>
      useRetainedDrafts(createInMemorySignOutRetentionStorage()),
    )

    await waitFor(() => expect(result.current).toBe(0))
  })
})
