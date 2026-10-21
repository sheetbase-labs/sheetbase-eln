/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'

import {
  formatInstant,
  getDisplayTimeZone,
  isUsableTimeZone,
  setDisplayTimeZone,
} from './display-time-zone'
import { formatNotebookDateTime } from './notebook-data'

afterEach(() => setDisplayTimeZone(undefined))

// 2026-07-01 23:30 UTC is already 1 July 19:30 in New York and 2 July 00:30 in
// London (BST): the same stored instant reads differently per person.
const INSTANT = '2026-07-01T23:30:00.000Z'

describe('display time zone', () => {
  it('shows one stored instant on each person’s own clock', () => {
    setDisplayTimeZone('America/New_York')
    expect(formatNotebookDateTime(INSTANT)).toBe('1 Jul 2026, 19:30')
    setDisplayTimeZone('Europe/London')
    expect(formatNotebookDateTime(INSTANT)).toBe('2 Jul 2026, 00:30')
  })

  it('names the zone on audit and signature times', () => {
    setDisplayTimeZone('Europe/London')
    expect(formatNotebookDateTime(INSTANT, { zone: true })).toBe(
      '2 Jul 2026, 00:30 BST',
    )
    setDisplayTimeZone('America/New_York')
    expect(formatNotebookDateTime(INSTANT, { zone: true })).toBe(
      '1 Jul 2026, 19:30 GMT-4',
    )
  })

  it('formats dates on the display zone’s calendar day', () => {
    setDisplayTimeZone('Pacific/Auckland')
    expect(formatInstant(INSTANT, { day: 'numeric', month: 'short' })).toBe(
      '2 Jul',
    )
  })

  it('ignores a zone the runtime cannot resolve', () => {
    setDisplayTimeZone('Mars/Olympus')
    expect(getDisplayTimeZone()).toBeUndefined()
    expect(isUsableTimeZone('Mars/Olympus')).toBe(false)
    expect(isUsableTimeZone('Europe/London')).toBe(true)
  })

  it('renders a dash for a missing or invalid instant', () => {
    expect(formatInstant(null)).toBe('—')
    expect(formatInstant('not a date')).toBe('—')
  })
})
