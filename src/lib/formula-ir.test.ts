import { describe, expect, it } from 'vitest'
import { normalizeExponentiation } from './formula-ir'

describe('normalizeExponentiation', () => {
  it('converts ** to ^ outside string literals', () => {
    expect(normalizeExponentiation('=2**3')).toBe('=2^3')
    expect(normalizeExponentiation('=A1**B2')).toBe('=A1^B2')
    expect(normalizeExponentiation('=2**3**4')).toBe('=2^3^4')
  })

  it('preserves ** inside string literals', () => {
    expect(normalizeExponentiation('="pattern ** here"')).toBe(
      '="pattern ** here"',
    )
    expect(normalizeExponentiation('="a" & "b ** c"')).toBe('="a" & "b ** c"')
  })

  it('handles escaped quotes inside string literals', () => {
    expect(normalizeExponentiation('="say ""hi"" ** ok"')).toBe(
      '="say ""hi"" ** ok"',
    )
  })

  it('handles mixed formula and string content', () => {
    expect(normalizeExponentiation('=2**3 & "x**y"')).toBe('=2^3 & "x**y"')
  })

  it('leaves formulas without ** unchanged', () => {
    expect(normalizeExponentiation('=2^3+A1')).toBe('=2^3+A1')
    expect(normalizeExponentiation('=SUM(A1:A5)')).toBe('=SUM(A1:A5)')
  })

  it('handles ** at the start of a formula expression', () => {
    expect(normalizeExponentiation('=2**3')).toBe('=2^3')
  })

  it('handles empty and single-* strings', () => {
    expect(normalizeExponentiation('')).toBe('')
    expect(normalizeExponentiation('=2*3')).toBe('=2*3')
  })
})
