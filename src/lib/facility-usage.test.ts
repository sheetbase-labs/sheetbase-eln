import { describe, expect, it } from 'vitest'

import {
  bookingsCsv,
  groupUsage,
  lineCharge,
  rechargeCsv,
  toUsageLine,
  utilisationByInstrument,
} from './facility-usage'
import type { UsageLabels, UsageLine } from './facility-usage'

function line(overrides: Partial<UsageLine>): UsageLine {
  return {
    bookingId: 'b1',
    instrumentId: 'i1',
    instrumentName: 'Plate reader',
    instrumentCode: 'INS-0001',
    userId: 'ada',
    projectId: 'p1',
    projectTitle: 'Antibody screen',
    title: 'Run 1',
    startsAt: '2026-11-03T09:00:00Z',
    endsAt: '2026-11-03T12:00:00Z',
    hours: 3,
    ratePerHour: 10,
    currency: 'GBP',
    ...overrides,
  }
}

const labels: UsageLabels = {
  person: (id) =>
    id === 'ada' ? 'Ada Lovelace' : id === 'bo' ? 'Bo, Jr.' : 'Nobody',
  project: (l) => l.projectTitle ?? 'No project',
}

const LINES = [
  line({ bookingId: 'b1' }),
  line({ bookingId: 'b2', hours: 2, userId: 'bo' }),
  line({
    bookingId: 'b3',
    instrumentId: 'i2',
    instrumentName: 'Sequencer',
    instrumentCode: null,
    hours: 4,
    ratePerHour: null,
    currency: null,
    projectId: null,
    projectTitle: null,
  }),
]

describe('toUsageLine', () => {
  it('reads the numbers the database sends as text', () => {
    const mapped = toUsageLine({
      booking_id: 'b',
      instrument_id: 'i',
      instrument_name: 'X',
      instrument_display_id: null,
      user_id: null,
      project_id: null,
      project_title: null,
      title: 't',
      starts_at: 'a',
      ends_at: 'b',
      hours: '2.50',
      rate_per_hour: '12.00',
      currency: 'GBP',
    })

    expect(mapped.hours).toBe(2.5)
    expect(mapped.ratePerHour).toBe(12)
  })
})

describe('charges', () => {
  it('charges hours at the rate, and nothing without one', () => {
    expect(lineCharge(LINES[0])).toBe(30)
    expect(lineCharge(LINES[2])).toBeNull()
  })
})

describe('groupUsage', () => {
  it('adds bookings up per instrument, most hours first', () => {
    const groups = groupUsage(LINES, 'instrument')
    expect(groups.map((g) => [g.key, g.hours, g.bookings])).toEqual([
      ['i1', 5, 2],
      ['i2', 4, 1],
    ])
    expect(groups[0]?.charges).toEqual({ GBP: 50 })
    expect(groups[1]?.charges).toEqual({})
  })

  it('groups by person and by project, keeping a row for no project', () => {
    const keys = groupUsage(LINES, 'person').map((g) => g.key)
    expect([...keys].sort()).toEqual(['ada', 'bo'])
    const projects = groupUsage(LINES, 'project')
    expect(projects.find((g) => g.id === null)?.hours).toBe(4)
    expect(projects.find((g) => g.id === 'p1')?.hours).toBe(5)
  })
})

describe('utilisationByInstrument', () => {
  it('measures booked hours against the weekdays of the period', () => {
    const week = {
      from: new Date('2026-11-02T00:00:00Z'),
      to: new Date('2026-11-09T00:00:00Z'),
    }

    const rows = utilisationByInstrument(LINES, week, 10, 'UTC')
    const reader = rows.find((r) => r.key === 'i1')
    expect(reader?.openHours).toBe(50)
    expect(reader?.utilisation).toBeCloseTo(0.1)
    expect(reader?.people).toBe(2)
    expect(reader?.code).toBe('INS-0001')
  })

  it('has nothing to measure against with no open hours', () => {
    const rows = utilisationByInstrument(
      LINES,
      {
        from: new Date('2026-11-07T00:00:00Z'),
        to: new Date('2026-11-09T00:00:00Z'),
      },
      10,
      'UTC',
    )

    expect(rows.every((r) => r.utilisation === 0 || r.openHours > 0)).toBe(true)
  })
})

describe('exports', () => {
  it('writes every booking with its charge', () => {
    const csv = bookingsCsv(LINES, labels)
    const rows = csv.trim().split('\r\n')
    expect(rows[0]).toBe(
      'Booking,Instrument,Instrument ID,Person,Project,Starts,Ends,Hours,Rate per hour,Currency,Charge',
    )
    expect(rows).toHaveLength(4)
    expect(rows[1]).toContain('Ada Lovelace')
    expect(rows[1]).toContain('30.00')
    // No rate, no charge.
    expect(rows[3]).toMatch(/,4,,,$/)
  })

  it('quotes a name with a comma in the recharge', () => {
    const csv = rechargeCsv(LINES, 'person', labels)
    expect(csv).toContain('"Bo, Jr.",Plate reader')
  })

  it('rolls the recharge up per project and instrument', () => {
    const rows = rechargeCsv(LINES, 'project', labels).trim().split('\r\n')
    expect(rows[0]).toBe(
      'Project,Instrument,Instrument ID,Bookings,Hours,Rate per hour,Currency,Charge',
    )
    expect(rows).toContain(
      'Antibody screen,Plate reader,INS-0001,2,5,10.00,GBP,50.00',
    )
    expect(rows).toContain('No project,Sequencer,,1,4,,,')
  })
})
