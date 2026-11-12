import { describe, expect, it } from 'vitest'

import { parseStartRules } from './start-rules'
import {
  buildTimeline,
  nextStarts,
  occurrences,
  previewStarts,
  startKind,
} from './starts-view'

const daily = (id: string, dailyAt: string, enabled = true) => ({
  id,
  kind: 'daily' as const,
  spec: { dailyAt, timeZone: 'UTC' },
  enabled,
})

const snapshot = (id: string) => ({
  id,
  kind: 'event' as const,
  spec: { eventType: 'dataset.versioned' },
  enabled: true,
})

// Wednesday 11 November 2026, noon UTC.
const NOW = new Date('2026-11-11T12:00:00Z')

describe('startKind', () => {
  it('names a snapshot start, another event, and a timed schedule', () => {
    expect(startKind(snapshot('a'))).toBe('snapshot')
    expect(
      startKind({ kind: 'event', spec: { eventType: 'sample.created' } }),
    ).toBe('event')
    expect(startKind(daily('a', '09:00'))).toBe('schedule')
  })
})

describe('occurrences', () => {
  it('lists each firing in order and none for an event start', () => {
    const times = occurrences(
      daily('a', '09:00'),
      new Date('2026-11-09T00:00:00Z'),
      NOW,
    )

    expect(times.map((d) => d.toISOString())).toEqual([
      '2026-11-09T09:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
      '2026-11-11T09:00:00.000Z',
    ])
    expect(occurrences(snapshot('e'), new Date(0), NOW)).toEqual([])
  })
})

describe('nextStarts', () => {
  const rules = parseStartRules({
    window: {
      days: 'daily',
      from: '07:00',
      to: '19:00',
      timeZone: 'UTC',
    },
  })

  it('shows the soonest and marks one outside the hours', () => {
    const next = nextStarts(
      [
        daily('a', '09:00'),
        daily('b', '22:00'),
        daily('paused', '10:00', false),
      ],
      rules,
      NOW,
      3,
    )

    expect(next.map((n) => [n.scheduleId, n.state])).toEqual([
      ['b', 'outside'],
      ['a', 'planned'],
      ['b', 'outside'],
    ])
  })
})

describe('previewStarts', () => {
  const rules = parseStartRules({
    window: {
      days: 'weekdays',
      from: '07:00',
      to: '19:00',
      timeZone: 'UTC',
    },
    minNewRows: 5,
    waitMinutes: 30,
  })

  const event = (id: string, at: string, newRows: number) => ({
    scheduleId: 's1',
    eventId: id,
    at: new Date(at),
    label: `DS-1 ${id}`,
    newRows,
  })

  it('joins snapshots within the wait and judges the sum', () => {
    const result = previewStarts({
      schedules: [],
      events: [
        event('S-1', '2026-11-10T10:00:00Z', 2),
        event('S-2', '2026-11-10T10:10:00Z', 4),
        event('S-3', '2026-11-10T14:00:00Z', 1),
      ],
      rules,
      now: NOW,
      days: 7,
    })

    expect(result.wouldStart).toBe(1)
    expect(result.wouldSkip).toBe(1)
    expect(result.batched).toBe(1)

    const started = result.rows.find((r) => r.outcome === 'start')

    expect(started?.newRows).toBe(6)
    expect(started?.joined).toBe(1)

    const skipped = result.rows.find((r) => r.outcome === 'skipped')

    expect(skipped?.reason).toBe('rows')
  })

  it('skips a schedule tick outside the hours', () => {
    const result = previewStarts({
      schedules: [daily('night', '22:00')],
      events: [],
      rules,
      now: NOW,
      days: 3,
    })

    expect(result.wouldStart).toBe(0)
    expect(result.rows.every((r) => r.reason === 'window')).toBe(true)
    expect(result.wouldSkip).toBe(result.rows.length)
  })
})

describe('buildTimeline', () => {
  it('puts each item on its day, by time of day', () => {
    const days = buildTimeline({
      items: [
        {
          id: 'r1',
          at: new Date('2026-11-11T06:00:00Z'),
          kind: 'ok',
          runId: 'r1',
        },
        {
          id: 'k1',
          at: new Date('2026-11-10T18:00:00Z'),
          kind: 'skip',
          runId: null,
        },
      ],
      now: NOW,
      days: 7,
      timeZone: 'UTC',
    })

    expect(days).toHaveLength(7)
    expect(days.at(-1)?.today).toBe(true)
    expect(days.at(-1)?.items[0]?.fraction).toBeCloseTo(0.25)
    expect(days.at(-2)?.items[0]?.fraction).toBeCloseTo(0.75)
  })
})
