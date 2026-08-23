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
import { olsFit, polyEval, summaryStats } from './stats'
import type { ChartColumn } from './chart-spec'

const TABLE_ID = '0198d970-e266-4000-8000-000000000001'
const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'

const COLUMNS: ChartColumn[] = [
  { id: COL_X, fieldName: 'col_x', label: 'Time (h)', logicalType: 'integer' },
  {
    id: COL_Y,
    fieldName: 'col_y',
    label: 'Recovery (%)',
    logicalType: 'decimal',
  },
  { id: COL_G, fieldName: 'col_g', label: 'Condition', logicalType: 'text' },
]

// y = 2x + 1 exactly for the 20C group; y = x for the 4C group.
const ROWS = [
  { col_x: 0, col_y: 1, col_g: '20C' },
  { col_x: 1, col_y: 3, col_g: '20C' },
  { col_x: 2, col_y: 5, col_g: '20C' },
  { col_x: 3, col_y: 7, col_g: '20C' },
  { col_x: 0, col_y: 10, col_g: '4C' },
  { col_x: 1, col_y: 11, col_g: '4C' },
  { col_x: 2, col_y: 12, col_g: '4C' },
]

const descriptive: DescriptiveDefinition = {
  definitionVersion: 1,
  kind: 'descriptive',
  datasets: [{ tableId: TABLE_ID }],
  value: { columnId: COL_Y, fieldName: 'col_y' },
  group: { columnId: COL_G, fieldName: 'col_g' },
}

const regression: RegressionDefinition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ tableId: TABLE_ID }],
  outcome: { columnId: COL_Y, fieldName: 'col_y' },
  predictor: { columnId: COL_X, fieldName: 'col_x' },
  degree: 1,
  group: { columnId: COL_G, fieldName: 'col_g' },
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

  it('requires bindings and dataset references', () => {
    expect(
      validateAnalysisDefinition({
        ...descriptive,
        value: { columnId: 'not-a-uuid', fieldName: 'x' },
      }),
    ).toContainEqual(expect.objectContaining({ field: 'value.columnId' }))
    expect(
      validateAnalysisDefinition({ ...descriptive, datasets: [] }),
    ).toContainEqual(expect.objectContaining({ field: 'datasets' }))
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
    const rows = [-2, -1, 0, 1, 2].map((x) => ({
      col_x: x,
      col_y: x * x,
      col_g: 'all',
    }))
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
    const rows = [0, 1, 2, 3].map((x) => ({
      col_x: x,
      col_y: 10 * Math.exp(x),
      col_g: 'all',
    }))
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
    const rows = [
      { col_x: -1, col_y: 1, col_g: 'all' },
      { col_x: 1, col_y: 2, col_g: 'all' },
    ]
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
        { col_x: 0, col_y: 1, col_g: 'all' },
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
      { col_x: 9, col_y: 'oops', col_g: '20C' },
      { col_x: 9, col_y: null, col_g: '20C' },
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
