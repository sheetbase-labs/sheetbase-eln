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
    expect(headline.note).toBe('y = 1 + 2x')
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

  it('leads a descriptive result with each group’s mean, spread and count', () => {
    const stats = {
      n: 5,
      mean: 10,
      sd: 2,
      se: 1,
      min: 7,
      q1: 8,
      median: 9.5,
      q3: 12,
      max: 13,
    }
    // SAFETY: only the fields headlinesOf reads are present.

    const result = {
      kind: 'descriptive',
      rows: [{ group: 'A', missing: 0, stats }],
    } as AnalysisResult

    const [headline] = headlinesOf(result)

    expect(headline.group).toBe('A')
    expect(headline.stats.map((s) => s.label)).toEqual([
      'Mean',
      'SD',
      'Median',
      'n',
    ])
    expect(headline.note).toBe('7 to 13')
  })

  it('gives a comparison its overall test and each pair, then sums up a long list', () => {
    const pair = (p: number, significant: boolean) => ({
      group1: 'A',
      group2: 'B',
      difference: 1.5,
      p,
      significant,
      effectSize: 0.8,
      effectLabel: 'cohens_d' as const,
    })
    // SAFETY: only the fields headlinesOf reads are present.

    const few = {
      kind: 'comparison',
      alpha: 0.05,
      omnibus: { f: 6.2, p: 0.004, etaSquared: 0.4, groups: [{}, {}, {}] },
      pairs: [pair(0.004, true)],
    } as never

    const cards = headlinesOf(few)

    expect(cards).toHaveLength(2)
    expect(cards[0].stats.map((s) => s.value)).toEqual(['6.2', '0.004', '0.40'])
    expect(cards[1].stats.map((s) => s.label)).toEqual([
      'Difference',
      'p',
      'Cohen’s d',
    ])

    // SAFETY: as above.
    const many = {
      kind: 'comparison',
      alpha: 0.05,
      omnibus: null,
      postHoc: 'tukey',
      pairs: [
        pair(0.2, false),
        pair(0.0004, true),
        pair(0.03, true),
        pair(0.5, false),
      ],
    } as never

    const [summary] = headlinesOf(many)

    expect(summary.stats[0].value).toBe('2')
    expect(summary.stats[1].value).toBe('< 0.001')
  })

  it('gives survival a median per group and the log-rank test', () => {
    // SAFETY: only the fields headlinesOf reads are present.
    const result = {
      kind: 'survival',
      curves: [
        { group: 'A', n: 10, events: 6, censored: 4, medianSurvival: 12 },
        { group: 'B', n: 10, events: 3, censored: 7, medianSurvival: null },
      ],
      logRank: { p: 0.03, hazardRatio: { hr: 2.1, lo: 1.1, hi: 4 } },
    } as never

    const cards = headlinesOf(result)

    expect(cards).toHaveLength(3)
    expect(cards[1].stats[0].value).toBe('not reached')
    expect(cards[2].stats.map((s) => s.label)).toEqual(['p', 'Hazard ratio'])
  })
})
