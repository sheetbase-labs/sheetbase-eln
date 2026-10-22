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
  resolveDatasetRef,
} from './chart-data'
import type { CanonicalDatasetSource, ResolvedDataset } from './chart-data'
import { CHART_PALETTE } from './chart-spec'
import type { ChartSpec, FrozenChart } from './chart-spec'
import type { DataClient } from './data-client'
import { runAnalysis } from './analysis-definition'

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
  datasetRevision: number
}

/**
 * Mock a DataClient whose `query_dataset_rows` (or any paged rows RPC)
 * serves `total` rows of 1000-per-call pages, recording every call.
 */
function pagedRowsClient(
  total: number,
  revisionAtOffset = (_offset: number) => 1,
): {
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
        datasetRevision: revisionAtOffset(offset),
      } satisfies RowPage
    },
  } as unknown as DataClient
  return { client, calls }
}

describe('fetchDatasetRows', () => {
  it('rejects same-size pages from different live revisions', async () => {
    const { client } = pagedRowsClient(1500, (offset) => (offset === 0 ? 7 : 8))
    await expect(fetchDatasetRows(client, DATASET_ID)).rejects.toThrow(
      /changed/i,
    )
  })

  it.each([10_000, 10_001, 20_160, 100_000])(
    'analyses and reconstructs all %i rows, sampling only display marks',
    async (count) => {
      const { client } = pagedRowsClient(count)
      const live = await fetchDatasetRows(client, DATASET_ID)
      const frozen = await fetchFrozenAnalysisRows(client, 'ver-1', count)
      expect(live.truncated).toBe(false)
      expect(frozen.matchesProvenance).toBe(true)
      expect(frozen.rows).toEqual(live.rows)
      const rows = live.rows.map((row) => ({
        ...row,
        c1: row.n,
        c2: 3 * Number(row.n) + 7,
      }))
      const chart = materialiseLiveChart(
        lineSpec({
          fields: {
            ...lineSpec().fields,
            x: { fieldId: 'c1' },
            y: { fieldId: 'c2' },
            series: null,
          },
          overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
        }),
        { source: makeSource(), rows, totalCount: count, truncated: false },
      )
      expect(chart.state.kind).toBe('ok')
      expect(chart.fit?.n).toBe(count)
      expect(chart.fit?.coefficients[0]).toBeCloseTo(7, 5)
      expect(chart.fit?.coefficients[1]).toBeCloseTo(3, 8)
      expect(chart.sampling?.analysisCount).toBe(count)
      expect(chart.sampling?.sampledCount).toBeLessThanOrEqual(4000)
      const analysis = runAnalysis(
        {
          definitionVersion: 1,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET_ID }],
          value: { fieldId: 'c2' },
        },
        makeSource().columns,
        rows,
      )
      expect(analysis.ok).toBe(true)
      if (analysis.ok && analysis.result.kind === 'descriptive') {
        expect(analysis.result.rows[0].stats.n).toBe(count)
        expect(analysis.result.rows[0].stats.mean).toBe(
          (3 * (count + 1)) / 2 + 7,
        )
      }
      // A tail-only filter must run before the fit and before display sampling.
      const filtered = materialiseLiveChart(
        lineSpec({
          fields: {
            ...lineSpec().fields,
            x: { fieldId: 'c1' },
            y: { fieldId: 'c2' },
            series: null,
          },
          filters: [{ fieldId: 'c1', op: 'gt', value: count - 9000 }],
          overlays: { errorBars: null, fit: { method: 'ols', degree: 1 } },
        }),
        { source: makeSource(), rows, totalCount: count, truncated: false },
      )
      expect(filtered.fit?.n).toBe(9000)
      expect(filtered.rows[0].c1).toBe(count - 8999)
      expect(filtered.sampling?.analysisCount).toBe(9000)
    },
  )

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
    const { client, calls } = pagedRowsClient(100_001)
    const result = await fetchDatasetRows(client, DATASET_ID)
    expect(result.truncated).toBe(true)
    expect(result.totalCount).toBe(100_001)
    expect(result.rows).toHaveLength(SCI_ANALYSIS_ROW_LIMIT)
    expect(calls).toHaveLength(100)
    expect(calls[99].p_offset).toBe(99_000)
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

