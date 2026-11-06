import { describe, expect, it } from 'vitest'
import {
  adjustPValues,
  dunnettCritical,
  kaplanMeier,
  logRankTest,
  mannWhitneyU,
  normalCdf,
  pairedTTest,
  postHocComparisons,
  studentTTest,
  studentizedRangeQuantile,
  welchTTest,
  chiSquareUpperP,
  tQuantile,
} from './stats-tests'

const a = [27.5, 21, 19, 23.6, 17, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19, 21.7, 21.4]
const b = [27.1, 22, 20.8, 23.4, 23.4, 23.5, 25.8, 22, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4]

describe('distributions', () => {
  it('matches reference values', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 7)
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228139, 5)
    expect(chiSquareUpperP(3.841459, 1)).toBeCloseTo(0.05, 6)
    expect(chiSquareUpperP(7.814728, 3)).toBeCloseTo(0.05, 6)
  })
})

describe('t-tests', () => {
  it('Welch matches R t.test', () => {
    const r = welchTTest(a, b)!
    expect(r.t).toBeCloseTo(-2.4554, 3)
    expect(r.df).toBeCloseTo(24.99, 1)
    expect(r.p).toBeCloseTo(0.02138, 4)
    expect(r.ci95.lo).toBeCloseTo(-3.984, 2)
  })
  it('Student and paired run, and refuse unusable input', () => {
    expect(studentTTest(a, b)!.df).toBe(28)
    expect(pairedTTest(a, b)!.df).toBe(14)
    expect(pairedTTest([1, 2], [1])).toBeNull()
    expect(welchTTest([1], [2, 3])).toBeNull()
    expect(welchTTest([1, 1], [1, 1])).toBeNull()
  })
})

describe('Mann–Whitney', () => {
  it('is exact for complete separation', () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])!
    expect(r.method).toBe('exact')
    expect(r.p).toBeCloseTo(0.0079365, 6)
    expect(r.effectSize).toBe(-1)
  })
  it('uses the normal approximation with ties', () => {
    const r = mannWhitneyU([1, 2, 2, 3, 4], [3, 4, 5, 5, 6])!
    expect(r.method).toBe('normal_approximation')
    expect(r.p).toBeGreaterThan(0)
    expect(r.p).toBeLessThan(1)
  })
})

describe('multiple testing', () => {
  it('adjusts p-values', () => {
    const p = [0.01, 0.04, 0.03]
    expect(adjustPValues(p, 'bonferroni')).toEqual([0.03, 0.12, 0.09])
    expect(adjustPValues(p, 'holm')[0]).toBeCloseTo(0.03)
    expect(adjustPValues(p, 'bh')[1]).toBeCloseTo(0.04)
  })
})

describe('post-hoc', () => {
  it('Tukey critical values match tables', () => {
    expect(studentizedRangeQuantile(0.95, 3, 10)).toBeCloseTo(3.877, 2)
    expect(studentizedRangeQuantile(0.95, 4, 20)).toBeCloseTo(3.958, 2)
  })
  it('Dunnett critical values match tables', () => {
    expect(dunnettCritical(0.95, [5, 5, 5], 5, 20)).toBeCloseTo(2.54, 2)
    expect(dunnettCritical(0.95, [4, 4], 4, 10)).toBeCloseTo(2.57, 2)
  })
  const groups = [
    { group: 'control', values: [10, 11, 9, 10.5, 9.5] },
    { group: 'low', values: [10.4, 11.2, 9.9, 10.8, 10.1] },
    { group: 'high', values: [14, 15, 13.5, 14.8, 15.2] },
  ]
  it('Tukey finds the high dose', () => {
    const r = postHocComparisons(groups, 'tukey')!
    const hi = r.comparisons.find((c) => c.group1 === 'control' && c.group2 === 'high')!
    const lo = r.comparisons.find((c) => c.group1 === 'control' && c.group2 === 'low')!
    expect(hi.significant).toBe(true)
    expect(lo.significant).toBe(false)
    expect(hi.ci95.hi).toBeLessThan(0)
  })
  it('Dunnett compares with the control', () => {
    const r = postHocComparisons(groups, 'dunnett', { control: 'control' })!
    expect(r.comparisons).toHaveLength(2)
    expect(r.comparisons.every((c) => c.group2 === 'control')).toBe(true)
    expect(r.comparisons.find((c) => c.group1 === 'high')!.significant).toBe(true)
    expect(postHocComparisons(groups, 'dunnett', { control: 'nope' })).toBeNull()
  })
  it('Bonferroni and Holm run', () => {
    expect(postHocComparisons(groups, 'bonferroni')!.comparisons).toHaveLength(3)
    expect(postHocComparisons(groups, 'holm')!.comparisons).toHaveLength(3)
  })
})

describe('survival', () => {
  const mp6 = [
    ...[6, 6, 6, 7, 10, 13, 16, 22, 23].map((time) => ({ time, event: true, group: '6-MP' })),
    ...[6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35].map((time) => ({ time, event: false, group: '6-MP' })),
  ]
  const control = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map(
    (time) => ({ time, event: true, group: 'control' }),
  )
  it('matches the Kaplan–Meier estimate for 6-MP', () => {
    const km = kaplanMeier(mp6.filter((o) => o.group === '6-MP'), '6-MP')!
    expect(km.n).toBe(21)
    expect(km.events).toBe(9)
    const at6 = km.steps.find((s) => s.time === 6)!
    expect(at6.survival).toBeCloseTo(18 / 21, 6)
    expect(km.steps.find((s) => s.time === 23)!.survival).toBeCloseTo(0.4482, 3)
    expect(km.medianSurvival).toBe(23)
  })
  it('log-rank matches R survdiff', () => {
    const r = logRankTest([...mp6, ...control])!
    expect(r.chiSquare).toBeCloseTo(16.79, 1)
    expect(r.p).toBeLessThan(0.0001)
    expect(r.hazardRatio!.hr).toBeGreaterThan(1)
  })
  it('needs two groups and some events', () => {
    expect(logRankTest(mp6)).toBeNull()
  })
})
