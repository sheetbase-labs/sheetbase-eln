import { describe, expect, it } from 'vitest'

import type { ChartColumn, ChartSpec } from './chart-spec'
import { rebindSpec, specFieldIds } from './analysis-rebind'

const col = (
  id: string,
  label: string,
  logicalType = 'decimal',
): ChartColumn => ({
  id,
  label,
  logicalType,
})

const spec = {
  specVersion: 1,
  type: 'scatter',
  datasets: [{ datasetId: 'ds-a' }],
  fields: {
    x: { fieldId: 'f-conc' },
    y: { fieldId: 'f-signal' },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [{ fieldId: 'f-batch', op: 'eq', value: 'B1' }],
  transformations: [],
  typeParams: {},
  display: {},
  overlays: { errorBars: null },
} as unknown as ChartSpec

const source = [
  col('f-conc', 'Concentration'),
  col('f-signal', 'Signal'),
  col('f-batch', 'Batch', 'text'),
]

describe('rebindSpec', () => {
  it('lists every bound and filtered field once', () => {
    expect(specFieldIds(spec).sort()).toEqual(['f-batch', 'f-conc', 'f-signal'])
  })

  it('keeps the fields when the target shares them', () => {
    const result = rebindSpec(spec, source, {
      datasetId: 'ds-b',
      columns: source,
    })
    expect(result.unmatched).toEqual([])
    expect(result.spec?.datasets).toEqual([{ datasetId: 'ds-b' }])
    expect(result.spec?.fields.y.fieldId).toBe('f-signal')
    expect(result.matches.every((m) => m.by === 'same')).toBe(true)
  })

  it('matches by name and type across schemas, including filters', () => {
    const target = [
      col('g-1', ' concentration '),
      col('g-2', 'SIGNAL'),
      col('g-3', 'Batch', 'text'),
    ]
    const result = rebindSpec(spec, source, {
      datasetId: 'ds-b',
      columns: target,
    })
    expect(result.spec?.fields.x?.fieldId).toBe('g-1')
    expect(result.spec?.fields.y.fieldId).toBe('g-2')
    expect(result.spec?.filters[0]?.fieldId).toBe('g-3')
    expect(result.matches.every((m) => m.by === 'label')).toBe(true)
  })

  it('refuses rather than dropping a column the target lacks', () => {
    const target = [col('g-1', 'Concentration'), col('g-3', 'Batch', 'text')]
    const result = rebindSpec(spec, source, {
      datasetId: 'ds-b',
      columns: target,
    })
    expect(result.spec).toBeNull()
    expect(result.unmatched).toEqual(['Signal'])
  })

  it('does not match a column of the same name but another type', () => {
    const target = [
      col('g-1', 'Concentration'),
      col('g-2', 'Signal', 'text'),
      col('g-3', 'Batch', 'text'),
    ]
    expect(
      rebindSpec(spec, source, { datasetId: 'ds-b', columns: target })
        .unmatched,
    ).toEqual(['Signal'])
  })
})
