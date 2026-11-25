import { describe, expect, it } from 'vitest'

import { ambrRows } from './design'

describe('ambr seed rows', () => {
  it('writes every Time as a real HH:MM clock time', () => {
    const times = ambrRows().map((row) => String(row.time))

    expect(times.length).toBeGreaterThan(0)

    for (const time of times) {
      expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })
})
