import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOURS,
  addDays,
  dayOfEpoch,
  localToEpoch,
  planSchedule,
} from './plan'
import type { PlanInput, PlanPart } from './plan'

const READER = 'reader'
const INCUBATOR = 'incubator'
const ANNA = 'anna'

const at = (date: string, hhmm: string, tz = 'UTC') => {
  const [h, m] = hhmm.split(':').map(Number)
  return localToEpoch(date, h * 60 + m, tz)
}

function part(
  over: Partial<PlanPart> & Pick<PlanPart, 'partId' | 'number'>,
): PlanPart {
  return {
    title: `Part ${over.number}`,
    dayOffset: 0,
    assigneeUserId: null,
    handsOnMinutes: 60,
    waitAfterMinutes: 0,
    needs: [],
    ...over,
  }
}

function input(parts: PlanPart[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    // Monday 2 November 2026.
    anchorOn: '2026-11-02',
    notBefore: at('2026-11-02', '00:00'),
    hours: DEFAULT_HOURS,
    parts,
    busy: new Map(),
    rules: new Map(),
    absences: new Map(),
    gaps: new Map(),
    requesterId: ANNA,
    ...over,
  }
}

const need = (
  resourceId: string,
  minutes: number,
  resourceName = resourceId,
) => ({
  resourceId,
  resourceName,
  minutes,
})

describe('time zones', () => {
  it('turns a local clock time into the moment it happens', () => {
    expect(
      new Date(
        at('2026-07-01', '09:00', 'Europe/London') * 60_000,
      ).toISOString(),
    ).toBe('2026-07-01T08:00:00.000Z')
    expect(
      new Date(
        at('2026-12-01', '09:00', 'Europe/London') * 60_000,
      ).toISOString(),
    ).toBe('2026-12-01T09:00:00.000Z')
    expect(
      new Date(
        at('2026-11-02', '09:00', 'America/New_York') * 60_000,
      ).toISOString(),
    ).toBe('2026-11-02T14:00:00.000Z')
    expect(
      dayOfEpoch(at('2026-11-02', '23:30', 'Asia/Tokyo'), 'Asia/Tokyo'),
    ).toBe('2026-11-02')
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
  })
})

describe('placing parts', () => {
  it('puts each part on its day at the start of the working day, in order', () => {
    const plan = planSchedule(
      input([
        part({
          partId: 'a',
          number: 1,
          dayOffset: 0,
          needs: [need(READER, 60)],
        }),
        part({
          partId: 'b',
          number: 2,
          dayOffset: 2,
          needs: [need(READER, 60)],
        }),
      ]),
    )
    const booked = plan.items.filter((i) => i.kind === 'instrument')
    expect(booked.map((i) => [i.partId, i.startsAt, i.endsAt])).toEqual([
      ['a', '2026-11-02T09:00:00.000Z', '2026-11-02T10:00:00.000Z'],
      ['b', '2026-11-04T09:00:00.000Z', '2026-11-04T10:00:00.000Z'],
    ])
    expect(plan.conflictCount).toBe(0)
  })

  it('uses the lab’s own clock', () => {
    const plan = planSchedule(
      input([part({ partId: 'a', number: 1, needs: [need(READER, 60)] })], {
        anchorOn: '2026-07-01',
        notBefore: at('2026-07-01', '00:00', 'Europe/London'),
        hours: { ...DEFAULT_HOURS, timezone: 'Europe/London' },
      }),
    )
    expect(plan.items[0].startsAt).toBe('2026-07-01T08:00:00.000Z')
  })

  it('skips weekends and keeps to the days the lab works', () => {
    const plan = planSchedule(
      input([
        part({
          partId: 'a',
          number: 1,
          dayOffset: 5,
          needs: [need(READER, 30)],
        }),
      ]),
    )
    // Day 5 is Saturday 7 November: the next working day is Monday.
    expect(plan.items[0].plannedOn).toBe('2026-11-09')
    expect(plan.items[0].conflicts.map((c) => c.code)).toContain(
      'later_than_planned',
    )
    expect(plan.conflictCount).toBe(0)
  })

  it('does not start before now', () => {
    const plan = planSchedule(
      input(
        [
          part({
            partId: 'a',
            number: 1,
            dayOffset: 0,
            needs: [need(READER, 60)],
          }),
        ],
        {
          notBefore: at('2026-11-02', '13:10'),
        },
      ),
    )
    expect(plan.items[0].startsAt).toBe('2026-11-02T13:10:00.000Z')
  })

  it('waits out an incubation before the next part', () => {
    const plan = planSchedule(
      input([
        part({
          partId: 'a',
          number: 1,
          waitAfterMinutes: 24 * 60,
          needs: [need(INCUBATOR, 30)],
        }),
        part({
          partId: 'b',
          number: 2,
          dayOffset: 0,
          needs: [need(READER, 30)],
        }),
      ]),
    )
    const b = plan.items.find(
      (i) => i.partId === 'b' && i.kind === 'instrument',
    )!
    // Part a (an hour of hands-on time) ends 10:00 Monday; a day later is 10:00 Tuesday.
    expect(b.startsAt).toBe('2026-11-03T10:00:00.000Z')
  })

  it('keeps a part’s instruments in sequence on one day', () => {
    const plan = planSchedule(
      input([
        part({
          partId: 'a',
          number: 1,
          needs: [need(INCUBATOR, 45), need(READER, 30)],
        }),
      ]),
    )
    const [first, second] = plan.items.filter((i) => i.kind === 'instrument')
    expect(first.startsAt).toBe('2026-11-02T09:00:00.000Z')
    expect(second.startsAt).toBe('2026-11-02T09:45:00.000Z')
  })

  it('goes around what is already booked, and around its own earlier parts', () => {
    const busy = new Map([
      [
        READER,
        [{ start: at('2026-11-02', '09:00'), end: at('2026-11-02', '11:00') }],
      ],
    ])
    const plan = planSchedule(
      input(
        [
          part({ partId: 'a', number: 1, needs: [need(READER, 60)] }),
          part({ partId: 'b', number: 2, needs: [need(READER, 60)] }),
        ],
        { busy },
      ),
    )
    const [a, b] = plan.items.filter((i) => i.kind === 'instrument')
    expect(a.startsAt).toBe('2026-11-02T11:00:00.000Z')
    expect(b.startsAt).toBe('2026-11-02T12:00:00.000Z')
  })

  it('moves to the next day when the working day is full', () => {
    const busy = new Map([
      [
        READER,
        [{ start: at('2026-11-02', '09:00'), end: at('2026-11-02', '16:30') }],
      ],
    ])
    const plan = planSchedule(
      input([part({ partId: 'a', number: 1, needs: [need(READER, 60)] })], {
        busy,
      }),
    )
    expect(plan.items[0].plannedOn).toBe('2026-11-03')
  })

  it('does not plan a part on a day its owner is away', () => {
    const absences = new Map([[ANNA, [['2026-11-02', '2026-11-03'] as const]]])
    const plan = planSchedule(
      input(
        [
          part({
            partId: 'a',
            number: 1,
            assigneeUserId: ANNA,
            needs: [need(READER, 60)],
          }),
        ],
        { absences },
      ),
    )
    expect(plan.items[0].plannedOn).toBe('2026-11-04')
  })

  it('lets an overnight step run past the working day', () => {
    const plan = planSchedule(
      input([
        part({
          partId: 'a',
          number: 1,
          handsOnMinutes: 0,
          needs: [need(INCUBATOR, 16 * 60)],
        }),
      ]),
    )
    const item = plan.items.find((i) => i.kind === 'instrument')!
    expect(item.startsAt).toBe('2026-11-02T09:00:00.000Z')
    expect(item.endsAt).toBe('2026-11-03T01:00:00.000Z')
    expect(plan.conflictCount).toBe(0)
  })

  it('places a part with no instrument on a working day, for its owner', () => {
    const plan = planSchedule(
      input([part({ partId: 'a', number: 1, handsOnMinutes: 90 })]),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      kind: 'hands_on',
      startsAt: '2026-11-02T09:00:00.000Z',
      endsAt: '2026-11-02T10:30:00.000Z',
    })
  })
})

