/**
 * COLLAB-01 presence component tests. Room hooks are mocked at the
 * project's single Liveblocks import surface
 * ('#/lib/collaboration/liveblocks.config') so the stack, chips, badge and
 * presence-sync hook logic can be exercised deterministically.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PresenceStack } from './presence-avatars'
import { BlockCoEditBadge, coEditingPeerNames } from './presence-co-editing'
import { remoteSelectionChips, selectionRowsLabel } from './selection-label'
import { useSetPresence } from './use-set-presence'

const h = vi.hoisted(() => ({
  ready: true,
  others: [] as Array<Record<string, unknown>>,
  updateMyPresence: vi.fn(),
}))

vi.mock('#/lib/collaboration/liveblocks.config', () => ({
  useOthers: () => h.others,
  useUpdateMyPresence: () => h.updateMyPresence,
}))

// Every presence surface gates on room readiness before running room hooks;
// stub the guard as ready (and toggleable for gate tests).
vi.mock('./collaboration-room', () => ({
  useCollaborationRoomReady: () => h.ready,
}))

afterEach(() => {
  cleanup()
  h.others = []
  h.ready = true
  h.updateMyPresence.mockClear()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

const ada = { connectionId: 1, info: { name: 'Ada Lovelace' }, presence: {} }
const grace = { connectionId: 2, info: { name: 'Grace Hopper' }, presence: {} }
const alan = { connectionId: 3, info: { name: 'Alan Turing' }, presence: {} }
const edsger = { connectionId: 4, info: { name: 'Edsger Dijkstra' } }
const barbara = { connectionId: 5, info: { name: 'Barbara Liskov' } }

describe('PresenceStack', () => {
  it('renders an avatar with an accessible name per other user', () => {
    h.others = [ada, grace]
    const { container } = render(<PresenceStack />)
    expect(screen.getByLabelText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByLabelText('Grace Hopper')).toBeTruthy()
    // Initials fallback renders inside each avatar.
    expect(container.textContent).toContain('AL')
    expect(container.textContent).toContain('GH')
  })

  it('labels the group with how many others are here', () => {
    h.others = [ada, grace]
    render(<PresenceStack />)
    expect(screen.getByRole('group', { name: '2 here' })).toBeTruthy()
  })

  it('collapses beyond max into a +N overflow badge', () => {
    h.others = [ada, grace, alan, edsger, barbara]
    render(<PresenceStack />)
    // Only the first four get avatars; Barbara is folded into +1.
    expect(screen.queryByLabelText('Barbara Liskov')).toBeNull()
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('exposes the peer name as a native tooltip on each avatar', () => {
    h.others = [ada, grace]
    render(<PresenceStack />)
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
    h.others = []
    const { container } = render(<PresenceStack />)
    expect(container.querySelector('[role="group"]')).toBeNull()
  })

  it('renders nothing before the collaboration room is ready', () => {
    h.ready = false
    h.others = [ada]
    const { container } = render(<PresenceStack />)
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
    const peers = [
      {
        connectionId: 1,
        info: { name: 'Ada Lovelace' },
        presence: { activeBlockId: 'block-1', mode: 'editing' as const },
      },
      {
        connectionId: 2,
        info: { name: 'Grace Hopper' },
        presence: { activeBlockId: 'block-1', mode: 'viewing' as const },
      },
      {
        connectionId: 3,
        info: { name: 'Alan Turing' },
        presence: { activeBlockId: 'block-2', mode: 'editing' as const },
      },
      edsger,
    ]
    expect(coEditingPeerNames(peers, 'block-1')).toEqual(['Ada Lovelace'])
  })

  it('falls back to a generic name when meta is missing', () => {
    const peers = [
      {
        connectionId: 4,
        presence: { activeBlockId: 'b', mode: 'editing' as const },
      },
    ]
    expect(coEditingPeerNames(peers, 'b')).toEqual(['Someone'])
  })
})

describe('BlockCoEditBadge', () => {
  const editor = {
    connectionId: 1,
    info: { name: 'Ada Lovelace' },
    presence: { activeBlockId: 'block-1', mode: 'editing' },
  }

  it('shows the peer name while I edit the same block', () => {
    h.others = [editor]
    render(<BlockCoEditBadge blockId="block-1" active />)
    expect(screen.getByText('Ada Lovelace is editing here')).toBeTruthy()
  })

  it('uses the plural verb for several co-editors', () => {
    h.others = [
      editor,
      {
        connectionId: 2,
        info: { name: 'Grace Hopper' },
        presence: { activeBlockId: 'block-1', mode: 'editing' },
      },
    ]
    render(<BlockCoEditBadge blockId="block-1" active />)
    expect(
      screen.getByText('Ada Lovelace, Grace Hopper are editing here'),
    ).toBeTruthy()
  })

  it('renders nothing when I am not editing this block', () => {
    h.others = [editor]
    const { container } = render(
      <BlockCoEditBadge blockId="block-1" active={false} />,
    )
    expect(container.textContent).toBe('')
  })

  it('renders nothing when nobody else edits here', () => {
    h.others = [ada]
    const { container } = render(<BlockCoEditBadge blockId="block-1" active />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing before the room is ready', () => {
    h.ready = false
    h.others = [editor]
    const { container } = render(<BlockCoEditBadge blockId="block-1" active />)
    expect(container.textContent).toBe('')
  })
})

describe('useSetPresence', () => {
  function HookProbe({ fields }: { fields: Record<string, unknown> }) {
    useSetPresence(fields)
    return null
  }

  it('reports fields on mount and restores defaults on unmount', () => {
    const { unmount } = render(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )
    expect(h.updateMyPresence).toHaveBeenCalledWith({
      activeBlockId: 'block-1',
      mode: 'editing',
    })
    unmount()
    expect(h.updateMyPresence).toHaveBeenLastCalledWith({
      activeBlockId: null,
      activeFieldId: null,
      mode: 'viewing',
    })
  })

  it('re-reports only when the semantic identity changes', () => {
    const { rerender } = render(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )
    // Same semantics via a fresh literal: no extra report.
    rerender(
      <HookProbe fields={{ activeBlockId: 'block-1', mode: 'editing' }} />,
    )
    expect(h.updateMyPresence).toHaveBeenCalledTimes(1)
    rerender(
      <HookProbe fields={{ activeBlockId: 'block-2', mode: 'editing' }} />,
    )
    expect(h.updateMyPresence).toHaveBeenCalledTimes(2)
    expect(h.updateMyPresence).toHaveBeenLastCalledWith({
      activeBlockId: 'block-2',
      mode: 'editing',
    })
  })
})
