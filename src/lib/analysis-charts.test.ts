import { describe, expect, it } from 'vitest'

import {
  analysisCharts,
  axisTitle,
  chartTitle,
  nextChart,
  numericColumns,
  withYColumn,
} from './analysis-charts'
import type { ChartColumn, ChartSpec } from './chart-spec'

const columns: ChartColumn[] = [
  { id: 'train', label: 'Filter train', logicalType: 'text' },
  { id: 'load', label: 'Load', logicalType: 'decimal', unit: 'L/m²' },
  {
    id: 'yield',
    label: 'Step yield',
    logicalType: 'decimal',
    unit: { kind: 'quantity', symbol: '%', dimension: '%', storageUnit: '%' },
  },
  { id: 'ntu', label: 'Turbidity out', logicalType: 'decimal' },
]

const spec: ChartSpec = {
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: 'ds' }],
  fields: {
    x: { fieldId: 'load' },
    y: { fieldId: 'yield' },
    series: { fieldId: 'train' },
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: {
      x: { label: 'Load', scale: 'linear' },
      y: { label: 'Step yield (%)', scale: 'linear' },
    },
    series: [],
  },
  overlays: {
    errorBars: null,
    references: [{ kind: 'hline', value: 80, label: 'Target' }],
  },
}

describe('analysis charts', () => {
  it('lists the primary spec first, then the extra charts', () => {
    const extra = withYColumn(spec, columns[3])
    expect(analysisCharts({ spec, extra_charts: [extra] })).toEqual([
      spec,
      extra,
    ])
    expect(analysisCharts({ spec })).toEqual([spec])
  })

  it('titles an axis with the unit when the column has one', () => {
    expect(axisTitle(columns[2])).toBe('Step yield (%)')
    expect(axisTitle(columns[3])).toBe('Turbidity out')
    expect(chartTitle(spec)).toBe('Step yield (%)')
  })

  it('keeps only numeric columns for Y', () => {
    expect(numericColumns(columns).map((c) => c.id)).toEqual([
      'load',
      'yield',
      'ntu',
    ])
  })

  it('moves a chart to another Y column and drops the old reference lines', () => {
    const moved = withYColumn(spec, columns[3])
    expect(moved.fields.y.fieldId).toBe('ntu')
    expect(moved.display.axes.y.label).toBe('Turbidity out')
    expect(moved.overlays.references).toEqual([])
    expect(spec.overlays.references).toHaveLength(1)
  })

  it('adds a chart on the first numeric column nothing plots yet', () => {
    const next = nextChart([spec], columns)
    expect(next?.fields.y.fieldId).toBe('ntu')
    expect(nextChart([spec, next!], columns)).toBeNull()
  })
})
