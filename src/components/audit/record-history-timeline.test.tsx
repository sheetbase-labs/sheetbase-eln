import { cleanup, render as plainRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { mapTimelineEvents } from './record-history-events'
import { RecordHistoryTimeline } from './record-history-timeline'
import type { TimelineEventWire } from '#/lib/sign-002'

afterEach(() => cleanup())

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return plainRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

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

describe('mapTimelineEvents names', () => {
  it('uses a resolved name for another person instead of a short id', () => {
    const [event] = mapTimelineEvents(
      [
        {
          type: 'signature',
          id: 'e1',
          seq: null,
          ts: '2026-01-01T00:00:00Z',
          title: 'Signed',
          actorUserId: 'abcdef0123456789',
        },
      ],
      'me',
      'Me',
      (id) => (id === 'abcdef0123456789' ? 'Mei L.' : undefined),
    )

    expect(event.actor?.name).toBe('Mei L.')
    expect(event.actor?.userId).toBe('abcdef0123456789')
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
    expect(screen.getByText('Record created')).toBeTruthy()
    expect(screen.getByText('Review approve')).toBeTruthy()
    expect(screen.getByText('Signature approve for record')).toBeTruthy()
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
      'Couldn’t load the record history',
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

describe('captured change facts', () => {
  it('names a protocol deviation by the field it captured', () => {
    const mapped = mapTimelineEvents([
      {
        type: 'change_event',
        id: 'ce-deviation',
        seq: 9,
        ts: '2026-07-26T10:00:00.000Z',
        operation: 'update',
        actorUserId: 'owner-a',
        title: 'protocol_deviation update',
        payload: {
          effect: 'protocol_deviation',
          frozenText: 'Hold at 2-8 C for 14 days.',
          recordedText: 'Hold at 2-8 C for 21 days.',
          changes: {
            text: {
              from: 'Hold at 2-8 C for 14 days.',
              to: 'Hold at 2-8 C for 21 days.',
              label: 'Protocol step text',
            },
          },
        },
      },
      {
        type: 'change_event',
        id: 'ce-plain',
        seq: 10,
        ts: '2026-07-26T10:01:00.000Z',
        operation: 'update',
        actorUserId: 'owner-a',
        title: 'record update',
        payload: { title: 'Renamed' },
      },
    ])

    expect(mapped[0].target).toBe('Protocol step text')
    // A payload without captured facts has no detail: the title says it.
    expect(mapped[1].target).toBeUndefined()
    expect(mapped[1].title).toBe('Record updated')
  })
})

describe('duplicate create entries', () => {
  it('shows a model record creation once', () => {
    const mapped = mapTimelineEvents([
      {
        type: 'change_event',
        id: 'a',
        seq: 1,
        ts: '2026-07-26T10:00:00.000Z',
        eventType: 'incident',
        operation: 'create',
        actorUserId: 'u',
        title: 'incident create',
      },
      {
        type: 'change_event',
        id: 'b',
        seq: 2,
        ts: '2026-07-26T10:00:00.000Z',
        eventType: 'record',
        operation: 'create',
        actorUserId: 'u',
        title: 'record create',
      },
    ])

    expect(mapped.map((e) => e.title)).toEqual(['Incident created'])
  })
})
