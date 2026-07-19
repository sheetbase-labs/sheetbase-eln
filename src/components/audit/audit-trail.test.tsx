import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AuditTrail } from './audit-trail'
import type { AuditEvent } from './audit-trail'

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const events: AuditEvent[] = [
  {
    id: '1',
    type: 'created',
    title: 'Experiment created',
    actor: { name: 'Gareth Price' },
    timestamp: '09:12',
  },
  {
    id: '2',
    type: 'uploaded',
    title: 'Dataset attached',
    actor: { name: 'Mia Chen' },
    timestamp: '10:41',
    target: 'Stability_Raw_Data.csv',
  },
  {
    id: '3',
    type: 'review-requested',
    title: 'Review requested',
    timestamp: '11:42',
  },
]

describe('AuditTrail', () => {
  it('renders events in order with actor and timestamp', () => {
    render(<AuditTrail events={events} />)
    expect(screen.getByText('Experiment created')).toBeTruthy()
    expect(screen.getAllByText(/Gareth Price/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Mia Chen/).length).toBeGreaterThanOrEqual(1)
    expect(
      screen.getAllByText(/Stability_Raw_Data.csv/).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('exposes a complete sr-only sentence per event', () => {
    render(<AuditTrail events={events} />)
    expect(
      screen.getByText('Gareth Price experiment created at 09:12.'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Mia Chen dataset attached on Stability_Raw_Data.csv at 10:41.',
      ),
    ).toBeTruthy()
    // System event with no actor.
    expect(screen.getByText('System review requested at 11:42.')).toBeTruthy()
  })

  it('handles missing actor data honestly (unknown user)', () => {
    render(
      <AuditTrail
        events={[
          {
            id: '1',
            type: 'created',
            title: 'Created',
            actor: { name: 'Deleted user', unknown: true },
            timestamp: '09:00',
          },
        ]}
      />,
    )
    expect(screen.getByText('Unknown user · 09:00')).toBeTruthy()
  })

  it('renders a loading skeleton and no events', () => {
    render(<AuditTrail events={[]} loading />)
    expect(screen.queryByText('Experiment created')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('renders an empty hint when there are no events', () => {
    render(<AuditTrail events={[]} />)
    expect(screen.getByText('No activity yet')).toBeTruthy()
  })

  it('shows a load-more control when totalCount exceeds events and fires onLoadMore', async () => {
    const onLoadMore = vi.fn()
    const user = userEvent.setup()
    render(
      <AuditTrail events={events} totalCount={84} onLoadMore={onLoadMore} />,
    )
    expect(screen.getByText(/Showing 3 of 84 events/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Load more/ }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not show load-more when all events are loaded', () => {
    render(<AuditTrail events={events} totalCount={3} />)
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
  })
})
