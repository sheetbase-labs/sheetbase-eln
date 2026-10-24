/**
 * SCI-02 — analysis definition correctness, determinism and honest
 * execution errors. All fixtures are hand-computed so the numbers pin the
 * contract shared with the SQL materialisers.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_METHOD_VERSION,
  ANALYSIS_RUNNER,
  analysisMethodsText,
  regressionFitCurve,
  runAnalysis,
  validateAnalysisDefinition,
} from './analysis-definition'
import type {
  AnalysisDefinition,
  DescriptiveDefinition,
  RegressionDefinition,
} from './analysis-definition'
import {
  chiSquare2UpperP,
  fUpperP,
  fitQuality,
  jarqueBeraTest,
  logGamma,
  olsFit,
  olsFitWithInference,
  oneWayAnova,
  polyEval,
  regularizedIncompleteBeta,
  summaryStats,
  tCritical95,
  tTwoSidedP,
} from './stats'
import type { ChartColumn } from './chart-spec'

const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'

const COLUMNS: ChartColumn[] = [
  { id: COL_X, label: 'Time (h)', logicalType: 'integer' },
  { id: COL_Y, label: 'Recovery (%)', logicalType: 'decimal' },
  { id: COL_G, label: 'Condition', logicalType: 'text' },
]

// Runtime rows are keyed by the stable schema-version fieldId.
// y = 2x + 1 exactly for the 20C group; y = x for the 4C group.
const row = (x: number, y: number | string | null, g: string) => ({
  [COL_X]: x,
  [COL_Y]: y,
  [COL_G]: g,
})
const ROWS = [
  row(0, 1, '20C'),
  row(1, 3, '20C'),
  row(2, 5, '20C'),
  row(3, 7, '20C'),
  row(0, 10, '4C'),
  row(1, 11, '4C'),
  row(2, 12, '4C'),
]

const descriptive: DescriptiveDefinition = {
  definitionVersion: 1,
  kind: 'descriptive',
  datasets: [{ datasetId: DATASET_ID }],
  value: { fieldId: COL_Y },
  group: { fieldId: COL_G },
}

const regression: RegressionDefinition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ datasetId: DATASET_ID }],
  outcome: { fieldId: COL_Y },
  predictor: { fieldId: COL_X },
  degree: 1,
  group: { fieldId: COL_G },
}

describe('stats kernel', () => {
  it('computes hand-checked summary statistics', () => {
    // sorted [1,3,5,7]: mean 4, sd sqrt((9+1+1+9)/3)=sqrt(20/3), q1=2.5, med=4, q3=5.5
    const stats = summaryStats([7, 1, 5, 3])!
    expect(stats.n).toBe(4)
    expect(stats.mean).toBe(4)
    expect(stats.q1).toBeCloseTo(2.5, 12)
    expect(stats.median).toBe(4)
    expect(stats.q3).toBeCloseTo(5.5, 12)
    expect(stats.sd!).toBeCloseTo(Math.sqrt(20 / 3), 12)
    expect(stats.se!).toBeCloseTo(Math.sqrt(20 / 3) / 2, 12)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(7)
  })

  it('returns null sd/se for a single value', () => {
    const stats = summaryStats([42])!
    expect(stats.sd).toBeNull()
    expect(stats.se).toBeNull()
  })

  it('fits an exact line through collinear points', () => {
    const fit = olsFit([0, 1, 2, 3], [1, 3, 5, 7], 1)!
    expect(fit.coefficients[0]).toBeCloseTo(1, 10)
    expect(fit.coefficients[1]).toBeCloseTo(2, 10)
    expect(polyEval(fit.coefficients, 10)).toBeCloseTo(21, 8)
  })

  it('returns null for a singular system (constant predictor)', () => {
    expect(olsFit([2, 2, 2], [1, 2, 3], 1)).toBeNull()
  })

  it('fits a quadratic through y = x² samples', () => {
    const fit = olsFit([-2, -1, 0, 1, 2], [4, 1, 0, 1, 4], 2)!
    expect(fit.coefficients[0]).toBeCloseTo(0, 8)
    expect(fit.coefficients[1]).toBeCloseTo(0, 8)
    expect(fit.coefficients[2]).toBeCloseTo(1, 8)
  })

  it('recovers an exact line over large-magnitude predictors (x ≈ 1e5)', () => {
    // Centre-and-scale keeps the normal equations well conditioned even
    // when raw x⁴ columns would overflow the condition number.
    const xs = Array.from({ length: 10 }, (_, i) => 100000 + i)
    const ys = xs.map((x) => 2.5 * x + 1234)
    const fit = olsFit(xs, ys, 1)!
    expect(Math.abs((fit.coefficients[1] - 2.5) / 2.5)).toBeLessThanOrEqual(
      1e-8,
    )
    expect(Math.abs((fit.coefficients[0] - 1234) / 1234)).toBeLessThanOrEqual(
      1e-6,
    )
  })

  it('recovers integer-coefficient cubics on x ~ 1e5–3e5 in raw space', () => {
    const xs = [100000, 150000, 200000, 250000, 300000]
    const ys = xs.map((x) => x ** 3 - 2 * x ** 2 + 5 * x - 3)
    const fit = olsFit(xs, ys, 3)!
    // Relative residuals stay at machine-precision level of |y|.
    xs.forEach((x, i) => {
      const predicted = polyEval(fit.coefficients, x)
      expect(Math.abs(predicted - ys[i])).toBeLessThanOrEqual(
        1e-12 * Math.abs(ys[i]),
      )
    })
    // The leading raw-space coefficient is recovered to ≤1e-9 relative error.
    expect(Math.abs(fit.coefficients[3] - 1)).toBeLessThanOrEqual(1e-9)
    const quality = fitQuality(xs, ys, fit.coefficients)
    expect(quality.r2).toBeGreaterThan(0.999999)
  })

  it('fits a quartic through tiny-variance predictors', () => {
    // Predictor spread is O(1e-6) — variance ~1e-11 — so centring and
    // scaling must absorb the near-singular raw-space system.
    const xs = Array.from({ length: 40 }, (_, i) => i * 1e-6)
    const ys = xs.map((x) => {
      const u = x * 1e6
      return u ** 4 - 2 * u ** 3 + 0.5 * u + 7
    })
    const fit = olsFit(xs, ys, 4)!
    const quality = fitQuality(xs, ys, fit.coefficients)
    expect(quality.r2).toBeGreaterThan(0.999999)
    expect(Math.abs(fit.coefficients[4] - 1e24) / 1e24).toBeLessThanOrEqual(
      1e-9,
    )
  })
})

describe('validateAnalysisDefinition', () => {
  it('accepts the canonical definitions', () => {
    expect(validateAnalysisDefinition(descriptive)).toEqual([])
    expect(validateAnalysisDefinition(regression)).toEqual([])
  })

  it('rejects unknown kinds and bad degrees', () => {
    expect(
      validateAnalysisDefinition({ ...descriptive, kind: 'magic' }),
    ).toContainEqual(expect.objectContaining({ code: 'unsupported_kind' }))
    expect(
      validateAnalysisDefinition({ ...regression, degree: 9 }),
    ).toContainEqual(expect.objectContaining({ field: 'degree' }))
    expect(
      validateAnalysisDefinition({ ...regression, degree: 1.5 }),
    ).toContainEqual(expect.objectContaining({ field: 'degree' }))
  })

  it('requires exactly one dataset reference', () => {
    for (const datasets of [
      [],
      [{ datasetId: DATASET_ID }, { datasetId: DATASET_ID }],
    ]) {
      const errors = validateAnalysisDefinition({ ...descriptive, datasets })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        code: 'unsupported_dataset_count',
        field: 'datasets',
      })
    }
  })

  it('validates bindings by UUID fieldId only', () => {
    const errors = validateAnalysisDefinition({
      ...descriptive,
      value: { fieldId: 'not-a-uuid' },
    })
    expect(errors).toContainEqual(
      expect.objectContaining({
        code: 'invalid_value',
        field: 'value.fieldId',
      }),
    )
    // A well-formed fieldId binding carries no other required keys.
    expect(validateAnalysisDefinition({ ...descriptive, group: null })).toEqual(
      [],
    )
  })

  it('requires dataset references to be UUIDs', () => {
    expect(
      validateAnalysisDefinition({
        ...descriptive,
        datasets: [{ datasetId: 'not-a-uuid' }],
      }),
    ).toContainEqual(
      expect.objectContaining({ field: 'datasets[0].datasetId' }),
    )
  })
})

describe('runAnalysis', () => {
  it('computes grouped descriptive statistics in sorted group order', () => {
    const result = runAnalysis(descriptive, COLUMNS, ROWS)
    expect(result.ok).toBe(true)
    if (!result.ok || result.result.kind !== 'descriptive') return
    expect(result.result.rows.map((r) => r.group)).toEqual(['20C', '4C'])
    const g20 = result.result.rows[0]
    expect(g20.stats.n).toBe(4)
    expect(g20.stats.mean).toBe(4)
    expect(g20.missing).toBe(0)
  })

  it('is deterministic across reruns', () => {
    const a = runAnalysis(descriptive, COLUMNS, ROWS)
    const b = runAnalysis(descriptive, COLUMNS, ROWS)
    expect(a).toEqual(b)
    const c = runAnalysis(regression, COLUMNS, ROWS)
    const d = runAnalysis(regression, COLUMNS, ROWS)
    expect(c).toEqual(d)
  })

  it('resolves bindings strictly by column id with no name fallback', () => {
    // Another column now wears the retired binding's label; the fieldId is
    // what resolves, so the execution reports missing_field honestly.
    const impostorColumns: ChartColumn[] = [
      { id: COL_X, label: 'Time (h)', logicalType: 'integer' },
      {
        id: '0198d970-e266-4000-8000-000000000099',
        label: 'Recovery (%)',
        logicalType: 'decimal',
      },
    ]
    expect(runAnalysis(descriptive, impostorColumns, ROWS)).toEqual({
      ok: false,
      error: { code: 'missing_field', fields: ['value'] },
    })
  })

  it('recovers exact linear coefficients and perfect fit quality', () => {
    const result = runAnalysis(regression, COLUMNS, ROWS)
    expect(result.ok).toBe(true)
    if (!result.ok || result.result.kind !== 'regression') return
    const byGroup = Object.fromEntries(
      result.result.rows.map((r) => [r.group, r]),
    )
    expect(byGroup['20C'].coefficients[0]).toBeCloseTo(1, 8)
    expect(byGroup['20C'].coefficients[1]).toBeCloseTo(2, 8)
    expect(byGroup['20C'].r2).toBeCloseTo(1, 8)
    expect(byGroup['4C'].coefficients[1]).toBeCloseTo(1, 8)
  })

  it('curve-fits a quadratic when degree 2 is requested', () => {
    const rows = [-2, -1, 0, 1, 2].map((x) => row(x, x * x, 'all'))
    const result = runAnalysis(
      { ...regression, group: null, degree: 2 },
      COLUMNS,
      rows,
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.result.kind !== 'regression') return
    expect(result.result.rows[0].coefficients[2]).toBeCloseTo(1, 8)
    expect(result.result.rows[0].r2).toBeCloseTo(1, 8)
  })

  it('linearises exponential data through an outcome log transform', () => {
    // y = 10·e^x ⇒ ln y = ln 10 + x exactly.
    const rows = [0, 1, 2, 3].map((x) => row(x, 10 * Math.exp(x), 'all'))
    const result = runAnalysis(
      {
        ...regression,
        group: null,
        outcomeTransform: 'ln',
      },
      COLUMNS,
      rows,
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.result.kind !== 'regression') return
    expect(result.result.rows[0].coefficients[1]).toBeCloseTo(1, 8)
    expect(result.result.rows[0].coefficients[0]).toBeCloseTo(Math.log(10), 6)
  })

  it('refuses log transforms over non-positive values', () => {
    const rows = [row(-1, 1, 'all'), row(1, 2, 'all')]
    const result = runAnalysis(
      { ...regression, group: null, predictorTransform: 'log10' },
      COLUMNS,
      rows,
    )
    expect(result).toEqual({
      ok: false,
      error: { code: 'nonpositive_transform', field: 'predictor', count: 1 },
    })
  })

  it('surfaces insufficient data, empty datasets and missing fields honestly', () => {
    expect(
      runAnalysis({ ...regression, group: null, degree: 4 }, COLUMNS, [
        row(0, 1, 'all'),
      ]),
    ).toEqual({
      ok: false,
      error: { code: 'insufficient_data', group: 'all', needed: 5 },
    })
    expect(runAnalysis(descriptive, COLUMNS, [])).toEqual({
      ok: false,
      error: { code: 'empty_dataset' },
    })
    expect(
      runAnalysis(
        descriptive,
        COLUMNS.filter((c) => c.id !== COL_Y),
        ROWS,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'missing_field', fields: ['value'] },
    })
  })

  it('counts missing values instead of shifting group alignment', () => {
    const result = runAnalysis(descriptive, COLUMNS, [
      ...ROWS,
      row(9, 'oops', '20C'),
      row(9, null, '20C'),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok || result.result.kind !== 'descriptive') return
    expect(result.result.rows[0].missing).toBe(2)
    expect(result.result.rows[0].stats.n).toBe(4)
  })
})

describe('analysis definition typing', () => {
  it('keeps definitions assignable to the union', () => {
    const defs: AnalysisDefinition[] = [descriptive, regression]
    expect(defs).toHaveLength(2)
  })
})

describe('regressionFitCurve', () => {
  it('samples the polynomial inclusively across the range', () => {
    const pts = regressionFitCurve([1, 2], { min: 0, max: 10 }, 5)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual({ x: 0, y: 1 })
    expect(pts[4]).toEqual({ x: 10, y: 21 })
    expect(pts[2].x).toBeCloseTo(5, 10)
    expect(pts[2].y).toBeCloseTo(11, 10)
  })

  it('degenerates gracefully', () => {
    expect(regressionFitCurve([], { min: 0, max: 1 })).toEqual([])
    expect(regressionFitCurve([1, 2], { min: 3, max: 3 }, 4)).toHaveLength(4)
  })
})

describe('flagged-value exclusion (DSET-01.2)', () => {
  it('excludes a value whose field is flagged from descriptive stats', () => {
    const rows = [
      { ...row(0, 1, '20C'), __sheetbaseRowId: 'r1' },
      { ...row(1, 3, '20C'), __sheetbaseRowId: 'r2' },
    ]
    const result = runAnalysis(descriptive, COLUMNS, rows, [
      {
        id: 'f1',
        datasetId: DATASET_ID,
        rowId: 'r2',
        fieldId: COL_Y,
        kind: 'out_of_range',
        reason: 'Above top standard',
        comment: null,
        setAt: '2026-09-25T09:40:00Z',
      },
    ])
    expect(result.ok).toBe(true)
    if (result.ok && result.result.kind === 'descriptive') {
      const group = result.result.rows.find((entry) => entry.group === '20C')
      expect(group?.stats.n).toBe(1)
      expect(group?.stats.mean).toBe(1)
    }
  })

  it('states the exclusion in the reported checks instead of hiding it', () => {
    const rows = [
      { ...row(0, 1, '20C'), __sheetbaseRowId: 'r1' },
      { ...row(1, 3, '20C'), __sheetbaseRowId: 'r2' },
    ]
    const result = runAnalysis(descriptive, COLUMNS, rows, [
      {
        id: 'f1',
        datasetId: DATASET_ID,
        rowId: 'r2',
        fieldId: COL_Y,
        kind: 'out_of_range',
        reason: 'Above top standard',
        comment: null,
        setAt: '2026-09-25T09:40:00Z',
      },
    ])
    if (!result.ok || result.result.kind !== 'descriptive')
      throw new Error('expected descriptive result')
    const exclusion = result.result.checks.find(
      (check) => check.id === 'excluded_rows',
    )
    expect(exclusion?.status).toBe('warn')
    expect(exclusion?.detail).toContain('1 row(s) were excluded')
  })
})

// ---------------------------------------------------------------------------
// R5-STUDIO-01 — sampling distributions, linear-model inference, methods
// ---------------------------------------------------------------------------

describe('sampling distributions', () => {
  it('computes log-gamma at hand-known points', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12)
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12)
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12)
    expect(logGamma(6)).toBeCloseTo(Math.log(120), 12)
  })

  it('computes the incomplete beta in closed-form cases', () => {
    expect(regularizedIncompleteBeta(1, 1, 0.3)).toBeCloseTo(0.3, 12)
    expect(regularizedIncompleteBeta(1, 3, 0.5)).toBeCloseTo(0.875, 12)
    // I_x(½, ½) = (2/π)·asin(√x) → x = ¼ gives exactly 1/3.
    expect(regularizedIncompleteBeta(0.5, 0.5, 0.25)).toBeCloseTo(1 / 3, 12)
    expect(regularizedIncompleteBeta(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('matches t-table critical values', () => {
    // df = 2 has the closed form P(|T| > t) = 1 − t/√(t² + 2).
    expect(tTwoSidedP(2, 2)).toBeCloseTo(1 - 2 / Math.sqrt(6), 12)
    expect(tTwoSidedP(1, 1)).toBeCloseTo(0.5, 12)
    expect(tTwoSidedP(0, 7)).toBe(1)
    // 2.306 is the two-sided 5% critical value at 8 df.
    expect(tTwoSidedP(2.306, 8)).toBeCloseTo(0.05, 3)
  })

  it('matches F-table critical values and the t identity', () => {
    // 5.143 is the 5% critical value for F(2, 6).
    expect(fUpperP(5.143, 2, 6)).toBeCloseTo(0.05, 3)
    expect(fUpperP(0, 3, 4)).toBe(1)
    // F(1, df) is exactly t(df)², so the two tails must agree.
    for (const t of [0.5, 1.4, 2.9])
      expect(fUpperP(t * t, 1, 9)).toBeCloseTo(tTwoSidedP(t, 9), 12)
  })

  it('reduces the two-degree χ² tail to exp(−x/2)', () => {
    expect(chiSquare2UpperP(0)).toBe(1)
    expect(chiSquare2UpperP(2)).toBeCloseTo(Math.exp(-1), 12)
  })
})

describe('linear model inference', () => {
  // x̄ = 3, ȳ = 4, Sxx = 10, Sxy = 6 → intercept 2.2, slope 0.6.
  // Residuals −0.8, 0.6, 1.0, −0.6, −0.2 → SSE 2.4 on 3 residual df.
  const XS = [1, 2, 3, 4, 5]
  const YS = [2, 4, 5, 4, 5]

  it('recovers hand-computed coefficients, errors, intervals and F', () => {
    const fit = olsFitWithInference(XS, YS, 1)!
    expect(fit.coefficients[0]).toBeCloseTo(2.2, 10)
    expect(fit.coefficients[1]).toBeCloseTo(0.6, 10)
    expect(fit.dfResidual).toBe(3)
    expect(fit.sigma!).toBeCloseTo(Math.sqrt(0.8), 10)
    expect(fit.r2).toBeCloseTo(0.6, 10)
    expect(fit.adjR2!).toBeCloseTo(1 - 0.4 * (4 / 3), 10)
    // SE² = σ²·(XᵀX)⁻¹ in raw x: slope 0.8/10; intercept 0.8·(1/5 + 9/10).
    expect(fit.covariance[1][1]).toBeCloseTo(0.08, 10)
    expect(fit.covariance[0][0]).toBeCloseTo(0.8 * 1.1, 10)
    // Leverage h_i = 1/n + (x_i − x̄)²/Sxx.
    expect(fit.leverage[0]).toBeCloseTo(0.6, 10)
    expect(fit.leverage[2]).toBeCloseTo(0.2, 10)
    // F = t² for a degree-1 fit: 0.6²/(0.8/10) = 4.5.
    expect(fit.f!).toBeCloseTo(4.5, 10)
    expect(fit.fP!).toBeCloseTo(tTwoSidedP(0.6 / Math.sqrt(0.08), 3), 12)
    // Cook's distance at the end point is 0.8²/(2·0.8)·0.6/0.4² = 1.5.
    expect(fit.maxCooksDistance!).toBeCloseTo(1.5, 10)
    expect(
      fit.residuals.map((residual) => Number(residual.toPrecision(6))),
    ).toEqual([-0.8, 0.6, 1, -0.6, -0.2])
  })

  it('reports the terms, the method and every check it ran', () => {
    const rows = XS.map((x, index) => row(x, YS[index], 'all'))
    const result = runAnalysis({ ...regression, group: null }, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'regression')
      throw new Error('expected a regression result')
    const { method, checks } = result.result
    expect(method.id).toBe('linear_model')
    expect(method.version).toBe(ANALYSIS_METHOD_VERSION)
    expect(method.runner).toBe(ANALYSIS_RUNNER)
    expect(method.label).toBe('Linear model (ordinary least squares)')
    expect(method.statement).toContain('Ordinary least squares fit')

    const fit = result.result.rows[0]
    expect(fit.terms.map((term) => term.term)).toEqual(['Intercept', 'x'])
    expect(fit.terms[1].estimate).toBeCloseTo(0.6, 10)
    expect(fit.terms[1].se).toBeCloseTo(Math.sqrt(0.08), 10)
    expect(fit.terms[1].ci95!.lo).toBeCloseTo(
      0.6 - tCritical95(3) * Math.sqrt(0.08),
      10,
    )
    expect(fit.terms[1].ci95!.hi).toBeCloseTo(
      0.6 + tCritical95(3) * Math.sqrt(0.08),
      10,
    )
    expect(fit.terms[1].p!).toBeCloseTo(
      tTwoSidedP(0.6 / Math.sqrt(0.08), 3),
      12,
    )
    // The overall F and the slope's t are the same test at degree 1.
    expect(fit.fP!).toBeCloseTo(fit.terms[1].p!, 12)

    expect(checks.map((check) => check.id)).toEqual([
      'residual_normality',
      'constant_variance',
      'independent_observations',
      'replicate_predictor_values',
      'influence',
      'residual_df',
    ])
    // Five residuals is below Jarque–Bera's floor: the check must say so.
    expect(checks[0].status).toBe('not_checked')
    expect(checks[2].status).toBe('not_checked')
    // One observation per predictor value, and Cook's distance is 1.5.
    expect(checks[3].status).toBe('warn')
    expect(checks[4].status).toBe('warn')
    expect(checks[4].statistic).toBeCloseTo(1.5, 10)
    // 3 residual df for 2 terms.
    expect(checks[5].status).toBe('warn')
  })

  it('attributes per-group checks to the group they describe', () => {
    const rows = [
      row(0, 1, '20C'),
      row(1, 3, '20C'),
      row(2, 5, '20C'),
      row(0, 10, '4C'),
      row(1, 11, '4C'),
      row(2, 12, '4C'),
    ]
    // The `regression` fixture groups by condition, so two models run and
    // each carries its own six checks — no duplicate keys, no lost attribution.
    const result = runAnalysis(regression, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'regression')
      throw new Error('expected a regression result')
    const checks = result.result.checks
    expect(checks).toHaveLength(12)
    expect(checks.slice(0, 6).every((check) => check.group === '20C')).toBe(
      true,
    )
    expect(checks.slice(6).every((check) => check.group === '4C')).toBe(true)
    expect(
      new Set(checks.map((check) => `${check.group}:${check.id}`)).size,
    ).toBe(checks.length)
  })

  it('states that an ungrouped descriptive run makes no distributional claim', () => {
    const rows = XS.map((x, index) => row(x, YS[index], 'all'))
    const result = runAnalysis({ ...descriptive, group: null }, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'descriptive')
      throw new Error('expected a descriptive result')
    expect(result.result.method.id).toBe('descriptive')
    expect(result.result.checks).toEqual([])
    expect(result.result.anova).toBeNull()
  })

  it('runs no F test when only one group holds values', () => {
    const rows = XS.map((x, index) => row(x, YS[index], '20C'))
    const result = runAnalysis(descriptive, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'descriptive')
      throw new Error('expected a descriptive result')
    expect(result.result.method.id).toBe('one_way_anova')
    expect(result.result.anova).toBeNull()
    expect(result.result.checks.map((check) => check.id)).toEqual([
      'anova_defined',
    ])
    expect(result.result.checks[0].detail).toContain('at least two')
  })
})

describe('one-way ANOVA', () => {
  it('computes hand-checked sums of squares and the F test', () => {
    // Three groups of 1–3, 4–6, 7–9: grand mean 5, SS_between 54,
    // SS_within 6, df (2, 6), F 27, η² 54/60.
    const groups = [
      { group: 'A', values: [1, 2, 3] },
      { group: 'B', values: [4, 5, 6] },
      { group: 'C', values: [7, 8, 9] },
    ]
    const anova = oneWayAnova(groups)!
    expect(anova.n).toBe(9)
    expect(anova.grandMean).toBe(5)
    expect(anova.ssBetween).toBeCloseTo(54, 10)
    expect(anova.ssWithin).toBeCloseTo(6, 10)
    expect(anova.dfBetween).toBe(2)
    expect(anova.dfWithin).toBe(6)
    expect(anova.msBetween).toBeCloseTo(27, 10)
    expect(anova.msWithin).toBeCloseTo(1, 10)
    expect(anova.f).toBeCloseTo(27, 10)
    expect(anova.p).toBeCloseTo(fUpperP(27, 2, 6), 12)
    expect(anova.etaSquared).toBeCloseTo(0.9, 10)
    expect(anova.groups.map((group) => group.mean)).toEqual([2, 5, 8])
    // Group A: sd 1, so the mean's 95% interval is 2 ± t(2)·1/√3.
    expect(anova.groups[0].sd!).toBeCloseTo(1, 10)
    expect(anova.groups[0].ci95!.lo).toBeCloseTo(
      2 - tCritical95(2) / Math.sqrt(3),
      10,
    )
  })

  it('agrees exactly with the two-sided t test for two groups', () => {
    const anova = oneWayAnova([
      { group: 'A', values: [1, 2, 3] },
      { group: 'B', values: [7, 8, 9] },
    ])!
    // Means 2 and 8, pooled sd 1, so F = 54 = t² with 4 residual df.
    expect(anova.f).toBeCloseTo(54, 10)
    expect(anova.dfWithin).toBe(4)
    expect(anova.p).toBeCloseTo(tTwoSidedP(Math.sqrt(54), 4), 12)
  })

  it('refuses to run when the test is undefined', () => {
    expect(oneWayAnova([{ group: 'A', values: [1, 2] }])).toBeNull()
    expect(
      oneWayAnova([
        { group: 'A', values: [1, 2] },
        { group: 'B', values: [3, 3] },
      ]),
    ).not.toBeNull()
    // Every group constant: no within-group variance, so no F test.
    expect(
      oneWayAnova([
        { group: 'A', values: [2, 2] },
        { group: 'B', values: [5, 5] },
      ]),
    ).toBeNull()
  })

  it('reports the grouped method and its checks through runAnalysis', () => {
    const rows = [
      row(0, 1, 'A'),
      row(1, 2, 'A'),
      row(2, 3, 'A'),
      row(0, 4, 'B'),
      row(1, 5, 'B'),
      row(2, 6, 'B'),
      row(0, 7, 'C'),
      row(1, 8, 'C'),
      row(2, 9, 'C'),
    ]
    const result = runAnalysis(descriptive, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'descriptive')
      throw new Error('expected a descriptive result')
    expect(result.result.method.id).toBe('one_way_anova')
    expect(result.result.method.label).toBe('One-way ANOVA')
    const anova = result.result.anova!
    expect(anova.f).toBeCloseTo(27, 10)
    expect(anova.groups.map((group) => group.group)).toEqual(['A', 'B', 'C'])
    expect(result.result.checks.map((check) => check.id)).toEqual([
      'residual_normality',
      'equal_variance',
      'independent_observations',
      'group_sizes',
    ])
  })
})

describe('violated assumptions are reported, not corrected', () => {
  it('fails the constant-variance check on deliberately fanning residuals', () => {
    // By construction the residual spread is 80× larger in the second half
    // (±0.1 versus ±8), so squared residuals track the fitted values.
    const noise = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 8, -8, 8, -8, 8, -8]
    const rows = noise.map((d, index) => row(index + 1, index + 1 + d, 'all'))
    const result = runAnalysis({ ...regression, group: null }, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'regression')
      throw new Error('expected a regression result')
    const check = result.result.checks.find(
      (entry) => entry.id === 'constant_variance',
    )!
    expect(check.status).toBe('fail')
    expect(check.pValue!).toBeLessThan(0.05)
    expect(check.remedy).toBeTruthy()
    // The fit itself is reported unchanged: a failed check never silently
    // transforms or drops the data.
    expect(result.result.rows[0].n).toBe(12)
    expect(result.result.rows[0].terms).toHaveLength(2)
  })

  it('fails the normality check when within-group residuals are far from normal', () => {
    // Group B is four flat values plus one outlier, so the within-group
    // residuals are 5 zeros, four −20s and one 80: strongly skewed and
    // heavy-tailed, which Jarque–Bera must reject.
    const rows = [
      row(0, 0, 'A'),
      row(1, 0, 'A'),
      row(2, 0, 'A'),
      row(3, 0, 'A'),
      row(4, 0, 'A'),
      row(0, 0, 'B'),
      row(1, 0, 'B'),
      row(2, 0, 'B'),
      row(3, 0, 'B'),
      row(4, 100, 'B'),
    ]
    const result = runAnalysis(descriptive, COLUMNS, rows)
    if (!result.ok || result.result.kind !== 'descriptive')
      throw new Error('expected a descriptive result')
    const check = result.result.checks.find(
      (entry) => entry.id === 'residual_normality',
    )!
    expect(check.status).toBe('fail')
    expect(check.pValue!).toBeLessThan(0.01)
    expect(check.statistic!).toBeGreaterThan(10)
    expect(check.remedy).toBeTruthy()
    // The ANOVA is still reported: a failed check never suppresses the model.
    expect(result.result.anova).not.toBeNull()
  })

  it('computes Jarque–Bera at a hand-worked sample', () => {
    // Nine −10s and one 90: m₂ = 900, m₃ = 72000, m₄ = 6570000 →
    // skewness 8/3, excess kurtosis 46/9, JB = 40/6·(8/3)² … = 22.736625…
    const sample = [...Array<number>(9).fill(-10), 90]
    const jb = jarqueBeraTest(sample)!
    expect(jb.skewness).toBeCloseTo(8 / 3, 10)
    expect(jb.excessKurtosis).toBeCloseTo(46 / 9, 10)
    expect(jb.statistic).toBeCloseTo(22.736625, 5)
    expect(jb.p).toBeCloseTo(chiSquare2UpperP(jb.statistic), 12)
    // Below the floor the kernel refuses to test rather than guessing.
    expect(jarqueBeraTest([1, 2, 3])).toBeNull()
  })
})

describe('analysis method reporting', () => {
  it('states the method, the runner and each check in a citable sentence', () => {
    const rows = [1, 2, 3, 4, 5].map((x) =>
      row(x, [2, 4, 5, 4, 5][x - 1], 'all'),
    )
    const result = runAnalysis({ ...regression, group: null }, COLUMNS, rows)
    if (!result.ok) throw new Error('expected ok')
    const text = analysisMethodsText(result.result)
    expect(text).toContain('Linear model (ordinary least squares)')
    expect(text).toContain(
      `${ANALYSIS_RUNNER}, method v${ANALYSIS_METHOD_VERSION}`,
    )
    expect(text).toContain('overall F(1, 3) = 4.5')
    expect(text).toContain('Intercept 2.2')
    expect(text).toContain('Residuals are normal — not checked')
    // Deterministic: the same result always produces the same sentence.
    expect(analysisMethodsText(result.result)).toBe(text)
  })

  it('stamps the same method version the freeze RPC records', () => {
    // The freeze RPC is the only writer of a frozen payload, so the recorded
    // version lives in SQL. This guards the two against drifting apart.
    const migration = readFileSync('drizzle/0000_baseline.sql', 'utf8')
    expect(migration).toMatch(
      new RegExp(`'methodVersion',\\s*${ANALYSIS_METHOD_VERSION},`),
    )
    expect(migration).toContain('freeze_analysis_block')
  })
})
