/**
 * SCI-02 — analysis definition correctness, determinism and honest
 * execution errors. All fixtures are hand-computed so the numbers pin the
 * contract shared with the SQL materialisers.
 */
import { describe, expect, it } from 'vitest'

import {
  regressionFitCurve,
  runAnalysis,
  validateAnalysisDefinition,
} from './analysis-definition'
import type {
  AnalysisDefinition,
  DescriptiveDefinition,
  RegressionDefinition,
} from './analysis-definition'
import { fitQuality, olsFit, polyEval, summaryStats } from './stats'
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
})
