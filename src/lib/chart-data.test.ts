/**
 * SCI-004 chart-data resolver unit tests. Verifies stale calculation
 * detection, live chart materialisation states (missing dataset/field,
 * empty, log-scale-invalid, stale), and frozen chart materialisation
 * directly — complementing the component-level tests in chart-block.test.tsx.
 */
import { describe, expect, it } from 'vitest'

import {
  detectStaleCalculations,
  materialiseFrozenChart,
  materialiseLiveChart,
} from './chart-data'
import type { ResolvedDataset } from './chart-data'
import type {
  FormulaResultWire,
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from './scientific-sheet-data'
import { CHART_PALETTE } from './chart-spec'
import type { ChartSpec, FrozenChart } from './chart-spec'

const TABLE_ID = '00000000-0000-4000-8000-000000000170'

function makeColumns(): ScientificColumnWire[] {
  return [
    {
      id: 'c1',
      field_name: 'col_time',
      label: 'Time (days)',
      display_order: 0,
      logical_type: 'decimal',
      nullable: true,
      unit: { symbol: 'd' },
      validation: {},
      width: null,
      options: [],
    },
    {
      id: 'c2',
      field_name: 'col_titer',
      label: 'Log titer',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: { symbol: 'log₁₀' },
      validation: {},
      width: null,
      options: [],
    },
    {
      id: 'c3',
      field_name: 'col_condition',
      label: 'Condition',
      display_order: 2,
      logical_type: 'text',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ]
}

function makeTable(): ScientificTableWire {
  return {
    id: TABLE_ID,
    resource_name: 'sheet_testrows1234567890123456',
    name: 'Stability readings (qPCR)',
    schema_version: 1,
    lifecycle: 'active',
    columns: makeColumns(),
  }
}

function makeRows(): ScientificRowWire[] {
  return [
    {
      id: 'r1',
      version: 1,
      col_time: 0,
      col_titer: 7.2,
      col_condition: '4 °C',
    },
    {
      id: 'r2',
      version: 1,
      col_time: 28,
      col_titer: 5.9,
      col_condition: '4 °C',
    },
    {
      id: 'r3',
      version: 1,
      col_time: 0,
      col_titer: 7.1,
      col_condition: '−20 °C',
    },
    {
      id: 'r4',
      version: 1,
      col_time: 28,
      col_titer: 6.4,
      col_condition: '−20 °C',
    },
  ]
}

function lineSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ tableId: TABLE_ID }],
    fields: {
      x: { columnId: 'c1', fieldName: 'col_time' },
      y: { columnId: 'c2', fieldName: 'col_titer' },
      series: { columnId: 'c3', fieldName: 'col_condition' },
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
    display: {
      axes: {
        x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
        y: { label: 'Log titer', scale: 'linear', unit: 'log₁₀' },
      },
      series: [
        { identifier: '4 °C', label: '4 °C', color: CHART_PALETTE[0] },
        { identifier: '−20 °C', label: '−20 °C', color: CHART_PALETTE[1] },
      ],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

function makeDataset(): ResolvedDataset {
  return { table: makeTable(), columns: makeColumns(), rows: makeRows() }
}

describe('detectStaleCalculations', () => {
  it('returns not stale when there are no calculation results', () => {
    const result = detectStaleCalculations([], lineSpec())
    expect(result.stale).toBe(false)
  })

  it('returns not stale when plotted columns are all current', () => {
    const results: FormulaResultWire[] = [
      {
        formula_id: 'f1',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c1',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'current',
        calculated_value: 1,
        calculation_error_code: null,
        cache_input_revision: 1,
        engine_version: '1.0',
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: '2025-01-01T00:00:00Z',
      },
      {
        formula_id: 'f2',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c2',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'current',
        calculated_value: 7.2,
        calculation_error_code: null,
        cache_input_revision: 1,
        engine_version: '1.0',
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: '2025-01-01T00:00:00Z',
      },
    ]
    const result = detectStaleCalculations(results, lineSpec())
    expect(result.stale).toBe(false)
  })

  it('returns stale when a plotted column has a stale calculation', () => {
    const results: FormulaResultWire[] = [
      {
        formula_id: 'f2',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c2',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'stale',
        calculated_value: 7.2,
        calculation_error_code: null,
        cache_input_revision: 1,
        engine_version: '1.0',
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: '2025-01-01T00:00:00Z',
      },
    ]
    const result = detectStaleCalculations(results, lineSpec())
    expect(result.stale).toBe(true)
    expect(result.detail).toContain('stale')
  })

  it('returns stale with a non-stale status label for pending/failed', () => {
    const results: FormulaResultWire[] = [
      {
        formula_id: 'f1',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c1',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'pending',
        calculated_value: null,
        calculation_error_code: null,
        cache_input_revision: null,
        engine_version: null,
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: null,
      },
    ]
    const result = detectStaleCalculations(results, lineSpec())
    expect(result.stale).toBe(true)
    expect(result.detail).toContain('pending')
  })

  it('ignores stale calculations for columns the chart does not plot', () => {
    const results: FormulaResultWire[] = [
      {
        formula_id: 'f3',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c-other',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'stale',
        calculated_value: null,
        calculation_error_code: null,
        cache_input_revision: 1,
        engine_version: '1.0',
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: '2025-01-01T00:00:00Z',
      },
    ]
    const result = detectStaleCalculations(results, lineSpec())
    expect(result.stale).toBe(false)
  })
})

describe('materialiseLiveChart', () => {
  it('returns missing_dataset when dataset is null', () => {
    const result = materialiseLiveChart(lineSpec(), null, null)
    expect(result.state.kind).toBe('missing_dataset')
    expect(result.series).toEqual([])
  })

  it('returns ok with series for a valid dataset', () => {
    const result = materialiseLiveChart(lineSpec(), makeDataset(), [])
    expect(result.state.kind).toBe('ok')
    expect(result.series.length).toBe(2)
    expect(result.rows.length).toBe(4)
  })

  it('returns missing_field when a bound column is absent from the dataset', () => {
    const spec = lineSpec({
      fields: {
        x: { columnId: 'c-missing', fieldName: 'col_missing' },
        y: { columnId: 'c2', fieldName: 'col_titer' },
        series: null,
        color: null,
        size: null,
      },
    })
    const result = materialiseLiveChart(spec, makeDataset(), [])
    expect(result.state.kind).toBe('missing_field')
  })

  it('returns empty_dataset when filters remove all rows', () => {
    const spec = lineSpec({
      filters: [
        {
          columnId: 'c1',
          fieldName: 'col_time',
          op: 'gt' as const,
          value: 999999,
        },
      ],
    })
    const result = materialiseLiveChart(spec, makeDataset(), [])
    expect(result.state.kind).toBe('empty_dataset')
  })

  it('returns log_scale_invalid when a log axis maps non-positive values', () => {
    const spec = lineSpec({
      display: {
        ...lineSpec().display,
        axes: {
          x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
          y: { label: 'Log titer', scale: 'log', unit: 'log₁₀' },
        },
      },
      fields: {
        x: { columnId: 'c1', fieldName: 'col_time' },
        y: { columnId: 'c1', fieldName: 'col_time' },
        series: null,
        color: null,
        size: null,
      },
    })
    // col_time has a 0 value, which is invalid for log scale.
    const result = materialiseLiveChart(spec, makeDataset(), [])
    expect(result.state.kind).toBe('log_scale_invalid')
  })

  it('returns stale when a plotted formula calculation is stale', () => {
    const calcResults: FormulaResultWire[] = [
      {
        formula_id: 'f2',
        target_table_id: TABLE_ID,
        target_row_id: 'r1',
        target_column_id: 'c2',
        cell_kind: 'formula',
        value_is_authoritative: false,
        definition_status: 'supported',
        formula_version: 1,
        current_input_revision: 1,
        calculation_status: 'stale',
        calculated_value: 7.2,
        calculation_error_code: null,
        cache_input_revision: 1,
        engine_version: '1.0',
        profile_fingerprint: null,
        runtime_fingerprint: null,
        calculated_at: '2025-01-01T00:00:00Z',
      },
    ]
    const result = materialiseLiveChart(lineSpec(), makeDataset(), calcResults)
    expect(result.state.kind).toBe('stale')
  })
})

describe('materialiseFrozenChart', () => {
  function makeFrozen(): FrozenChart {
    return {
      revisionId: null,
      frozenAt: '2025-07-14T10:00:00Z',
      frozenByUserId: 'u1',
      datasetProvenance: [
        {
          tableId: TABLE_ID,
          schemaVersion: 1,
          rowCount: 2,
          checksum: 'abc12345',
        },
      ],
      data: {
        columns: [
          {
            columnId: 'c1',
            fieldName: 'col_time',
            label: 'Time (days)',
            logicalType: 'decimal',
            unit: { symbol: 'd' },
          },
          {
            columnId: 'c2',
            fieldName: 'col_titer',
            label: 'Log titer',
            logicalType: 'decimal',
            unit: { symbol: 'log₁₀' },
          },
        ],
        rows: [
          { col_time: 0, col_titer: 7.2 },
          { col_time: 28, col_titer: 5.9 },
        ],
        series: [
          {
            identifier: '4 °C',
            label: '4 °C',
            color: CHART_PALETTE[0],
            points: [
              { x: 0, y: 7.2, yError: null, label: '4 °C' },
              { x: 28, y: 5.9, yError: null, label: '4 °C' },
            ],
          },
        ],
      },
    }
  }

  it('returns ok with the frozen snapshot data', () => {
    const result = materialiseFrozenChart(makeFrozen())
    expect(result.state.kind).toBe('ok')
    expect(result.series).toHaveLength(1)
    expect(result.series[0].points).toHaveLength(2)
    expect(result.rows).toHaveLength(2)
  })

  it('uses frozen column labels for axis labels', () => {
    const result = materialiseFrozenChart(makeFrozen())
    expect(result.xLabel).toBe('Time (days)')
    expect(result.yLabel).toBe('Log titer')
  })

  it('extracts unit symbols from frozen columns', () => {
    const result = materialiseFrozenChart(makeFrozen())
    expect(result.xUnit).toBe('d')
    expect(result.yUnit).toBe('log₁₀')
  })
})
