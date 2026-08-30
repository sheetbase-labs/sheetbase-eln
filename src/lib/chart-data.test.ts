/**
 * SCI chart-data resolver unit tests. Verifies canonical Dataset resolution
 * (paged query_dataset_rows reads up to the client-side ceiling), the live
 * and frozen materialisation paths, and frozen-facet reconstruction. Rows
 * come back keyed by stable schema-version fieldId, so runtime row keys are
 * exactly the ChartColumn.id values specs bind to.
 */
import { describe, expect, it } from 'vitest'

import {
  SCI_ANALYSIS_ROW_LIMIT,
  fetchDatasetRows,
  fetchFrozenAnalysisRows,
  materialiseFrozenChart,
  materialiseFrozenFacets,
  materialiseLiveChart,
} from './chart-data'
import type { CanonicalDatasetSource, ResolvedDataset } from './chart-data'
import { CHART_PALETTE } from './chart-spec'
import type { ChartSpec, FrozenChart } from './chart-spec'
import type { DataClient } from './data-client'

const DATASET_ID = '00000000-0000-4000-8000-000000000170'

function makeSource(): CanonicalDatasetSource {
  return {
    datasetId: DATASET_ID,
    name: 'Stability readings (qPCR)',
    workspaceId: 'ws-1',
    schemaVersionId: 'sv-1',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [
      {
        id: 'c1',
        label: 'Time (days)',
        logicalType: 'decimal',
        unit: { symbol: 'd' },
      },
      {
        id: 'c2',
        label: 'Log titer',
        logicalType: 'decimal',
        unit: { symbol: 'log₁₀' },
      },
      {
        id: 'c3',
        label: 'Condition',
        logicalType: 'text',
      },
    ],
  }
}

// Runtime rows are keyed by the stable schema-version fieldId.
function makeRows(): Record<string, unknown>[] {
  return [
    { c1: 0, c2: 7.2, c3: '4 °C' },
    { c1: 28, c2: 5.9, c3: '4 °C' },
    { c1: 0, c2: 7.1, c3: '−20 °C' },
    { c1: 28, c2: 6.4, c3: '−20 °C' },
  ]
}

function lineSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId: DATASET_ID }],
    fields: {
      x: { fieldId: 'c1' },
      y: { fieldId: 'c2' },
      series: { fieldId: 'c3' },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
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
  return {
    source: makeSource(),
    rows: makeRows(),
    truncated: false,
    totalCount: 4,
  }
}

/** Wire page for query_dataset_rows / query_dataset_version_rows. */
interface RowPage {
  rows: Array<{
    rowId: string
    revision: number
    values: Record<string, unknown>
  }>
  totalCount: number
}

/**
 * Mock a DataClient whose `query_dataset_rows` (or any paged rows RPC)
 * serves `total` rows of 1000-per-call pages, recording every call.
 */
function pagedRowsClient(total: number): {
  client: DataClient
  calls: Array<Record<string, unknown>>
} {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args)
      const offset = args.p_offset as number
      const limit = args.p_limit as number
      const count = Math.max(0, Math.min(limit, total - offset))
      return {
        rows: Array.from({ length: count }, (_, i) => ({
          rowId: `r${offset + i + 1}`,
          revision: 1,
          values: { n: offset + i + 1 },
        })),
        totalCount: total,
      } satisfies RowPage
    },
  } as unknown as DataClient
  return { client, calls }
}

