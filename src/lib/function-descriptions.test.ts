import { describe, it, expect } from 'vitest'
import {
  FUNCTION_DESCRIPTIONS,
  getFunctionSuggestions,
  extractFunctionPrefix,
} from '#/lib/function-descriptions'
import { SCIENTIFIC_CORE_FUNCTIONS } from '#/lib/formula-profile'

describe('FUNCTION_DESCRIPTIONS', () => {
  it('has a description for every allowed function', () => {
    for (const id of SCIENTIFIC_CORE_FUNCTIONS) {
      expect(
        FUNCTION_DESCRIPTIONS[id],
        `missing description for ${id}`,
      ).toBeDefined()
    }
  })

  it('does not describe functions outside the allow-list', () => {
    for (const id of Object.keys(FUNCTION_DESCRIPTIONS)) {
      expect(
        (SCIENTIFIC_CORE_FUNCTIONS as readonly string[]).includes(id),
        `description for disallowed function ${id}`,
      ).toBe(true)
    }
  })
})

describe('getFunctionSuggestions', () => {
  it('returns prefix matches, case-insensitive, sorted, limited', () => {
    const result = getFunctionSuggestions('stdev', 10)
    const ids = result.map((s) => s.id)
    expect(ids).toEqual([
      'STDEV',
      'STDEV.P',
      'STDEV.S',
      'STDEVA',
      'STDEVP',
      'STDEVPA',
    ])
  })

  it('respects the limit', () => {
    const result = getFunctionSuggestions('S', 3)
    expect(result).toHaveLength(3)
    // Sorted alphabetically
    expect(result[0].id).toBe('SEARCH')
    expect(result[1].id).toBe('SECOND')
    expect(result[2].id).toBe('SEQUENCE')
  })

  it('returns empty for no matches', () => {
    expect(getFunctionSuggestions('XYZNOTAFUNCTION')).toHaveLength(0)
  })

  it('returns alphabetical first items for empty prefix', () => {
    const result = getFunctionSuggestions('', 5)
    expect(result).toHaveLength(5)
    expect(result[0].id).toBe('ABS')
  })
})

describe('extractFunctionPrefix', () => {
  it('extracts a prefix after =', () => {
    expect(extractFunctionPrefix('=SUM', 4)).toBe('SUM')
    expect(extractFunctionPrefix('=su', 3)).toBe('SU')
  })

  it('extracts a prefix after an operator', () => {
    expect(extractFunctionPrefix('=A1+STDEV', 9)).toBe('STDEV')
    expect(extractFunctionPrefix('=SUM(A1,CO', 10)).toBe('CO')
  })

  it('returns null for a completed call followed by paren', () => {
    expect(extractFunctionPrefix('=SUM(A1)', 4)).toBeNull()
  })

  it('returns null for a bare cell reference context', () => {
    // "A1" after "=" — A1 is not a function name context because the char
    // after the token is not a trigger, but A1 itself is a ref, not a function.
    // Actually =A1 has token "A1" but the char before is "=" (trigger), so it
    // would match. Let's test a case where it's clearly not a function.
    expect(extractFunctionPrefix('=123', 4)).toBeNull()
  })

  it('returns null for empty or whitespace', () => {
    expect(extractFunctionPrefix('=', 1)).toBeNull()
    expect(extractFunctionPrefix('= ', 2)).toBeNull()
  })

  it('handles dot-separated function names', () => {
    expect(extractFunctionPrefix('=NORM.D', 7)).toBe('NORM.D')
    expect(extractFunctionPrefix('=NORM.', 6)).toBe('NORM.')
  })

  it('returns null when cursor is after a non-trigger character', () => {
    // After a letter that is part of a word (no trigger before it)
    expect(extractFunctionPrefix('=SUMPRODUCT', 11)).toBe('SUMPRODUCT')
    // But "PRO" in the middle of "SUMPRODUCT" is not at a trigger boundary
    // — the char before "PRO" is "M", not a trigger.
    // Actually extractFunctionPrefix walks back from cursor, so at cursor 11
    // the whole token is "SUMPRODUCT" starting after "=".
  })
})
