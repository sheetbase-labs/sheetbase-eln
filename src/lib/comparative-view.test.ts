/**
 * VIEW-03 — comparative-view shaping + promote unit tests.
 */
import { describe, expect, it } from 'vitest'

import { validateChartSpec } from './chart-spec'
import { CHART_ROW_ID_KEY } from './visualisation-pipeline'
import {
  buildDefaultComparativeViewConfig,
  COMPARATIVE_VIEW_CONFIG_VERSION,
  groupRowsByFields,
  pairComparativeSources,
  promoteToChartSpec,
  shapeComparativeView,
  summarizeValues,
  toComparableNumber,
  validateComparativeViewConfig,
} from './comparative-view'
import type { ComparativeViewConfig } from './comparative-view'

const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const PH = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const BUFFER = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'
const BATCH = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04'

function timeSeriesConfig(
  overrides: Partial<ComparativeViewConfig> = {},
): ComparativeViewConfig {
  return {
    configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
    datasetId: DATASET_ID,
    versionId: null,
    viewType: 'time_series',
    timeField: TIME,
    valueField: PH,
    groupBy: [BUFFER],
    facetBy: null,
    ...overrides,
  }
}

function rows() {
  return [
    { [TIME]: 0, [PH]: 7.0, [BUFFER]: 'A' },
    { [TIME]: 1, [PH]: 7.2, [BUFFER]: 'A' },
    { [TIME]: 0, [PH]: 6.8, [BUFFER]: 'B' },
    { [TIME]: 1, [PH]: null, [BUFFER]: 'B' },
    { [TIME]: 2, [PH]: 'bad', [BUFFER]: null },
  ]
}

describe('toComparableNumber', () => {
  it('parses numbers and numeric strings, rejects the rest', () => {
    expect(toComparableNumber(1.5)).toBe(1.5)
    expect(toComparableNumber('2.5')).toBe(2.5)
    expect(toComparableNumber(null)).toBeNull()
    expect(toComparableNumber(undefined)).toBeNull()
    expect(toComparableNumber('bad')).toBeNull()
    expect(toComparableNumber(NaN)).toBeNull()
    expect(toComparableNumber(Infinity)).toBeNull()
  })
})

describe('summarizeValues', () => {
  it('returns null for an empty sample', () => {
    expect(summarizeValues([])).toBeNull()
  })

  it('summarises odd and even samples deterministically', () => {
    expect(summarizeValues([3, 1, 2])).toEqual({
      n: 3,
      min: 1,
      max: 3,
      mean: 2,
      median: 2,
    })
    expect(summarizeValues([4, 1, 3, 2])).toEqual({
      n: 4,
      min: 1,
      max: 4,
      mean: 2.5,
      median: 2.5,
    })
  })
})

describe('groupRowsByFields', () => {
  it('groups strictly by explicit field IDs in deterministic order', () => {
    const grouped = groupRowsByFields(rows(), [BUFFER])
    // Order follows the deterministic JSON keys (quoted values sort before
    // the null sentinel), not the display labels.
    expect(grouped.map((g) => g.label)).toEqual(['A', 'B', '(missing)'])
    expect(grouped.find((g) => g.label === 'A')?.rowIndexes).toEqual([0, 1])
  })

  it('composes multi-field keys without label inference', () => {
    const grouped = groupRowsByFields(rows(), [BUFFER, TIME])
    // The null-buffer row forms its own key even though TIME matches others.
    expect(grouped).toHaveLength(5)
    const keys = grouped.map((g) => g.key)
    expect(keys).toEqual([...keys].sort())
  })

  it('reads unknown field IDs as missing on every row', () => {
    const grouped = groupRowsByFields(rows(), ['no-such-field'])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].label).toBe('(missing)')
    expect(grouped[0].rowIndexes).toEqual([0, 1, 2, 3, 4])
  })
})

