import { describe, expect, it } from 'vitest'

import {
  curveEc50,
  curveInverse,
  curvePoints,
  curveValue,
  fitCurve,
} from './curve-fit'
import type { CurveParameters } from './curve-fit'

const DOSES = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]

/** Deterministic pseudo-noise so the tests never flake. */
function noise(i: number, scale: number): number {
  return Math.sin(i * 12.9898) * scale
}

describe('curveValue and curveInverse', () => {
  const rising: CurveParameters = { A: 0.05, B: 1.4, C: 20, D: 2.4, G: 1 }

  it('goes through the midpoint at C for a 4PL', () => {
    expect(curveValue(rising, 20)).toBeCloseTo((0.05 + 2.4) / 2, 10)
    expect(curveEc50(rising, '4pl')).toBe(20)
  })

  it('inverts the curve it evaluates, for both models', () => {
    const asym: CurveParameters = { ...rising, G: 0.6 }
    for (const [params, model] of [
      [rising, '4pl'],
      [asym, '5pl'],
    ] as const) {
      for (const x of [0.5, 5, 20, 90, 700]) {
        const back = curveInverse(params, curveValue(params, x, model), model)
        expect(back).not.toBeNull()
        expect(back!).toBeCloseTo(x, 6)
      }
    }
  })

  it('has no dose for a response outside the asymptotes', () => {
    expect(curveInverse(rising, 3)).toBeNull()
    expect(curveInverse(rising, -1)).toBeNull()
    expect(curveInverse(rising, 2.4)).toBeNull()
  })

  it('puts the 5PL half-way response at C·(2^(1/G) − 1)^(1/B)', () => {
    const asym: CurveParameters = { A: 0, B: 2, C: 10, D: 100, G: 0.5 }
    const ec50 = curveEc50(asym, '5pl')
    expect(curveValue(asym, ec50, '5pl')).toBeCloseTo(50, 6)
  })
})

describe('fitCurve', () => {
  it('recovers a noise-free rising 4PL exactly', () => {
    const truth: CurveParameters = { A: 0.05, B: 1.4, C: 20, D: 2.4, G: 1 }
    const fit = fitCurve(
      DOSES,
      DOSES.map((x) => curveValue(truth, x)),
      '4pl',
    )!
    expect(fit.converged).toBe(true)
    expect(fit.params.A).toBeCloseTo(0.05, 4)
    expect(fit.params.B).toBeCloseTo(1.4, 4)
    expect(fit.params.C).toBeCloseTo(20, 3)
    expect(fit.params.D).toBeCloseTo(2.4, 4)
    expect(fit.ec50).toBeCloseTo(20, 3)
    expect(fit.r2).toBeCloseTo(1, 8)
    expect(fit.falling).toBe(false)
  })

  it('fits a falling (inhibition) curve and reports its IC50 direction', () => {
    const truth: CurveParameters = { A: 100, B: 1.1, C: 8, D: 4, G: 1 }
    const ys = DOSES.map((x, i) => curveValue(truth, x) + noise(i, 1.5))
    const fit = fitCurve(DOSES, ys, '4pl')!
    expect(fit.falling).toBe(true)
    expect(fit.ec50).toBeGreaterThan(6)
    expect(fit.ec50).toBeLessThan(10.5)
    expect(fit.r2).toBeGreaterThan(0.99)
    const c = fit.estimates.find((e) => e.name === 'C')!
    expect(c.ci95!.lo).toBeLessThan(fit.ec50)
    expect(c.ci95!.hi).toBeGreaterThan(fit.ec50)
    expect(fit.ec50Ci95!.lo).toBeLessThan(fit.ec50)
    expect(fit.ec50Ci95!.hi).toBeGreaterThan(fit.ec50)
  })

  it('recovers an asymmetric 5PL and its half-way dose', () => {
    const truth: CurveParameters = { A: 0.1, B: 1.8, C: 40, D: 3, G: 0.55 }
    const doses = [0.05, 0.15, 0.5, 1.5, 5, 15, 50, 150, 500, 1500]
    const fit = fitCurve(
      doses,
      doses.map((x) => curveValue(truth, x, '5pl')),
      '5pl',
    )!
    expect(fit.r2).toBeCloseTo(1, 6)
    expect(fit.ec50).toBeCloseTo(curveEc50(truth, '5pl'), 1)
    expect(fit.estimates.map((e) => e.name)).toEqual(['A', 'B', 'C', 'D', 'G'])
  })

  it('refuses too few points, zero doses and non-finite responses', () => {
    expect(fitCurve([1, 2, 3], [1, 2, 3], '4pl')).toBeNull()
    expect(fitCurve([0, 1, 2, 3, 4], [1, 2, 3, 4, 5], '4pl')).toBeNull()
    expect(
      fitCurve([1, 2, 3, 4, 5], [1, 2, Number.NaN, 4, 5], '4pl'),
    ).toBeNull()
  })

  it('has no standard errors when the points just fit the parameters', () => {
    const truth: CurveParameters = { A: 0, B: 1, C: 10, D: 5, G: 1 }
    const xs = [1, 5, 20, 100]
    const fit = fitCurve(
      xs,
      xs.map((x) => curveValue(truth, x)),
      '4pl',
    )!
    expect(fit.dfResidual).toBe(0)
    expect(fit.sigma).toBeNull()
    expect(fit.estimates.every((e) => e.se === null)).toBe(true)
  })

  it('draws a smooth curve across the dose range', () => {
    const points = curvePoints(
      { A: 0, B: 1, C: 10, D: 5, G: 1 },
      '4pl',
      { min: 1, max: 1000 },
      40,
    )
    expect(points).toHaveLength(40)
    expect(points[0].x).toBeCloseTo(1)
    expect(points[39].x).toBeCloseTo(1000)
    expect(points[39].y).toBeGreaterThan(points[0].y)
  })
})
