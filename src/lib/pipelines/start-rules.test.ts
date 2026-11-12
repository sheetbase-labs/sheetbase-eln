import { describe, expect, it } from 'vitest'

import {
  DEFAULT_START_RULES,
  batchIsReady,
  inStartWindow,
  judgeStart,
  localClock,
  parseStartRules,
} from './start-rules'

const WEEKDAYS = {
  days: 'weekdays',
  from: '07:00',
  to: '19:00',
  timeZone: 'Europe/London',
} as const

// Wednesday 12 November 2026, 10:00 in London (GMT).
const WED_MORNING = new Date('2026-11-11T10:00:00Z')
const SATURDAY = new Date('2026-11-14T10:00:00Z')

describe('parseStartRules', () => {
  it('reads an empty object as no extra rules', () => {
    expect(parseStartRules({})).toEqual(DEFAULT_START_RULES)
    expect(parseStartRules(null)).toEqual(DEFAULT_START_RULES)
    expect(parseStartRules('nonsense')).toEqual(DEFAULT_START_RULES)
  })

  it('keeps what was stored', () => {
    const rules = parseStartRules({
      window: WEEKDAYS,
      minNewRows: 8,
      waitMinutes: 2,
      missedRuns: 'skip',
    })

    expect(rules.window?.timeZone).toBe('Europe/London')
    expect(rules.minNewRows).toBe(8)
    expect(rules.waitMinutes).toBe(2)
    expect(rules.missedRuns).toBe('skip')
  })
})

describe('the window', () => {
  it('reads the clock in the window’s own zone', () => {
    // 10:00 UTC is 11:00 in Paris in winter.
    expect(
      localClock(new Date('2026-11-11T10:00:00Z'), 'Europe/Paris'),
    ).toEqual({ weekday: 3, minutes: 11 * 60 })
  })

  it('opens inclusive and closes exclusive', () => {
    expect(inStartWindow(WEEKDAYS, new Date('2026-11-11T07:00:00Z'))).toBe(true)
    expect(inStartWindow(WEEKDAYS, new Date('2026-11-11T06:59:00Z'))).toBe(
      false,
    )
    expect(inStartWindow(WEEKDAYS, new Date('2026-11-11T18:59:00Z'))).toBe(true)
    expect(inStartWindow(WEEKDAYS, new Date('2026-11-11T19:00:00Z'))).toBe(
      false,
    )
  })

  it('keeps weekdays and weekends apart', () => {
    expect(inStartWindow(WEEKDAYS, SATURDAY)).toBe(false)
    expect(inStartWindow({ ...WEEKDAYS, days: 'weekends' }, SATURDAY)).toBe(
      true,
    )
    expect(inStartWindow({ ...WEEKDAYS, days: 'daily' }, SATURDAY)).toBe(true)
  })
})

describe('judging a start', () => {
  const rules = parseStartRules({ window: WEEKDAYS, minNewRows: 8 })

  it('lets everything through with no rules', () => {
    expect(
      judgeStart(DEFAULT_START_RULES, {
        at: SATURDAY,
        source: 'event',
        newRows: 1,
      }),
    ).toEqual({ pass: true })
  })

  it('needs every condition that applies when it says all', () => {
    expect(
      judgeStart(rules, { at: WED_MORNING, source: 'event', newRows: 12 }),
    ).toEqual({ pass: true })

    expect(
      judgeStart(rules, { at: WED_MORNING, source: 'event', newRows: 4 }),
    ).toMatchObject({ pass: false, condition: 'rows' })

    expect(
      judgeStart(rules, { at: SATURDAY, source: 'event', newRows: 12 }),
    ).toMatchObject({ pass: false, condition: 'window' })
  })

  it('lets a schedule or a webhook past the row condition', () => {
    expect(judgeStart(rules, { at: WED_MORNING, source: 'schedule' })).toEqual({
      pass: true,
    })
    expect(
      judgeStart(rules, { at: SATURDAY, source: 'webhook' }),
    ).toMatchObject({
      pass: false,
      condition: 'window',
    })
  })

  it('needs only one when it says any', () => {
    const either = { ...rules, conditionsMatch: 'any' as const }

    expect(
      judgeStart(either, { at: SATURDAY, source: 'event', newRows: 12 }),
    ).toEqual({ pass: true })

    expect(
      judgeStart(either, { at: SATURDAY, source: 'event', newRows: 2 }),
    ).toMatchObject({ pass: false })
  })
})

describe('batching', () => {
  const rules = parseStartRules({ waitMinutes: 2 })
  const last = new Date('2026-11-11T10:00:00Z')

  it('waits until the newest event has been quiet long enough', () => {
    expect(batchIsReady(rules, last, new Date('2026-11-11T10:01:59Z'))).toBe(
      false,
    )
    expect(batchIsReady(rules, last, new Date('2026-11-11T10:02:00Z'))).toBe(
      true,
    )
  })

  it('never waits with a wait of zero', () => {
    expect(batchIsReady(DEFAULT_START_RULES, last, last)).toBe(true)
  })
})
