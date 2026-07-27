import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  mapTimelineEvents,
  RecordHistoryTimeline,
} from './record-history-timeline'
import type { TimelineEventWire } from '#/lib/sign-002'

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const baseEvents: TimelineEventWire[] = [
  {
    type: 'change_event',
    id: 'ce-1',
    seq: 1,
    ts: '2026-07-20T10:00:00.000Z',
    operation: 'create',
    actorUserId: 'owner-a',
    title: 'record create',
  },
  {
    type: 'revision',
    id: 'rev-1',
    seq: null,
    ts: '2026-07-21T10:00:00.000Z',
    reason: 'submit',
    actorUserId: 'owner-a',
    title: 'revision submit',
  },
  {
    type: 'submission',
    id: 'sub-1',
    seq: null,
    ts: '2026-07-21T10:05:00.000Z',
    state: 'submitted',
    actorUserId: 'owner-a',
    title: 'review submitted',
  },
  {
    type: 'decision',
    id: 'dec-1',
    seq: null,
    ts: '2026-07-22T10:00:00.000Z',
    decision: 'approve',
    actorUserId: 'reviewer-a',
    title: 'review approve',
  },
  {
    type: 'check',
    id: 'chk-1',
    seq: null,
    ts: '2026-07-22T09:00:00.000Z',
    overallStatus: 'passed',
    actorUserId: 'reviewer-a',
    title: 'checks passed',
  },
  {
    type: 'signature',
    id: 'sig-1',
    seq: null,
    ts: '2026-07-23T10:00:00.000Z',
    signatureMeaning: 'approve-for-record',
    actorUserId: 'reviewer-a',
    title: 'signature approve-for-record',
  },
  {
    type: 'comment',
    id: 'cmt-1',
    seq: null,
    ts: '2026-07-21T11:00:00.000Z',
    state: 'open',
    actorUserId: 'reviewer-a',
    title: 'comment open',
  },
  {
    type: 'change_event',
    id: 'ce-lock',
    seq: 7,
    ts: '2026-07-23T10:00:01.000Z',
    operation: 'lock',
    actorUserId: null,
    title: 'record lock',
  },
  {
    type: 'change_event',
    id: 'ce-amend',
    seq: 8,
    ts: '2026-07-25T10:00:00.000Z',
    operation: 'amend',
    actorUserId: 'owner-a',
    title: 'record amend',
  },
]

describe('mapTimelineEvents', () => {
  it('maps every event kind to an AuditTrail entry with a stable id', () => {
    const mapped = mapTimelineEvents(baseEvents)
    expect(mapped).toHaveLength(baseEvents.length)
    expect(mapped.map((e) => e.id)).toEqual(
      baseEvents.map((e) => `${e.type}-${e.id}`),
    )
  })

  it('labels the current user by name and others by id prefix', () => {
    const mapped = mapTimelineEvents(baseEvents, 'owner-a', 'Alice Author')
    const ownerEvent = mapped.find((e) => e.id === 'change_event-ce-1')!
    expect(ownerEvent.actor?.name).toBe('Alice Author')
    const reviewerEvent = mapped.find((e) => e.id === 'decision-dec-1')!
    expect(reviewerEvent.actor?.name).toBe('reviewer')
  })

  it('attributes system events (null actor) to System', () => {
    const mapped = mapTimelineEvents(baseEvents)
    const lockEvent = mapped.find((e) => e.id === 'change_event-ce-lock')!
    expect(lockEvent.actor?.name).toBe('System')
  })

  it('preserves the input order from the RPC (does not reorder)', () => {
    // The RPC already orders by ts; the mapper must keep that order.
    const mapped = mapTimelineEvents(baseEvents)
    expect(mapped.map((e) => e.id)).toEqual(
      baseEvents.map((e) => `${e.type}-${e.id}`),
    )
  })
})

describe('RecordHistoryTimeline', () => {
  it('renders the heading and each event title', () => {
    render(
      <RecordHistoryTimeline
        events={baseEvents}
        currentUserId="owner-a"
        currentUserName="Alice Author"
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Complete history' }),
    ).toBeTruthy()
    expect(screen.getByText('record create')).toBeTruthy()
    expect(screen.getByText('review approve')).toBeTruthy()
    expect(screen.getByText('signature approve-for-record')).toBeTruthy()
  })

  it('shows a skeleton state while loading', () => {
    const { container } = render(<RecordHistoryTimeline events={[]} loading />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('shows an error state with a retry control', () => {
    render(
      <RecordHistoryTimeline
        events={[]}
        error={new Error('boom')}
        onRefresh={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not load the record history',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('renders the footer integrity line when a revision is supplied', () => {
    render(
      <RecordHistoryTimeline
        events={[]}
        revisionId="rev-abcdef123456"
        integrityDigest={'a'.repeat(64)}
      />,
    )
    const footer = screen.getByText(/rev-abcdef/)
    expect(footer.textContent).toContain('integrity')
  })

  it('renders an empty state when there are no events', () => {
    render(<RecordHistoryTimeline events={[]} />)
    expect(screen.getByText('No activity yet')).toBeTruthy()
  })
})
