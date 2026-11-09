import { describe, expect, it } from 'vitest'

import { buildIcs, foldLine, isFeedToken } from './calendar-feed'
import type { FeedEvent } from './calendar-feed'

const event: FeedEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Plate run, batch 4; rerun',
  resource: 'Plate reader PR-01',
  starts_at: '2026-11-05T09:30:00+00:00',
  ends_at: '2026-11-05T11:00:00+00:00',
  all_day: false,
  status: 'confirmed',
  location: 'Lab 2',
  notes: 'Bring plates\nand tips',
  updated_at: '2026-11-04T08:00:00.123+00:00',
}

describe('calendar feed', () => {
  it('writes one event with escaped text and UTC times', () => {
    const ics = buildIcs({ name: 'My bookings', events: [event] })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:My bookings')
    expect(ics).toContain('UID:11111111-1111-4111-8111-111111111111@sheetbase')
    expect(ics).toContain('DTSTART:20261105T093000Z')
    expect(ics).toContain('DTEND:20261105T110000Z')
    expect(ics).toContain('DTSTAMP:20261104T080000Z')
    expect(ics).toContain(
      'SUMMARY:Plate reader PR-01: Plate run\\, batch 4\\; rerun',
    )
    expect(ics).toContain('DESCRIPTION:Bring plates\\nand tips')
    expect(ics).toContain('STATUS:CONFIRMED')
  })

  it('marks tentative and cancelled bookings', () => {
    const ics = buildIcs({
      name: 'All bookings',
      events: [
        { ...event, status: 'tentative' },
        { ...event, id: '2', status: 'cancelled' },
      ],
    })

    expect(ics).toContain('STATUS:TENTATIVE')
    expect(ics).toContain('STATUS:CANCELLED')
  })

  it('writes an all-day booking as dates, ending the day after', () => {
    const ics = buildIcs({
      name: 'x',
      events: [
        {
          ...event,
          all_day: true,
          starts_at: '2026-11-05T00:00:00+00:00',
          ends_at: '2026-11-06T00:00:00+00:00',
        },
      ],
    })

    expect(ics).toContain('DTSTART;VALUE=DATE:20261105')
    expect(ics).toContain('DTEND;VALUE=DATE:20261107')
  })

  it('folds long lines at 75 octets without splitting a character', () => {
    const long = `SUMMARY:${'é'.repeat(60)}`
    const folded = foldLine(long)

    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }

    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  it('only takes a 64 character hex secret', () => {
    expect(isFeedToken('a'.repeat(64))).toBe(true)
    expect(isFeedToken('A'.repeat(64))).toBe(false)
    expect(isFeedToken('abc')).toBe(false)
    expect(isFeedToken('')).toBe(false)
  })
})
