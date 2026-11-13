import { describe, expect, it } from 'vitest'

import { fmt } from './plates-shared'

describe('fmt', () => {
  it('never rounds whole digits away', () => {
    expect(fmt(1043)).toBe('1043')
    expect(fmt(12345.6)).toBe('12346')
    expect(fmt(123.4, 2)).toBe('123')
  })

  it('keeps a few significant figures below the whole digits', () => {
    expect(fmt(1.2345)).toBe('1.23')
    expect(fmt(0.012345)).toBe('0.0123')
    expect(fmt(12.34, 2)).toBe('12')
  })

  it('uses exponents for very large and very small values', () => {
    expect(fmt(123456)).toBe('1.23e+5')
    expect(fmt(0.0001234)).toBe('1.23e-4')
  })

  it('shows nothing for a missing value', () => {
    expect(fmt(null)).toBe('')
    expect(fmt(Number.NaN)).toBe('')
    expect(fmt(0)).toBe('0')
  })
})
