import { describe, expect, it } from 'vitest'

import { dateTimeFormat } from './intl-cache'

describe('dateTimeFormat', () => {
  it('reuses one formatter for the same locale and options', () => {
    const a = dateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit' })
    const b = dateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit' })
    expect(a).toBe(b)
  })

  it('keeps formatters apart when the locale or an option differs', () => {
    const base = dateTimeFormat('en-GB', { timeZone: 'UTC' })
    expect(dateTimeFormat('en-US', { timeZone: 'UTC' })).not.toBe(base)
    expect(dateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo' })).not.toBe(base)
  })

  it('treats an undefined option the same as a missing one', () => {
    expect(dateTimeFormat('en-GB', { timeZone: undefined })).toBe(
      dateTimeFormat('en-GB', {}),
    )
  })

  it('formats exactly as a new formatter would', () => {
    const instant = new Date('2026-07-14T23:30:00Z')

    const options = {
      timeZone: 'Europe/London',
      dateStyle: 'medium',
      timeStyle: 'short',
    } as const

    expect(dateTimeFormat('en-GB', options).format(instant)).toBe(
      new Intl.DateTimeFormat('en-GB', options).format(instant),
    )
  })

  it('throws for an unknown time zone and does not cache the failure', () => {
    expect(() => dateTimeFormat('en-GB', { timeZone: 'Not/AZone' })).toThrow(
      RangeError,
    )
    expect(() => dateTimeFormat('en-GB', { timeZone: 'Not/AZone' })).toThrow(
      RangeError,
    )
  })
})
