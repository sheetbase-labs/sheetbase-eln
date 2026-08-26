import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ObjectHistoryTimeline } from './object-history-timeline'
import type { AuditEventWire } from '#/lib/audit-history'

function event(overrides: Partial<AuditEventWire>): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-08-26T10:00:00.000000Z',
    entityType: 'record',
    entityUuid: '00000000-0000-4000-8000-000000000001',
    operation: 'update',
    recordId: null,
    projectId: '10000000-0000-4000-8000-000000000009',
    actorUserId: 'actor-1',
    actorName: 'Ada Scientist',
    actorCredentialId: null,
    clientId: null,
    payload: {},
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('ObjectHistoryTimeline', () => {
  it('renders semantic phrases with before/after values', () => {
    render(
      <ObjectHistoryTimeline
        events={[
          event({
            entityType: 'record',
            payload: {
              title: 'Renamed Notebook',
              changes: {
                title: { from: 'Baseline Notebook', to: 'Renamed Notebook' },
              },
            },
          }),
        ]}
      />,
    )
    expect(screen.getByText('Ada Scientist')).toBeTruthy()
    expect(screen.getByText('updated')).toBeTruthy()
    expect(screen.getByText('Baseline Notebook')).toBeTruthy()
    expect(screen.getByText('Renamed Notebook')).toBeTruthy()
  })

  it('keeps the raw payload out of sight behind a disclosure', () => {
    render(
      <ObjectHistoryTimeline
        events={[event({ payload: { title: 'Notebook' } })]}
      />,
    )
    const summaries = screen.getAllByText('Raw event')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].closest('details')?.hasAttribute('open')).toBe(false)
  })

  it('shows an honest empty state instead of fabricating history', () => {
    render(<ObjectHistoryTimeline events={[]} />)
    expect(
      screen.getByText('No recorded activity for this object yet.'),
    ).toBeTruthy()
  })

  it('surfaces permission failures as a distinct error state', () => {
    render(<ObjectHistoryTimeline events={[]} error="History is not available for this dataset." />)
    expect(
      screen.getByText('History is not available for this dataset.'),
    ).toBeTruthy()
  })
})
