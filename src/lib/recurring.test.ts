import { describe, expect, it } from 'vitest'

import { getLocale, setLocale } from '#/copy'
import {
  NO_REPEAT,
  describeNotMade,
  describeRepeat,
  describeRepeatResult,
  isoWeekday,
  repeatFormError,
  repeatFormToRule,
  toRepeatSchedule,
} from './recurring'
import type { RepeatForm, RepeatScheduleWire } from './recurring'

const weekly: RepeatForm = {
  ...NO_REPEAT,
  frequency: 'weekly',
  weekdays: [1, 3],
}

describe('repeat form', () => {
  it('finds ISO weekdays', () => {
    expect(isoWeekday('2026-11-09')).toBe(1)
    expect(isoWeekday('2026-11-15')).toBe(7)
  })

  it('accepts no repeat and sound repeats', () => {
    expect(repeatFormError(NO_REPEAT, '2026-11-09')).toBeNull()
    expect(repeatFormError(weekly, '2026-11-09')).toBeNull()
  })

  it('asks for a weekday, a sensible count and a last day', () => {
    expect(repeatFormError({ ...weekly, weekdays: [] }, '2026-11-09')).toMatch(
      /day of the week/,
    )
    expect(repeatFormError({ ...weekly, count: 0 }, '2026-11-09')).toMatch(
      /how many times/,
    )
    expect(repeatFormError({ ...weekly, interval: 60 }, '2026-11-09')).toMatch(
      /1 to 52/,
    )
    expect(
      repeatFormError(
        { ...weekly, endMode: 'date', until: '2026-11-01' },
        '2026-11-09',
      ),
    ).toMatch(/last day/)
  })

  it('turns the form into a rule that ends one way', () => {
    expect(repeatFormToRule(weekly)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 3],
      endsOn: null,
      maxOccurrences: 8,
    })
    expect(
      repeatFormToRule({
        ...NO_REPEAT,
        frequency: 'daily',
        endMode: 'date',
        until: '2026-12-01',
      }),
    ).toMatchObject({
      weekdays: null,
      endsOn: '2026-12-01',
      maxOccurrences: null,
    })
  })
})

const wire = (over: Partial<RepeatScheduleWire>): RepeatScheduleWire => ({
  id: 's1',
  kind: 'booking',
  title: 'Plate reader QC',
  status: 'active',
  frequency: 'weekly',
  interval_count: 1,
  weekdays: [3, 1],
  offsets_days: null,
  starts_on: '2026-11-09',
  ends_on: null,
  max_occurrences: 8,
  timezone: 'UTC',
  resource_id: 'r1',
  start_time: '09:00:00',
  end_time: '10:30:00',
  notebook_template_id: null,
  lead_days: 0,
  project_id: null,
  created_by_user_id: 'u1',
  created_at: '2026-11-04T00:00:00Z',
  ...over,
})

describe('describing a repeat', () => {
  it('keeps weekday order, duplicates and missing-key fallback in both locales', () => {
    const locale = getLocale()
    const schedule = toRepeatSchedule(wire({ max_occurrences: null }))
    schedule.weekdays = [7, 0, 1, 1, 8]

    try {
      setLocale('en')
      expect(describeRepeat(schedule)).toBe(
        'Every week on Sun, projects.recurring.weekdaysShort.0, Mon, Mon, and projects.recurring.weekdaysShort.8',
      )
      setLocale('pseudo')
      expect(describeRepeat(schedule)).toBe(
        '⟦Évéŕý ŵééķ óñ ⟦Šúñ·⟧, ⟦þŕóĵéçţš.ŕéçúŕŕíñĝ.ŵééķðáýšŠĥóŕţ.0··········⟧, ⟦Ṁóñ·⟧, ⟦Ṁóñ·⟧, and ⟦þŕóĵéçţš.ŕéçúŕŕíñĝ.ŵééķðáýšŠĥóŕţ.8··········⟧····⟧',
      )
    } finally {
      setLocale(locale)
    }
  })

  it('reads the wire and trims times', () => {
    const s = toRepeatSchedule(wire({}))
    expect(s.weekdays).toEqual([1, 3])
    expect(s.startTime).toBe('09:00')
    expect(s.endTime).toBe('10:30')
  })

  it('says the rule and where it ends', () => {
    expect(describeRepeat(toRepeatSchedule(wire({})))).toBe(
      'Every week on Mon and Wed, 8 times',
    )
    expect(
      describeRepeat(
        toRepeatSchedule(
          wire({
            interval_count: 2,
            max_occurrences: null,
            ends_on: '2026-12-31',
          }),
        ),
        () => '31 Dec',
      ),
    ).toBe('Every 2 weeks on Mon and Wed, until 31 Dec')
    expect(
      describeRepeat(
        toRepeatSchedule(
          wire({ frequency: 'monthly', weekdays: null, max_occurrences: 3 }),
        ),
      ),
    ).toBe('Monthly on day 9, 3 times')
    expect(
      describeRepeat(
        toRepeatSchedule(
          wire({
            frequency: 'offsets',
            weekdays: null,
            offsets_days: [30, 0, 7],
            max_occurrences: null,
          }),
        ),
      ),
    ).toBe('Days 0, 7, and 30 after the start')
  })

  it('names why something was not made without codes', () => {
    expect(describeNotMade('SB020: booking overlaps with X (id)')).toMatch(
      /overlapped/,
    )
    expect(describeNotMade('SB116: calibration')).toMatch(/calibration/)
    expect(describeNotMade('SB135: out of service')).toMatch(/out of service/)
    expect(describeNotMade('22023: whatever')).toMatch(/couldn’t be made/)
  })

  it('summarises a result for the toast', () => {
    expect(
      describeRepeatResult('booking', {
        created: 7,
        skipped: 1,
        failed: 0,
        problems: [],
      }),
    ).toBe('7 bookings made. 1 couldn’t be made, see Repeating.')
    expect(
      describeRepeatResult('experiment', {
        created: 0,
        skipped: 0,
        failed: 0,
        problems: [],
      }),
    ).toBe('Repeat set up. Experiments start on their day.')
  })
})
