import { describe, expect, it } from 'vitest'

import { formatQuantity } from './format-quantity'

describe('formatQuantity', () => {
  it('writes large and small amounts in scientific notation', () => {
    expect(formatQuantity(730000000000)).toBe('7.3 × 10¹¹')
    expect(formatQuantity(0.00042)).toBe('4.2 × 10⁻⁴')
  })

  it('keeps everyday sizes as plain digits to three figures', () => {
    expect(formatQuantity(12.3456)).toBe('12.3')
    expect(formatQuantity(0.5)).toBe('0.5')
    expect(formatQuantity(1234)).toBe('1230')
  })

  it('carries a rounded mantissa into the exponent', () => {
    expect(formatQuantity(9.9996e7)).toBe('1 × 10⁸')
  })

  it('is empty for nothing', () => {
    expect(formatQuantity(null)).toBe('')
    expect(formatQuantity(Number.NaN)).toBe('')
  })
})