describe('what stands in the way', () => {
  const rules = (over: Record<string, unknown>) =>
    new Map([
      [
        READER,
        {
          maxBookingMinutes: null,
          maxAdvanceDays: null,
          outOfService: false,
          ...over,
        },
      ],
    ])

  it('flags a booking longer than the instrument allows', () => {
    const plan = planSchedule(
      input(
        [
          part({
            partId: 'a',
            number: 1,
            needs: [need(READER, 120, 'Plate reader')],
          }),
        ],
        {
          rules: rules({ maxBookingMinutes: 90 }),
        },
      ),
    )
    expect(plan.items[0].conflicts[0]).toMatchObject({
      code: 'max_booking_exceeded',
    })
    expect(plan.items[0].conflicts[0].message).toContain('90 minutes')
    expect(plan.conflictCount).toBe(1)
  })

  it('flags an instrument that is out of service and one booked too far ahead', () => {
    const plan = planSchedule(
      input(
        [
          part({
            partId: 'a',
            number: 1,
            dayOffset: 10,
            needs: [need(READER, 30)],
          }),
        ],
        {
          rules: rules({ outOfService: true, maxAdvanceDays: 3 }),
        },
      ),
    )
    expect(plan.items[0].conflicts.map((c) => c.code).sort()).toEqual([
      'out_of_service',
      'too_far_ahead',
    ])
  })

  it('flags a person who cannot book the instrument yet', () => {
    const gaps = new Map([
      [`${READER}:${ANNA}`, 'Anna needs training on SOP-12 first.'],
    ])
    const plan = planSchedule(
      input([part({ partId: 'a', number: 1, needs: [need(READER, 30)] })], {
        gaps,
      }),
    )
    expect(plan.items[0].conflicts[0]).toMatchObject({
      code: 'not_qualified',
      message: 'Anna needs training on SOP-12 first.',
    })
  })

  it('says so when no time can be found, instead of dropping the part', () => {
    const forever = new Map([
      [
        READER,
        [{ start: at('2026-11-02', '00:00'), end: at('2027-06-01', '00:00') }],
      ],
    ])
    const plan = planSchedule(
      input(
        [
          part({
            partId: 'a',
            number: 1,
            needs: [need(READER, 30, 'Plate reader')],
          }),
        ],
        { busy: forever },
      ),
    )
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({ startsAt: null, plannedOn: null })
    expect(plan.items[0].conflicts[0].code).toBe('no_slot')
    expect(plan.conflictCount).toBe(1)
  })
})