describe('shapeComparativeView', () => {
  it('shapes groups with statistics and honest null counts', () => {
    const shaped = shapeComparativeView(rows(), timeSeriesConfig())
    expect(shaped.totalRows).toBe(5)
    expect(shaped.droppedNullValues).toBe(2)
    const a = shaped.groups.find((g) => g.label === 'A')
    const b = shaped.groups.find((g) => g.label === 'B')
    expect(a?.stats).toMatchObject({ n: 2, min: 7.0, max: 7.2 })
    expect(a?.stats?.mean).toBeCloseTo(7.1)
    expect(a?.nullCount).toBe(0)
    // Null pH is counted, never averaged into the group.
    expect(b?.count).toBe(2)
    expect(b?.nullCount).toBe(1)
    expect(b?.stats).toMatchObject({ n: 1, min: 6.8, max: 6.8 })
    // Non-numeric pH lands in the missing group as a null, not a zero.
    const missing = shaped.groups.find((g) => g.label === '(missing)')
    expect(missing?.count).toBe(1)
    expect(missing?.nullCount).toBe(1)
    expect(missing?.stats).toBeNull()
    expect(missing?.values).toEqual([])
  })

  it('emits expected-but-absent groups as empty instead of dropping them', () => {
    const shaped = shapeComparativeView(rows(), timeSeriesConfig(), {
      expectedKeys: [{ key: JSON.stringify(['C']), label: 'C' }],
    })
    expect(shaped.emptyGroupKeys).toEqual([JSON.stringify(['C'])])
    const empty = shaped.groups.find((g) => g.label === 'C')
    expect(empty).toMatchObject({ count: 0, nullCount: 0, stats: null })
  })

  it('assigns explicit facet values and nulls mixed facets', () => {
    const withBatch = rows().map((row, i) => ({
      ...row,
      [BATCH]: i < 2 ? 'batch-1' : 'batch-2',
    }))
    const shaped = shapeComparativeView(
      withBatch,
      timeSeriesConfig({ facetBy: BATCH }),
    )
    const a = shaped.groups.find((g) => g.label === 'A')
    expect(a?.facet).toBe('batch-1')
    // Group B spans both batches after row 4 joins it... rows 2,3 are
    // batch-2, so B is uniform batch-2 here; mix facet across one group:
    const mixed = shapeComparativeView(
      withBatch,
      timeSeriesConfig({ facetBy: TIME }),
    )
    // TIME varies within group A (0 and 1) → facet must not pick one.
    expect(mixed.groups.find((g) => g.label === 'A')?.facet).toBeNull()
  })
})

describe('validateComparativeViewConfig', () => {
  it('accepts a complete config', () => {
    expect(validateComparativeViewConfig(timeSeriesConfig())).toEqual([])
  })

  it('rejects missing time, value and grouping fields', () => {
    expect(
      validateComparativeViewConfig(timeSeriesConfig({ timeField: null })),
    ).toContain('config.timeField is required for time_series views')
    expect(
      validateComparativeViewConfig(timeSeriesConfig({ valueField: '' })),
    ).toContain('config.valueField is required')
    expect(
      validateComparativeViewConfig(timeSeriesConfig({ groupBy: [] })),
    ).toContain('config.groupBy must list at least one explicit field')
  })

  it('rejects unknown view types and facet/groupBy duplication', () => {
    expect(
      validateComparativeViewConfig(
        timeSeriesConfig({ viewType: 'heatmap' as never }),
      ),
    ).toContain('config.viewType must be one of time_series, distribution')
    expect(
      validateComparativeViewConfig(timeSeriesConfig({ facetBy: BUFFER })),
    ).toContain('config.facetBy must not duplicate a groupBy field')
    expect(
      validateComparativeViewConfig(
        timeSeriesConfig({ groupBy: [BUFFER, BUFFER] }),
      ),
    ).toContain(`config.groupBy duplicates ${BUFFER}`)
  })

  it('does not require a time field for distribution views', () => {
    expect(
      validateComparativeViewConfig(
        timeSeriesConfig({ viewType: 'distribution', timeField: null }),
      ),
    ).toEqual([])
  })
})

