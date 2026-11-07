import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { splitRefs, useRecordRefs } from './record-refs'

afterEach(() => cleanup())

describe('splitRefs', () => {
  it('finds identifiers and leaves the rest as written', () => {
    expect(splitRefs('Confirm EXP-0142 and DS-0311, not ABC-1234.')).toEqual([
      { text: 'Confirm ', ref: false },
      { text: 'EXP-0142', ref: true },
      { text: ' and ', ref: false },
      { text: 'DS-0311', ref: true },
      { text: ', not ABC-1234.', ref: false },
    ])
  })

  it('returns plain text untouched', () => {
    expect(splitRefs('nothing here')).toEqual([
      { text: 'nothing here', ref: false },
    ])
    expect(splitRefs('')).toEqual([])
  })

  it('does not match inside longer words or short numbers', () => {
    expect(splitRefs('XEXP-0142 EXP-01')).toEqual([
      { text: 'XEXP-0142 EXP-01', ref: false },
    ])
  })
})

describe('useRecordRefs', () => {
  it('works without an app query client around it', () => {
    const { result } = renderHook(() => useRecordRefs(['EXP-0142']))
    expect(result.current.size).toBe(0)
  })
})
