import { describe, expect, it } from 'vitest'

import { instrumentWarningsOf } from './instrument-gate'

describe('instrumentWarningsOf', () => {
  it('reads the findings an import was flagged with', () => {
    expect(
      instrumentWarningsOf({
        instrumentWarnings: ['calibration_overdue', 'unqualified'],
      }),
    ).toEqual(['calibration_overdue', 'unqualified'])
  })

  it('ignores anything else', () => {
    expect(instrumentWarningsOf(null)).toEqual([])
    expect(instrumentWarningsOf('succeeded')).toEqual([])
    expect(instrumentWarningsOf({ instrumentWarnings: 'retired' })).toEqual([])
    expect(
      instrumentWarningsOf({ instrumentWarnings: ['retired', 'sad', 3] }),
    ).toEqual(['retired'])
  })
})
