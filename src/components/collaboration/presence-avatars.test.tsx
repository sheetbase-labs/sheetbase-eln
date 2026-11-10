import { Suspense, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RoomProviderContext } from '#/lib/collaboration/room-hooks'
import type { RoomPeer } from '#/lib/collaboration/room-hooks'

import { PresenceStack } from './presence-avatars'
import { BlockCoEditBadge } from './presence-co-editing'
import { coEditingPeerNames } from './co-editing-peers'
import type { CoEditingPeer } from './co-editing-peers'
import { RoomReadyContext } from './room-ready'
import { createPresenceTestRoom } from './presence-test-room'
import { remoteSelectionChips, selectionRowsLabel } from './selection-label'
import { useSetPresence } from './use-set-presence'
import type { SettablePresenceFields } from './use-set-presence'

let room: Awaited<ReturnType<typeof createPresenceTestRoom>>

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await room.close()
})

beforeEach(async () => {
  room = await createPresenceTestRoom()
  await waitFor(() => {
    expect(room.provider.status).toBe('connected')
    expect(room.provider.identity?.id).toBe('local-user')
    expect(room.provider.synced).toBe(true)
  })
})

function renderInRoom(children: ReactNode, ready = true) {
  return render(children, {
    wrapper: ({ children: content }) => (
      <RoomReadyContext value={ready}>
        <RoomProviderContext value={room.provider}>
          {content}
        </RoomProviderContext>
      </RoomReadyContext>
    ),
  })
}

const ada: RoomPeer = {
  connectionId: 1,
  id: 'ada',
  info: { name: 'Ada Lovelace', color: '#123456' },
  presence: {},
}

const grace: RoomPeer = {
  connectionId: 2,
  id: 'grace',
  info: { name: 'Grace Hopper', color: '#234567' },
  presence: {},
}

const alan: RoomPeer = {
  connectionId: 3,
  id: 'alan',
  info: { name: 'Alan Turing', color: '#345678' },
  presence: {},
}

const edsger: RoomPeer = {
  connectionId: 4,
  id: 'edsger',
  info: { name: 'Edsger Dijkstra', color: '#456789' },
  presence: {},
}

const barbara: RoomPeer = {
  connectionId: 5,
  id: 'barbara',
  info: { name: 'Barbara Liskov', color: '#567890' },
  presence: {},
}