describe('fetchDatasetRows', () => {
  it('pages through query_dataset_rows until the authoritative total is loaded', async () => {
    const { client, calls } = pagedRowsClient(2500)
    const result = await fetchDatasetRows(client, DATASET_ID)
    expect(result.truncated).toBe(false)
    expect(result.totalCount).toBe(2500)
    expect(result.rows).toHaveLength(2500)
    // Rows arrive flattened to fieldId-keyed value objects, with Dataset row
    // identity attached for point inspection.
    expect(result.rows[0]).toEqual({ n: 1, __sheetbaseRowId: 'r1' })
    expect(result.rows[2499]).toEqual({ n: 2500, __sheetbaseRowId: 'r2500' })
    expect(calls.map((c) => [c.p_offset, c.p_limit])).toEqual([
      [0, 1000],
      [1000, 1000],
      [2000, 1000],
    ])
    for (const call of calls) {
      expect(call.p_dataset_id).toBe(DATASET_ID)
      expect(call.p_query).toEqual({})
    }
  })

  it('loads the full analysis envelope between 5k and 10k rows', async () => {
    const { client, calls } = pagedRowsClient(5200)
    const result = await fetchDatasetRows(client, DATASET_ID)
    expect(result.truncated).toBe(false)
    expect(result.totalCount).toBe(5200)
    expect(result.rows).toHaveLength(5200)
    expect(calls).toHaveLength(6)
    expect(calls[5].p_offset).toBe(5000)
  })

  it('stops at the hard ceiling and flags truncation above it', async () => {
    const { client, calls } = pagedRowsClient(15_000)
    const result = await fetchDatasetRows(client, DATASET_ID)
    expect(result.truncated).toBe(true)
    expect(result.totalCount).toBe(15_000)
    expect(result.rows).toHaveLength(SCI_ANALYSIS_ROW_LIMIT)
    expect(calls).toHaveLength(10)
    expect(calls[9].p_offset).toBe(9000)
  })

  it('returns a single page without follow-ups under the page size', async () => {
    const { client, calls } = pagedRowsClient(42)
    const result = await fetchDatasetRows(client, DATASET_ID)
    expect(result.rows).toHaveLength(42)
    expect(result.truncated).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe('fetchFrozenAnalysisRows', () => {
  it('pages Version rows and verifies the pinned row count', async () => {
    const { client, calls } = pagedRowsClient(1500)
    const result = await fetchFrozenAnalysisRows(client, 'ver-1', 1500)
    expect(result.matchesProvenance).toBe(true)
    expect(result.totalCount).toBe(1500)
    expect(result.rows).toHaveLength(1500)
    expect(calls.length).toBeGreaterThan(1)
    for (const call of calls) {
      expect(call.p_dataset_version_id).toBe('ver-1')
    }
  })

  it('reports a provenance mismatch when the Version diverged', async () => {
    const { client } = pagedRowsClient(7)
    const result = await fetchFrozenAnalysisRows(client, 'ver-1', 3)
    expect(result.matchesProvenance).toBe(false)
    expect(result.totalCount).toBe(7)
  })

  it('refuses to reconstruct above the hard ceiling', async () => {
    const { client } = pagedRowsClient(SCI_ANALYSIS_ROW_LIMIT + 1)
    await expect(
      fetchFrozenAnalysisRows(client, 'ver-1', SCI_ANALYSIS_ROW_LIMIT + 1),
    ).rejects.toThrow(/ceiling/)
  })
})

describe('materialiseLiveChart', () => {
  it('returns missing_dataset when the resolved dataset is null', () => {
    const result = materialiseLiveChart(lineSpec(), null)
    expect(result.state.kind).toBe('missing_dataset')
    expect(result.series).toEqual([])
  })

  it('returns ok with series for a valid dataset', () => {
    const result = materialiseLiveChart(lineSpec(), makeDataset())
    expect(result.state.kind).toBe('ok')
    expect(result.series).toHaveLength(2)
    expect(result.rows).toHaveLength(4)
  })

  it('returns missing_field when a bound field is absent from the dataset', () => {
    const spec = lineSpec({
      fields: {
        x: { fieldId: 'c-missing' },
        y: { fieldId: 'c2' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
    })
    const result = materialiseLiveChart(spec, makeDataset())
    expect(result.state.kind).toBe('missing_field')
  })

  it('returns empty_dataset when filters remove all rows', () => {
    const spec = lineSpec({
      filters: [{ fieldId: 'c1', op: 'gt' as const, value: 999999 }],
    })
    const result = materialiseLiveChart(spec, makeDataset())
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
        x: { fieldId: 'c1' },
        y: { fieldId: 'c1' },
        series: null,
        color: null,
        size: null,
        facet: null,
      },
    })
    // Time has a 0 value, which is invalid for a log scale.
    const result = materialiseLiveChart(spec, makeDataset())
    expect(result.state.kind).toBe('log_scale_invalid')
  })

  it('returns dataset_too_large when the source exceeded the ceiling', () => {
    const dataset = { ...makeDataset(), truncated: true, totalCount: 15_000 }
    const result = materialiseLiveChart(lineSpec(), dataset)
    expect(result.state.kind).toBe('dataset_too_large')
    if (result.state.kind === 'dataset_too_large') {
      expect(result.state.rowCount).toBe(15_000)
      expect(result.state.limit).toBe(SCI_ANALYSIS_ROW_LIMIT)
    }
    expect(result.series).toEqual([])
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
          datasetId: DATASET_ID,
          schemaVersionNumber: 1,
          rowCount: 2,
          checksum: 'abc12345',
        },
      ],
      data: {
        columns: [
          {
            fieldId: 'c1',
            label: 'Time (days)',
            logicalType: 'decimal',
            unit: { symbol: 'd' },
          },
          {
            fieldId: 'c2',
            label: 'Log titer',
            logicalType: 'decimal',
            unit: { symbol: 'log₁₀' },
          },
        ],
        rows: [
          { c1: 0, c2: 7.2 },
          { c1: 28, c2: 5.9 },
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

describe('materialiseFrozenFacets', () => {
  const frozenWithFacets: FrozenChart = {
    revisionId: null,
    frozenAt: '2026-08-23T10:00:00Z',
    frozenByUserId: 'user-1',
    datasetProvenance: [],
    data: {
      columns: [
        {
          fieldId: 'c1',
          label: 'Time',
          logicalType: 'integer',
        },
      ],
      rows: [{ c1: 1 }],
      series: [],
      facets: [
        {
          value: '20C',
          series: [
            {
              identifier: 'all',
              label: 'all',
              color: '#006edc',
              points: [{ x: 0, y: 1, yError: null }],
            },
          ],
        },
        {
          value: '4C',
          series: [
            {
              identifier: 'all',
              label: 'all',
              color: '#00a659',
              points: [{ x: 0, y: 2, yError: null }],
            },
          ],
        },
      ],
      facetsTotal: 5,
    },
  }

  it('maps pinned facet series into renderable panels with an honest total', () => {
    const result = materialiseFrozenFacets(frozenWithFacets)
    expect(result).not.toBeNull()
    expect(result!.total).toBe(5)
    expect(result!.panels.map((p) => p.value)).toEqual(['20C', '4C'])
    for (const panel of result!.panels) {
      expect(panel.chart.state.kind).toBe('ok')
      expect(panel.chart.series).toHaveLength(1)
    }
  })

  it('returns null for non-faceted snapshots', () => {
    const plain: FrozenChart = {
      ...frozenWithFacets,
      data: {
        ...frozenWithFacets.data,
        facets: undefined,
      },
    }
    expect(materialiseFrozenFacets(plain)).toBeNull()
  })
})
