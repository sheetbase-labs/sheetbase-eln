import { describe, expect, it } from 'vitest'

import type { SampleEvent } from '#/lib/samples'
import {
  formatSampleEventTime,
  formatSampleEventTimestamp,
  sampleEventAction,
  sampleEventChange,
  sampleEventDetail,
} from './sample-history'

function event(overrides: Partial<SampleEvent> = {}): SampleEvent {
  return {
    id: 'e1',
    recordId: 's1',
    operation: 'consume',
    quantityDelta: -10350,
    quantityBefore: 14950,
    quantityAfter: 4600,
    quantityUnit: 'mL',
    fromLocation: null,
    toLocation: null,
    actorUserId: 'u1',
    purposeRecordId: null,
    notes: null,
    createdAt: '2026-09-23T09:15:00.000Z',
    ...overrides,
  }
}

describe('sampleEventAction', () => {
  it('maps canonical operations to the design actions', () => {
    expect(sampleEventAction('create')).toBe('Registered')
    expect(sampleEventAction('receive')).toBe('Received')
    expect(sampleEventAction('consume')).toBe('Withdrew')
    expect(sampleEventAction('transfer')).toBe('Moved')
    expect(sampleEventAction('edit')).toBe('Edited')
    expect(sampleEventAction('archive')).toBe('Archived')
    expect(sampleEventAction('restore')).toBe('Restored')
  })

  it('falls back to the raw operation for unknown kinds', () => {
    expect(sampleEventAction('hold_exceeded')).toBe('hold exceeded')
  })
})

describe('sampleEventChange', () => {
  it('renders the volume transition in the design format', () => {
    expect(sampleEventChange(event())).toBe('Volume 14,950 → 4,600 mL')
  })

  it('returns null when the event carries no quantity', () => {
    expect(
      sampleEventChange(
        event({
          quantityDelta: null,
          quantityBefore: null,
          quantityAfter: null,
          quantityUnit: null,
        }),
      ),
    ).toBeNull()
  })
})

describe('sampleEventDetail', () => {
  it('prefers the recorded notes', () => {
    expect(sampleEventDetail(event({ notes: 'Filter runs A–C' }))).toBe(
      'Filter runs A–C',
    )
  })

  it('falls back to a location transition for transfers', () => {
    expect(
      sampleEventDetail(
        event({
          operation: 'transfer',
          notes: null,
          fromLocation: 'CR-1 shelf 3',
          toLocation: 'F-2 box 14 A1',
        }),
      ),
    ).toBe('CR-1 shelf 3 → F-2 box 14 A1')
  })

  it('returns null when nothing is recorded', () => {
    expect(
      sampleEventDetail(
        event({
          notes: null,
          quantityDelta: null,
          quantityBefore: null,
          quantityAfter: null,
        }),
      ),
    ).toBeNull()
  })
})

describe('sample event time formatting', () => {
  it('formats the When cell deterministically in UTC', () => {
    expect(formatSampleEventTime('2026-09-23T09:15:00.000Z')).toBe(
      '23 Sep 09:15',
    )
  })

  it('formats a full timestamp for the title attribute', () => {
    expect(formatSampleEventTimestamp('2026-09-23T09:15:00.000Z')).toBe(
      '23 Sep 2026, 09:15 UTC',
    )
  })

  it('returns the raw value for an invalid date', () => {
    expect(formatSampleEventTime('not-a-date')).toBe('not-a-date')
    expect(formatSampleEventTimestamp('not-a-date')).toBe('not-a-date')
  })
})