describe('resolveDatasetRef on live data', () => {
  it.each(['unchanged', 'schema', 'flags'])(
    'accepts only a coherent population when %s is read around the rows',
    async (change) => {
      let metadataReads = 0
      let flagReads = 0
      const { client: pages } = pagedRowsClient(1)
      const client = {
        rpc: pages.rpc,
        list: async (table: string) => {
          if (table === 'datasets') {
            metadataReads++
            return [
              {
                id: DATASET_ID,
                workspace_id: 'ws-1',
                name: 'Live measurements',
                lifecycle: 'active',
                revision: 1,
                schema_version_id:
                  change === 'schema' && metadataReads > 1 ? 'sv-2' : 'sv-1',
              },
            ]
          }
          if (table === 'dataset_schema_versions')
            return [{ id: 'sv-1', version: 1 }]
          if (table === 'dataset_schema_version_fields')
            return [
              {
                field_id: 'n',
                label: 'Value',
                logical_type: 'decimal',
                quantity: null,
              },
            ]
          if (table === 'dataset_value_flags') {
            flagReads++
            return change === 'flags' && flagReads > 1
              ? [
                  {
                    id: 'flag-1',
                    dataset_id: DATASET_ID,
                    row_id: 'r1',
                    field_id: 'n',
                    kind: 'high_cv',
                    source: 'manual',
                    reason: 'Replicate disagreement',
                    comment: null,
                    set_at: '2026-10-22T12:00:00Z',
                  },
                ]
              : []
          }
          throw new Error(`Unexpected resource ${table}`)
        },
      } as unknown as DataClient
      const result = resolveDatasetRef(client, { datasetId: DATASET_ID })
      if (change === 'unchanged') {
        await expect(result).resolves.toMatchObject({
          source: { revision: 1, schemaVersionId: 'sv-1' },
          rows: [{ n: 1, __sheetbaseRowId: 'r1' }],
          flags: [],
        })
      } else {
        await expect(result).rejects.toThrow(/changed/i)
      }
    },
  )
})

describe('resolveDatasetRef on a snapshot', () => {
  it('reads the snapshot rows, not the live rows, and carries no live flags', async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      list: async (table: string) =>
        table === 'datasets'
          ? [
              {
                id: DATASET_ID,
                workspace_id: 'ws-1',
                schema_version_id: 'sv-1',
                name: 'Stability readings',
                lifecycle: 'active',
                revision: 4,
              },
            ]
          : table === 'dataset_versions'
            ? [
                {
                  id: 'ver-9',
                  dataset_id: DATASET_ID,
                  schema_version_id: 'sv-old',
                  source_dataset_revision: 2,
                },
              ]
            : table === 'dataset_schema_versions'
              ? [{ id: 'sv-old', version: 1 }]
              : [
                  {
                    field_id: 'c2',
                    label: 'Original titer',
                    logical_type: 'decimal',
                    quantity: { symbol: 'mg/L' },
                  },
                ],
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        return {
          rows: [{ rowId: 'r1', revision: 1, values: { c1: 0, c2: 7.2 } }],
          totalCount: 1,
        }
      },
    } as unknown as DataClient

    const resolved = await resolveDatasetRef(client, {
      datasetId: DATASET_ID,
      datasetVersionId: 'ver-9',
    })

    expect(resolved?.rows).toEqual([{ c1: 0, c2: 7.2, __sheetbaseRowId: 'r1' }])
    expect(resolved?.flags).toEqual([])
    expect(resolved?.source.schemaVersionId).toBe('sv-old')
    expect(resolved?.source.revision).toBe(2)
    expect(resolved?.source.columns[0]).toEqual({
      id: 'c2',
      label: 'Original titer',
      logicalType: 'decimal',
      unit: { symbol: 'mg/L' },
    })
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'query_dataset_version_rows',
    ])
    expect(rpcCalls[0].args.p_dataset_version_id).toBe('ver-9')
  })

  it('is null when the dataset is gone, whatever the snapshot', async () => {
    const client = { list: async () => [] } as unknown as DataClient
    expect(
      await resolveDatasetRef(client, {
        datasetId: DATASET_ID,
        datasetVersionId: 'ver-9',
      }),
    ).toBeNull()
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

describe('flagged-value exclusion (DSET-01.2)', () => {
  it('drops a row whose charted field is flagged', () => {
    const dataset: ResolvedDataset = {
      ...makeDataset(),
      rows: [
        { c1: 0, c2: 7.2, c3: '4 °C', __sheetbaseRowId: 'r1' },
        { c1: 28, c2: 5.9, c3: '4 °C', __sheetbaseRowId: 'r2' },
      ],
      flags: [
        {
          id: 'f1',
          datasetId: DATASET_ID,
          rowId: 'r2',
          fieldId: 'c2',
          kind: 'out_of_range',
          reason: 'Above top standard',
          comment: null,
          setAt: '2026-09-25T09:40:00Z',
        },
      ],
    }
    const result = materialiseLiveChart(lineSpec(), dataset)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].c2).toBe(7.2)
  })
})
