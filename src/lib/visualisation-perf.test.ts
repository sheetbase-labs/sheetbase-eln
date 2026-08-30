/**
 * SCI-04 repeatable visualisation/analysis benchmark.
 * Measures data preparation, OLS, and render-ready payload size.
 */
import { describe, expect, it } from 'vitest'

import { CHART_SPEC_VERSION, materialiseChart } from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'
import { olsFit } from './stats'

const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'

function columns(): ChartColumn[] {
  return [
    { id: COL_X, label: 'x', logicalType: 'decimal' },
    { id: COL_Y, label: 'y', logicalType: 'decimal' },
    { id: COL_G, label: 'g', logicalType: 'text' },
  ]
}

function spec(): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ datasetId: '0198d970-e266-4000-8000-000000000001' }],
    fields: {
      x: { fieldId: COL_X },
      y: { fieldId: COL_Y },
      series: { fieldId: COL_G },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { scale: 'linear' },
        y: { scale: 'linear' },
      },
      series: [],
    },
    overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
  }
}

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    [COL_X]: i,
    [COL_Y]: i * 0.5 + (i % 7),
    [COL_G]: i % 2 === 0 ? 'A' : 'B',
  }))
}

describe('SCI-04 visualisation performance envelope', () => {
  it('prepares 1k and 10k scatter payloads within a practical envelope', () => {
    const cols = columns()
    const t1 = performance.now()
    const oneK = materialiseChart(spec(), cols, rows(1000))
    const prep1k = performance.now() - t1
    const t2 = performance.now()
    const tenK = materialiseChart(spec(), cols, rows(10_000))
    const prep10k = performance.now() - t2
    expect(oneK.state.kind).toBe('ok')
    expect(tenK.state.kind).toBe('ok')
    expect(prep1k).toBeLessThan(1500)
    expect(prep10k).toBeLessThan(8000)
    const payload = JSON.stringify(tenK.series).length
    expect(payload).toBeGreaterThan(1000)
  })

  it('fits OLS over representative input deterministically', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i)
    const ys = xs.map((x) => 3 + 0.25 * x)
    const t0 = performance.now()
    const fit = olsFit(xs, ys, 1)
    const ms = performance.now() - t0
    expect(fit?.coefficients[1]).toBeCloseTo(0.25, 8)
    expect(ms).toBeLessThan(200)
  })
})
