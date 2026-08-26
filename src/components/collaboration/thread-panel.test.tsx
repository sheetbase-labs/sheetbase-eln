/**
 * COLLAB-02 ThreadPanel tests. The room hooks are mocked at the project's
 * single Liveblocks import surface ('#/lib/collaboration/liveblocks.config')
 * so the panel's own logic — anchor filtering, unresolved counting, the
 * unresolved-only toggle, resolve/reopen actions, role-gated composer and
 * room-mismatch guarding — can be exercised deterministically.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { anchorToMetadata } from '#/lib/collaboration/anchors'
import type { ThreadAnchor } from '#/lib/collaboration/types'

import { ThreadPanel } from './thread-panel'

const h = vi.hoisted(() => ({
  threads: [] as Array<Record<string, unknown>>,
  roomId: '',
  markResolved: vi.fn(),
  markUnresolved: vi.fn(),
}))

vi.mock('#/lib/collaboration/liveblocks.config', () => ({
  useRoom: () => ({ id: h.roomId }),
  useThreads: () => ({ threads: h.threads }),
  useMarkThreadAsResolved: () => h.markResolved,
  useMarkThreadAsUnresolved: () => h.markUnresolved,
}))

// The panel gates on room readiness before running any room hook; stub the
// guard as ready so the inner panel renders.
vi.mock('./collaboration-room', () => ({
  useCollaborationRoomReady: () => true,
}))

// Render only structural output for the pre-built Liveblocks components —
// their real implementations need a full editor environment.
vi.mock('@liveblocks/react-ui', () => ({
  Thread: ({ thread }: { thread: { id: string } }) => (
    <div data-testid={`thread-${thread.id}`} />
  ),
  Composer: ({ metadata }: { metadata: Record<string, unknown> }) => (
    <div
      data-testid="composer"
      data-metadata={JSON.stringify(metadata)}
      aria-label="Composer"
    />
  ),
}))

afterEach(() => {
  cleanup()
  h.threads = []
  h.markResolved.mockClear()
  h.markUnresolved.mockClear()
})

const WS_A = '11111111-1111-4111-8111-111111111111'
const RECORD_A = '22222222-2222-4222-8222-222222222222'
const RECORD_B = '33333333-3333-4333-8333-333333333333'
const BLOCK_B = '44444444-4444-4444-8444-444444444444'
const ROOM_A = `workspace:${WS_A}:record:${RECORD_A}`
const ROOM_B = `workspace:${WS_A}:record:${RECORD_B}`

beforeEach(() => {
  h.roomId = ROOM_A
})

function fakeThread(
  id: string,
  metadata: Record<string, unknown>,
  resolved: boolean,
): Record<string, unknown> {
  return {
    id,
    metadata,
    resolved,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    comments: [],
  }
}

/** Two threads anchored to the record under test (one open, one resolved). */
function threadsForRecord(): void {
  const recordAnchor: ThreadAnchor = {
    anchorType: 'record',
    workspaceId: WS_A,
    recordId: RECORD_A,
  }
  const metadata = anchorToMetadata(recordAnchor)
  h.threads = [
    fakeThread('t-open', metadata, false),
    fakeThread('t-resolved', metadata, true),
    // Same room, different anchor (another block) — must be filtered out.
    fakeThread(
      't-other-block',
      anchorToMetadata({
        anchorType: 'notebook-block',
        workspaceId: WS_A,
        recordId: RECORD_A,
        blockId: BLOCK_B,
      }),
      false,
    ),
    // Right anchor shape but another room — must be filtered out.
    fakeThread(
      't-other-record',
      anchorToMetadata({
        anchorType: 'record',
        workspaceId: WS_A,
        recordId: RECORD_B,
      }),
      false,
    ),
  ]
}

describe('ThreadPanel', () => {
  it('renders only threads matching the anchor in its own room', () => {
    threadsForRecord()
    render(
      <ThreadPanel
        anchor={{
          anchorType: 'record',
          workspaceId: WS_A,
          recordId: RECORD_A,
        }}
      />,
    )
    expect(screen.getByTestId('thread-t-open')).toBeTruthy()
    expect(screen.getByTestId('thread-t-resolved')).toBeTruthy()
    expect(screen.queryByTestId('thread-t-other-block')).toBeNull()
    expect(screen.queryByTestId('thread-t-other-record')).toBeNull()
    expect(screen.getByText('1 unresolved')).toBeTruthy()
  })

  it('hides resolved threads when unresolved-only is checked', () => {
    threadsForRecord()
    render(
      <ThreadPanel
        anchor={{
          anchorType: 'record',
          workspaceId: WS_A,
          recordId: RECORD_A,
        }}
      />,
    )
    fireEvent.click(screen.getByLabelText('Unresolved only'))
    expect(screen.getByTestId('thread-t-open')).toBeTruthy()
    expect(screen.queryByTestId('thread-t-resolved')).toBeNull()
    // The count still reflects every thread on this anchor.
    expect(screen.getByText('1 unresolved')).toBeTruthy()
  })

  it('resolve and reopen call the room mutation hooks', () => {
    threadsForRecord()
    render(
      <ThreadPanel
        anchor={{
          anchorType: 'record',
          workspaceId: WS_A,
          recordId: RECORD_A,
        }}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Resolve thread t-open' }),
    )
    expect(h.markResolved).toHaveBeenCalledWith('t-open')
    fireEvent.click(
      screen.getByRole('button', { name: 'Reopen thread t-resolved' }),
    )
    expect(h.markUnresolved).toHaveBeenCalledWith('t-resolved')
    expect(h.markResolved).toHaveBeenCalledTimes(1)
    expect(h.markUnresolved).toHaveBeenCalledTimes(1)
  })

  it('stamps new composer threads with the flat anchor metadata', () => {
    threadsForRecord()
    const anchor: ThreadAnchor = {
      anchorType: 'record',
      workspaceId: WS_A,
      recordId: RECORD_A,
    }
    render(<ThreadPanel anchor={anchor} currentRole="member" />)
    const composer = screen.getByTestId('composer')
    expect(JSON.parse(composer.getAttribute('data-metadata')!)).toEqual(
      anchorToMetadata(anchor),
    )
  })

  it('hides the composer for read-only viewers', () => {
    threadsForRecord()
    render(
      <ThreadPanel
        anchor={{
          anchorType: 'record',
          workspaceId: WS_A,
          recordId: RECORD_A,
        }}
        currentRole="viewer"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Composer' })).toBeNull()
  })

  it('renders nothing when mounted outside the anchor’s room', () => {
    threadsForRecord()
    h.roomId = ROOM_B
    const { container } = render(
      <ThreadPanel
        anchor={{
          anchorType: 'record',
          workspaceId: WS_A,
          recordId: RECORD_A,
        }}
      />,
    )
    expect(container.querySelector('[data-testid="thread-panel"]')).toBeNull()
  })
})
