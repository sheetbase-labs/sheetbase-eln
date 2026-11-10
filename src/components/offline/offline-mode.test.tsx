/**
 * EXP-05.2 — offline mode UI. Covers the three promises the surface makes:
 * the banner appears offline and names the last sync; an unsynced edit marks
 * its block and cell and appears in the inspector list; a connection-requiring
 * action is disabled with its reason stated.
 */
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import {
  createInMemoryStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import type { OfflineEditScope } from '#/lib/offline/store'
import { OfflineBanner, OfflineCapabilitiesNote } from './offline-banner'
import { ConnectionRequired } from './connection-required'
import {
  OfflineEditsProvider,
  useOfflineEdits,
  useUnsyncedBlock,
  useUnsyncedCellState,
} from './offline-edits'
import { formatClockTime, isConnectionDown } from './offline-edit-model'
import { UnsyncedChangesList, UnsyncedMark } from './unsynced-changes'
import { OfflineStatusBanner, UnsyncedChangesSection } from './offline-status'
import { getDisplayTimeZone, setDisplayTimeZone } from '#/lib/display-time-zone'
import { getDisplayClock, setDisplayClock } from '#/lib/display-clock'

afterEach(cleanup)

const SCOPE: OfflineEditScope = { userId: 'user-alice', recordId: 'record-1' }

describe('offline status hydration', () => {
  it('makes no server connection claim and hydrates stored times on the client clock across zones', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit(SCOPE, {
      kind: 'block_text',
      blockId: 'b1',
      text: 'Local draft',
      expectedRevision: 1,
      createdAt: '2026-10-10T09:02:00.000Z',
    })
    const previousZone = getDisplayTimeZone()
    const previousClock = getDisplayClock()
    const container = document.createElement('div')
    document.body.append(container)

    const view = (
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineStatusBanner />
        <UnsyncedChangesSection />
      </OfflineEditsProvider>
    )

    const hydrationErrors: object[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined

    try {
      setDisplayTimeZone('America/Los_Angeles')
      setDisplayClock('24h')
      container.innerHTML = renderToString(view)
      expect(container.innerHTML).toBe('')
      setDisplayTimeZone('Asia/Tokyo')
      await act(async () => {
        root = hydrateRoot(container, view, {
          onRecoverableError: (error) => hydrationErrors.push({ error }),
        })
      })
      await waitFor(() => expect(container.textContent).toContain('18:02'))
      expect(container.textContent).toContain('You’re offline')
      expect(container.textContent).toContain('Local draft')
      expect(hydrationErrors).toEqual([])
    } finally {
      await act(async () => root?.unmount())
      container.remove()
      setDisplayTimeZone(previousZone)
      setDisplayClock(previousClock)
    }
  })
})

describe('OfflineBanner', () => {
  it('appears when offline and names the last sync', () => {
    const lastSyncedAt = '2026-10-10T09:02:00.000Z'
    render(
      <OfflineBanner
        offline
        lastSyncedAt={lastSyncedAt}
        unsyncedCount={3}
        onRetry={() => undefined}
      />,
    )

    expect(screen.getByText(/You’re offline/)).toBeTruthy()
    expect(
      screen.getByText(`Last synced ${formatClockTime(lastSyncedAt)}`),
    ).toBeTruthy()
    expect(screen.getByText('3 unsynced changes')).toBeTruthy()
  })

  it('says so honestly when nothing has synced yet', () => {
    render(<OfflineBanner offline lastSyncedAt={null} />)

    expect(screen.getByText('Not synced yet on this device')).toBeTruthy()
  })

  it('renders nothing while online', () => {
    render(<OfflineBanner offline={false} lastSyncedAt={null} />)

    expect(screen.queryByText(/You’re offline/)).toBeNull()
  })

  it('asks the coordinator to retry', () => {
    const onRetry = vi.fn()
    render(<OfflineBanner offline onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: /Try again now/ }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('states what can and cannot be done offline', () => {
    render(<OfflineCapabilitiesNote />)

    expect(screen.getByText('Available offline')).toBeTruthy()
    expect(screen.getByText('Needs a connection')).toBeTruthy()
  })
})

describe('isConnectionDown', () => {
  it('treats reconnecting and offline as down, live and connecting as up', () => {
    expect(isConnectionDown('reconnecting')).toBe(true)
    expect(isConnectionDown('offline')).toBe(true)
    expect(isConnectionDown('live')).toBe(false)
    expect(isConnectionDown('connecting')).toBe(false)
  })
})

describe('ConnectionRequired', () => {
  it('disables the action and states the reason while offline', () => {
    render(
      <ConnectionRequired online={false} reason="Submitting needs a connection">
        {({ disabled, describedBy }) => (
          <button
            type="button"
            disabled={disabled}
            aria-describedby={describedBy}
          >
            Submit
          </button>
        )}
      </ConnectionRequired>,
    )

    const button = screen.getByRole('button', { name: 'Submit' })

    if (!(button instanceof HTMLButtonElement))
      throw new Error('Expected a native button')
    expect(button.disabled).toBe(true)
    const reason = screen.getByText('Submitting needs a connection')
    expect(button.getAttribute('aria-describedby')).toBe(reason.id)
  })

  it('leaves the action alone while online', () => {
    render(
      <ConnectionRequired online reason="Submitting needs a connection">
        {({ disabled, describedBy }) => (
          <button
            type="button"
            disabled={disabled}
            aria-describedby={describedBy}
          >
            Submit
          </button>
        )}
      </ConnectionRequired>,
    )

    const button = screen.getByRole('button', { name: 'Submit' })

    if (!(button instanceof HTMLButtonElement))
      throw new Error('Expected a native button')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText('Submitting needs a connection')).toBeNull()
  })
})

function OfflineHarness() {
  const { edits, refresh } = useOfflineEdits()
  const blockUnsynced = useUnsyncedBlock('block-1')
  const cellState = useUnsyncedCellState('sheet-1')

  return (
    <div>
      {blockUnsynced ? (
        <UnsyncedMark label="Block block-1 is unsynced" />
      ) : null}
      {cellState('row-6', 'column-titre') === 'unsynced' ? (
        <UnsyncedMark label="Cell row-6/column-titre is unsynced" />
      ) : null}
      <UnsyncedChangesList edits={edits} />
      <button type="button" onClick={refresh}>
        Refresh
      </button>
    </div>
  )
}

describe('unsynced edits', () => {
  it('marks the affected block and cell and lists the edits', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())
    await store.putEdit(SCOPE, {
      kind: 'block_text',
      blockId: 'block-1',
      text: 'Train C breached the 20 NTU limit.',
      expectedRevision: 4,
    })
    await store.putEdit(SCOPE, {
      kind: 'cell',
      sheetInstanceId: 'sheet-1',
      rowId: 'row-6',
      columnId: 'column-titre',
      value: 7.4,
      expectedRevision: 2,
    })

    render(
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineHarness />
      </OfflineEditsProvider>,
    )

    await waitFor(() =>
      expect(screen.getByText('Block block-1 is unsynced')).toBeTruthy(),
    )
    expect(screen.getByText('Cell row-6/column-titre is unsynced')).toBeTruthy()

    const list = screen.getByRole('region', { name: 'Unsynced changes' })
    expect(list.querySelectorAll('[data-unsynced-edit]').length).toBe(2)
    expect(list.textContent).toContain('Edited text')
    expect(list.textContent).toContain('Edited a sheet cell')
    expect(list.textContent).toContain('Train C breached the 20 NTU limit.')
    expect(list.textContent).toContain('column-titre · row row-6')

    // The list is the store, not a copy: a new draft appears after refresh.
    await store.putEdit(SCOPE, {
      kind: 'comment',
      sheetInstanceId: 'sheet-1',
      body: 'Pressure data attached in DS-0310.',
      mentions: [],
      parentId: null,
      expectedRevision: 1,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('region', { name: 'Unsynced changes' })
          .querySelectorAll('[data-unsynced-edit]').length,
      ).toBe(3),
    )
  })

  it('says nothing is waiting when the scope is clean', async () => {
    const store = createOfflineEditStore(createInMemoryStorage())

    render(
      <OfflineEditsProvider store={store} scope={SCOPE}>
        <OfflineHarness />
      </OfflineEditsProvider>,
    )

    await waitFor(() =>
      expect(
        screen.getByText('Nothing is waiting. Every edit is saved.'),
      ).toBeTruthy(),
    )
    expect(screen.queryByText('Block block-1 is unsynced')).toBeNull()
  })
})