describe('PresenceStack', () => {
  it('renders an avatar with an accessible name per other user', () => {
    room.addPeers([ada, grace])
    const { container } = renderInRoom(<PresenceStack />)
    expect(screen.getByLabelText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByLabelText('Grace Hopper')).toBeTruthy()
    // Initials fallback renders inside each avatar.
    expect(container.textContent).toContain('AL')
    expect(container.textContent).toContain('GH')
  })

  it('labels the group with how many others are here', () => {
    room.addPeers([ada, grace])
    renderInRoom(<PresenceStack />)
    expect(screen.getByRole('group', { name: '2 here' })).toBeTruthy()
  })

  it('collapses beyond max into a +N overflow badge', () => {
    room.addPeers([ada, grace, alan, edsger, barbara])
    renderInRoom(<PresenceStack />)
    // Only the first four get avatars; Barbara is folded into +1.
    expect(screen.queryByLabelText('Barbara Liskov')).toBeNull()
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('exposes the peer name as a native tooltip on each avatar', () => {
    room.addPeers([ada, grace])
    renderInRoom(<PresenceStack />)
    // Radix Tooltip carries the styled hover UI; the native title mirrors
    // the name for plain HTML consumers and is asserted here because radix
    // portal content does not open under jsdom's synthetic events.
    expect(screen.getByLabelText('Ada Lovelace').getAttribute('title')).toBe(
      'Ada Lovelace',
    )
    expect(screen.getByLabelText('Grace Hopper').getAttribute('title')).toBe(
      'Grace Hopper',
    )
  })

  it('renders nothing when nobody else is in the room', () => {
    const { container } = renderInRoom(<PresenceStack />)
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it('renders nothing before the collaboration room is ready', () => {
    room.addPeers([ada])
    const { container } = renderInRoom(<PresenceStack />, false)
    expect(container.querySelector('[role="group"]')).toBeNull()
  })
})

describe('selectionRowsLabel', () => {
  it('returns empty for absent or anchor-less selections', () => {
    expect(selectionRowsLabel(null)).toBe('')
    expect(selectionRowsLabel(undefined)).toBe('')
    expect(selectionRowsLabel({})).toBe('')
  })

  it('reports one row for a single-cell selection', () => {
    expect(
      selectionRowsLabel({
        rowKey: 'sb-row-v1:abc',
        fieldId: 'f1',
      }),
    ).toBe('1 row')
  })

  it('degrades ranges to multiple rows (stable keys carry no ordinals)', () => {
    expect(
      selectionRowsLabel({
        rowKey: 'sb-row-v1:abc',
        endRowKey: 'sb-row-v1:def',
      }),
    ).toBe('multiple rows')
  })

  it('treats identical start and end keys as a single cell', () => {
    expect(
      selectionRowsLabel({
        rowKey: 'sb-row-v1:abc',
        endRowKey: 'sb-row-v1:abc',
      }),
    ).toBe('1 row')
  })
})

describe('remoteSelectionChips', () => {
  it('yields no chips for absent selection data', () => {
    expect(remoteSelectionChips([])).toEqual([])
    expect(remoteSelectionChips([ada, grace])).toEqual([])
  })

  it('builds one chip per peer with selection metadata', () => {
    const selecting = {
      connectionId: 7,
      info: { name: 'Ada Lovelace' },
      selection: { rowKey: 'sb-row-v1:abc', fieldId: 'conc' },
    }

    const chips = remoteSelectionChips([ada, selecting])
    expect(chips).toEqual([
      {
        key: '7',
        name: 'Ada Lovelace',
        rowsLabel: '1 row',
      },
    ])
  })

  it('keeps multi-row ranges and falls back to a generic name', () => {
    const range = {
      info: {},
      selection: { rowKey: 'a', endRowKey: 'b' },
    }

    const chips = remoteSelectionChips([range])
    expect(chips).toEqual([
      { key: 'peer-0', name: 'Someone', rowsLabel: 'multiple rows' },
    ])
  })

  it('skips selections without a stable row key', () => {
    const fieldOnly = {
      connectionId: 9,
      info: { name: 'Alan Turing' },
      selection: { fieldId: 'conc' },
    }

    expect(remoteSelectionChips([fieldOnly])).toEqual([])
  })
})

describe('coEditingPeerNames', () => {
  it('matches only peers editing the same block in editing mode', () => {
    const peers: CoEditingPeer[] = [
      {
        connectionId: 1,
        info: { name: 'Ada Lovelace' },
        presence: { activeBlockId: 'block-1', mode: 'editing' },
      },
      {
        connectionId: 2,
        info: { name: 'Grace Hopper' },
        presence: { activeBlockId: 'block-1', mode: 'viewing' },
      },
      {
        connectionId: 3,
        info: { name: 'Alan Turing' },
        presence: { activeBlockId: 'block-2', mode: 'editing' },
      },
      edsger,
    ]

    expect(coEditingPeerNames(peers, 'block-1')).toEqual(['Ada Lovelace'])
  })

  it('falls back to a generic name when meta is missing', () => {
    const peers: CoEditingPeer[] = [
      {
        connectionId: 4,
        presence: { activeBlockId: 'b', mode: 'editing' },
      },
    ]

    expect(coEditingPeerNames(peers, 'b')).toEqual(['Someone'])
  })
})

describe('BlockCoEditBadge', () => {
  const editor: RoomPeer = {
    ...ada,
    presence: { activeBlockId: 'block-1', mode: 'editing' },
  }

  it('shows the peer name while I edit the same block', () => {
    room.addPeers([editor])
    renderInRoom(<BlockCoEditBadge blockId="block-1" active />)
    expect(screen.getByText('Editing here: Ada Lovelace')).toBeTruthy()
  })

  it('uses the plural verb for several co-editors', () => {
    room.addPeers([
      editor,
      {
        ...grace,
        presence: { activeBlockId: 'block-1', mode: 'editing' },
      },
    ])
    renderInRoom(<BlockCoEditBadge blockId="block-1" active />)
    expect(
      screen.getByText('Editing here: Ada Lovelace, Grace Hopper'),
    ).toBeTruthy()
  })

  it('renders nothing when I am not editing this block', () => {
    room.addPeers([editor])

    const { container } = renderInRoom(
      <BlockCoEditBadge blockId="block-1" active={false} />,
    )

    expect(container.textContent).toBe('')
  })

  it('renders nothing when nobody else edits here', () => {
    room.addPeers([ada])

    const { container } = renderInRoom(
      <BlockCoEditBadge blockId="block-1" active />,
    )

    expect(container.textContent).toBe('')
  })

  it('renders nothing before the room is ready', () => {
    room.addPeers([editor])

    const { container } = renderInRoom(
      <BlockCoEditBadge blockId="block-1" active />,
      false,
    )

    expect(container.textContent).toBe('')
  })
})

describe('useSetPresence', () => {
  function HookProbe({ fields }: { fields: SettablePresenceFields }) {
    useSetPresence(fields)

    return null
  }

  it('reports fields on mount and restores defaults on unmount', () => {
    const updateMyPresence = vi.spyOn(room.provider, 'setPresence')

    const { unmount } = renderInRoom(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )

    expect(updateMyPresence).toHaveBeenCalledWith({
      activeBlockId: 'block-1',
      mode: 'editing',
    })
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: { activeBlockId: 'block-1', mode: 'editing' },
    })
    unmount()
    expect(updateMyPresence).toHaveBeenLastCalledWith({
      activeBlockId: null,
      activeFieldId: null,
      mode: 'viewing',
    })
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: { activeBlockId: null, activeFieldId: null, mode: 'viewing' },
    })
  })

  it('re-reports only when the semantic identity changes', () => {
    const updateMyPresence = vi.spyOn(room.provider, 'setPresence')

    const { rerender } = renderInRoom(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )

    // Same semantics via a fresh literal: no extra report.
    rerender(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )
    expect(updateMyPresence).toHaveBeenCalledTimes(1)
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: { activeBlockId: 'block-1', mode: 'editing' },
    })
    rerender(
      <HookProbe fields={{ activeBlockId: 'block-2', mode: 'editing' }} />,
    )
    expect(updateMyPresence).toHaveBeenCalledTimes(2)
    expect(updateMyPresence).toHaveBeenLastCalledWith({
      activeBlockId: 'block-2',
      mode: 'editing',
    })
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: { activeBlockId: 'block-2', mode: 'editing' },
    })
  })

  it('never publishes an abandoned suspended transition and restores defaults on unmount', async () => {
    const pending = new Promise<void>(() => {})
    const attempted = vi.fn()
    const updateMyPresence = vi.spyOn(room.provider, 'setPresence')

    function Editor({ blockId }: { blockId: string }) {
      useSetPresence({
        activeBlockId: blockId,
        activeFieldId: blockId,
        mode: 'editing',
      })

      if (blockId === 'uncommitted') {
        attempted()
        throw pending
      }

      return <p>{blockId}</p>
    }

    function Notebook() {
      const [blockId, setBlockId] = useState('committed')
      const [waiting, startTransition] = useTransition()

      return (
        <>
          <button
            onClick={() => startTransition(() => setBlockId('uncommitted'))}
          >
            Suspend edit
          </button>
          <button onClick={() => setBlockId('replacement')}>
            Abandon edit
          </button>
          {waiting ? <p>Transition pending</p> : null}
          <Suspense fallback={<p>Loading</p>}>
            <Editor blockId={blockId} />
          </Suspense>
        </>
      )
    }

    const user = userEvent.setup()
    const { unmount } = renderInRoom(<Notebook />)
    const committed = room.provider.awareness.getLocalState()
    expect(committed).toMatchObject({
      presence: {
        activeBlockId: 'committed',
        activeFieldId: 'committed',
        mode: 'editing',
      },
    })
    await user.click(screen.getByRole('button', { name: 'Suspend edit' }))
    expect(attempted).toHaveBeenCalled()
    expect(screen.getByText('Transition pending')).toBeTruthy()
    expect(screen.getByText('committed')).toBeTruthy()
    expect(room.provider.awareness.getLocalState()).toEqual(committed)
    expect(updateMyPresence).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Abandon edit' }))
    expect(screen.getByText('replacement')).toBeTruthy()
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: {
        activeBlockId: 'replacement',
        activeFieldId: 'replacement',
        mode: 'editing',
      },
    })
    expect(updateMyPresence).toHaveBeenCalledTimes(2)
    expect(updateMyPresence).not.toHaveBeenCalledWith({
      activeBlockId: 'uncommitted',
      activeFieldId: 'uncommitted',
      mode: 'editing',
    })
    unmount()
    expect(room.provider.awareness.getLocalState()).toMatchObject({
      presence: { activeBlockId: null, activeFieldId: null, mode: 'viewing' },
    })
  })
})
