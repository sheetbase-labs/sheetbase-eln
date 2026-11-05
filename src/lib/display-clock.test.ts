/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'

import {
  clockOption,
  getDisplayClock,
  setDisplayClock,
  toClockFormat,
} from './display-clock'
import { setDisplayTimeZone } from './display-time-zone'
import { formatDate, formatTime } from './format-date'
import { formatNotebookDateTime } from './notebook-data'

afterEach(() => {
  setDisplayClock('24h')
  setDisplayTimeZone(undefined)
})

const INSTANT = '2026-07-01T14:30:00.000Z'

describe('display clock', () => {
  it('reads anything but 12h as the 24 hour clock', () => {
    expect(toClockFormat('12h')).toBe('12h')
    expect(toClockFormat('24h')).toBe('24h')
    expect(toClockFormat(undefined)).toBe('24h')
    expect(toClockFormat('am')).toBe('24h')
  })

  it('writes every time of day on the clock the person chose', () => {
    setDisplayTimeZone('UTC')
    expect(formatTime(INSTANT)).toBe('14:30')
    expect(formatDate(INSTANT, { time: true })).toBe('1 Jul 2026, 14:30')
    setDisplayClock('12h')
    expect(getDisplayClock()).toBe('12h')
    expect(clockOption()).toEqual({ hour12: true })
    expect(formatTime(INSTANT)).toMatch(/^0?2:30 pm$/i)
    expect(formatDate(INSTANT, { time: true })).toMatch(
      /^1 Jul 2026, 0?2:30 pm$/i,
    )
    expect(formatNotebookDateTime(INSTANT)).toMatch(/^1 Jul 2026, 0?2:30 pm$/i)
  })

  it('leaves a date without a time alone', () => {
    setDisplayClock('12h')
    expect(formatDate(INSTANT)).toBe('1 Jul 2026')
  })
})
