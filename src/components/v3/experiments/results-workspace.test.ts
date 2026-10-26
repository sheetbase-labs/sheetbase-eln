import { describe, expect, it } from 'vitest'

import { summariseBySeries } from './results-workspace'

describe('summariseBySeries', () => {
  const rows = [
    { train: 'B', yield: 90.7, ntu: 6.1 },
    { train: 'A', yield: 86, ntu: 11.2 },
    { train: 'A', yield: 75.6, ntu: 18.4 },
    { train: 'A', yield: null, ntu: 'n/a' },
  ]

  it('groups by series in name order with min–max per numeric column', () => {
    const summary = summariseBySeries(rows, 'train', ['yield', 'ntu'])
    expect(summary.map((s) => s.series)).toEqual(['A', 'B'])
    expect(summary[0]).toEqual({
      series: 'A',
      rows: 3,
      ranges: { yield: '75.6–86', ntu: '11.2–18.4' },
    })
    expect(summary[1].ranges.yield).toBe('90.7')
  })

  it('shows a dash when a column has no numbers', () => {
    const summary = summariseBySeries([{ train: 'A' }], 'train', ['yield'])
    expect(summary[0].ranges.yield).toBe('—')
  })
})
