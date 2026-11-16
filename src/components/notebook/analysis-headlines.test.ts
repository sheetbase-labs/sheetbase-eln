import { describe, expect, it } from 'vitest'

import type {
  AnalysisResult,
  RegressionFitRow,
} from '#/lib/analysis-definition'

import { headlinesOf } from './analysis-headlines'

const FIT: RegressionFitRow = {
  group: 'all',
  n: 8,
  degree: 1,
  coefficients: [1, 2],
  r2: 0.98765,
  rmse: 0.5,
  equation: 'y = 1 + 2x',
  dfResidual: 6,
  sigma: 0.5,
  adjR2: 0.98,
  f: 400,
  fP: 0.001,
  terms: [],
}

describe('headlinesOf', () => {
  it('leads a regression with R², the points and the error, and the equation', () => {
    // SAFETY: the fixture carries the fields headlinesOf reads from a regression result.
    const result = { kind: 'regression', rows: [FIT] } as AnalysisResult
    const [headline] = headlinesOf(result)

    expect(headline.group).toBeNull()
    expect(headline.equation).toBe('y = 1 + 2x')
    expect(headline.stats.map((s) => s.label)).toEqual(['R²', 'Points', 'RMSE'])
    expect(headline.stats[0].value).toBe('0.988')
    expect(headline.stats[1].value).toBe('8')
  })

  it('names the group when the fit is per group', () => {
    // SAFETY: as above.
    const result = {
      kind: 'regression',
      rows: [{ ...FIT, group: 'Compound A' }],
    } as AnalysisResult

    expect(headlinesOf(result)[0].group).toBe('Compound A')
  })

  it('has no headline for a kind with no fit', () => {
    // SAFETY: only the kind is read.
    expect(headlinesOf({ kind: 'descriptive', rows: [] } as never)).toEqual([])
  })
})