describe('promoteToChartSpec', () => {
  it('maps time_series to a valid line ChartSpec', () => {
    const spec = promoteToChartSpec(timeSeriesConfig())
    expect(spec.type).toBe('line')
    expect(spec.fields.x).toEqual({ fieldId: TIME })
    expect(spec.fields.y).toEqual({ fieldId: PH })
    expect(spec.fields.series).toEqual({ fieldId: BUFFER })
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('maps distribution to a valid box ChartSpec with facet', () => {
    const spec = promoteToChartSpec(
      timeSeriesConfig({
        viewType: 'distribution',
        timeField: null,
        facetBy: BATCH,
      }),
    )
    expect(spec.type).toBe('box')
    expect(spec.fields.x).toBeNull()
    expect(spec.fields.y).toEqual({ fieldId: PH })
    expect(spec.fields.series).toEqual({ fieldId: BUFFER })
    expect(spec.fields.facet).toEqual({ fieldId: BATCH })
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('throws fail-closed on an invalid config', () => {
    expect(() => promoteToChartSpec(timeSeriesConfig({ groupBy: [] }))).toThrow(
      /groupBy/,
    )
  })
})

describe('buildDefaultComparativeViewConfig', () => {
  const columns = [
    { id: TIME, logicalType: 'decimal' },
    { id: PH, logicalType: 'decimal' },
    { id: BUFFER, logicalType: 'category' },
  ]

  it('derives measure, time and grouping from explicit columns', () => {
    const config = buildDefaultComparativeViewConfig({
      datasetId: DATASET_ID,
      columns,
    })
    expect(config).toMatchObject({
      datasetId: DATASET_ID,
      versionId: null,
      viewType: 'time_series',
      timeField: PH,
      valueField: TIME,
      groupBy: [BUFFER],
      facetBy: null,
    })
    expect(validateChartSpec(promoteToChartSpec(config!))).toEqual([])
  })

  it('returns null without a numeric measure or grouping field', () => {
    expect(
      buildDefaultComparativeViewConfig({
        datasetId: DATASET_ID,
        columns: [{ id: BUFFER, logicalType: 'category' }],
      }),
    ).toBeNull()
    expect(
      buildDefaultComparativeViewConfig({
        datasetId: DATASET_ID,
        columns: [{ id: TIME, logicalType: 'decimal' }],
      }),
    ).toBeNull()
  })
})

describe('pairComparativeSources', () => {
  const row = (id: string, values: Record<string, unknown>) => ({
    [CHART_ROW_ID_KEY]: id,
    ...values,
  })

  it('pairs a snapshot with its live rows by row key and reports the change', () => {
    const snapshot = [row('r1', { c2: 1 }), row('r2', { c2: 2 })]
    const live = [
      row('r1', { c2: 1 }),
      row('r2', { c2: 5 }),
      row('r3', { c2: 9 }),
    ]
    const pairing = pairComparativeSources(
      { rows: snapshot, valueField: 'c2', matchField: null },
      { rows: live, valueField: 'c2', matchField: null },
      'row_key',
    )
    expect(pairing.matchedCount).toBe(2)
    expect(pairing.onlyBCount).toBe(1)
    expect(pairing.changedCount).toBe(1)
    expect(pairing.rows.find((r) => r.key === 'r2')?.delta).toBe(3)
  })

  it('uses each side’s own value and match field across two datasets', () => {
    const pairing = pairComparativeSources(
      {
        rows: [
          { sample: 'S1', a: 10 },
          { sample: 'S2', a: 20 },
        ],
        valueField: 'a',
        matchField: 'sample',
      },
      {
        rows: [
          { id: 'S2', b: 25 },
          { id: 'S3', b: 1 },
        ],
        valueField: 'b',
        matchField: 'id',
      },
      'field',
      'Sample',
    )
    expect(pairing.rows.map((r) => [r.key, r.presence, r.delta])).toEqual([
      ['S1', 'a-only', null],
      ['S2', 'both', 5],
      ['S3', 'b-only', null],
    ])
    expect(pairing.rule).toContain('Sample')
  })
})
