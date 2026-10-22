/**
 * SCI-03 analysis block preview tests. A frozen block reconstructs evidence
 * from the pinned immutable Dataset Version (no live reads, no embedded
 * rows); a live block loads the saved definition and canonical Dataset rows
 * through the mocked data layer. No PostgREST required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import type { FrozenAnalysis } from '#/lib/analysis-block'
import type * as definitionsData from '#/lib/analysis-definitions-data'
import { fetchAnalysisDefinition } from '#/lib/analysis-definitions-data'
import type * as chartData from '#/lib/chart-data'
import { fetchFrozenAnalysisRows } from '#/lib/chart-data'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('#/components/viz/chart-renderer', () => ({
  ChartRenderer: ({
    materialised,
  }: {
    materialised: { rows: unknown[]; series: unknown[] }
  }) => (
    <div data-testid="chart">{`${materialised.rows.length} rows plotted`}</div>
  ),
}))

vi.mock('#/lib/analysis-definitions-data', async (importOriginal) => {
  const actual = await importOriginal<typeof definitionsData>()
  return {
    ...actual,
    fetchAnalysisDefinition: vi.fn(),
  }
})
vi.mock('#/lib/chart-data', async (importOriginal) => {
  const actual = await importOriginal<typeof chartData>()
  return {
    ...actual,
    sciDataClient: {} as never,
    resolveDatasetRef: vi.fn(),
    fetchCanonicalDataset: vi.fn(),
    fetchDatasetRows: vi.fn(),
    fetchFrozenAnalysisRows: vi.fn(),
  }
})

const mockFetchDefinition = vi.mocked(fetchAnalysisDefinition)
const mockFetchFrozenRows = vi.mocked(fetchFrozenAnalysisRows)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function renderPreview(payload: unknown) {
  render(
    <BlockPreview block={{ id: 'b1', type: 'analysis', payload } as never} />,
    { wrapper: wrapper() },
  )
}

const FIELD_RECOVERY = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'

const FROZEN: FrozenAnalysis = {
  revisionId: null,
  frozenAt: '2026-08-23T10:00:00Z',
  frozenByUserId: 'user-1',
  definition: {
    definitionVersion: 1,
    kind: 'descriptive',
    datasets: [{ datasetId: '11111111-1111-1111-8111-111111111111' }],
    value: { fieldId: FIELD_RECOVERY },
    group: null,
  },
  definitionName: 'Recovery summary',
  definitionVersion: 2,
  columns: [
    {
      fieldId: FIELD_RECOVERY,
      label: 'Recovery (%)',
      logicalType: 'decimal',
    },
  ],
  datasetProvenance: [
    {
      datasetId: '11111111-1111-1111-8111-111111111111',
      datasetVersionId: '22222222-2222-4222-8222-222222222222',
      schemaVersionNumber: 3,
      sourceDatasetRevision: 7,
      rowCount: 2,
      checksum: 'deadbeefdeadbeefdeadbeefdeadbeef',
    },
  ],
}

describe('analysis block preview', () => {
  it('uses bound-field flags for frozen statistics, not flags on unrelated fields', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      rows: [
        { [FIELD_RECOVERY]: 1, __sheetbaseRowId: 'r1' },
        { [FIELD_RECOVERY]: 3, __sheetbaseRowId: 'r2' },
        { [FIELD_RECOVERY]: 100, __sheetbaseRowId: 'r3' },
      ],
      totalCount: 3,
      matchesProvenance: true,
      flags: [
        {
          id: 'f1',
          datasetId: 'ds',
          rowId: 'r3',
          fieldId: FIELD_RECOVERY,
          kind: 'out_of_range',
          reason: 'Rejected outlier',
          comment: null,
          setAt: '',
        },
        {
          id: 'f2',
          datasetId: 'ds',
          rowId: 'r1',
          fieldId: 'unrelated',
          kind: 'out_of_range',
          reason: 'Other measurement',
          comment: null,
          setAt: '',
        },
      ],
    })
    renderPreview({
      title: 'Recovery',
      definitionId: 'def-1',
      frozen: { ...FROZEN, exclusionPolicy: 'exclude_bound_fields' },
    })
    const table = await screen.findByRole('table')
    expect(screen.getByText(/1 row.*excluded/)).toBeTruthy()
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole(
      'cell',
    )
    expect(cells[1].textContent).toBe('2') // n
    expect(cells[3].textContent).toBe('2') // mean, not 34.7 or 3
  })

  it('reconstructs the frozen result from the pinned Dataset Version', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [{ [FIELD_RECOVERY]: 10 }, { [FIELD_RECOVERY]: 30 }],
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({ title: 'Recovery', definitionId: 'def-1', frozen: FROZEN })
    expect(screen.getByText(/Frozen snapshot/i)).toBeTruthy()
    // Pinned descriptive statistics for [10, 30]: mean 20, median 20.
    await screen.findByRole('table')
    expect(screen.getAllByText('20').length).toBeGreaterThan(0)
    expect(screen.getByText(/deadbeef/)).toBeTruthy()
    expect(mockFetchDefinition).not.toHaveBeenCalled()
  })

  it('surfaces an honest mismatch when provenance diverges', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [],
      totalCount: 5,
      matchesProvenance: false,
    })
    renderPreview({ title: 'Mismatch', definitionId: 'def-1', frozen: FROZEN })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Evidence mismatch/i)).toBeTruthy()
  })

  it('withholds the numbers when the recorded method version differs', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [{ [FIELD_RECOVERY]: 10 }, { [FIELD_RECOVERY]: 30 }],
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({
      title: 'Method moved on',
      definitionId: 'def-1',
      frozen: { ...FROZEN, methodVersion: 99 },
    })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Method mismatch/i)).toBeTruthy()
    expect(screen.getByText(/method v99/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('names the method on a frozen reconstruction and notes a legacy snapshot', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [{ [FIELD_RECOVERY]: 10 }, { [FIELD_RECOVERY]: 30 }],
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({ title: 'Recovery', definitionId: 'def-1', frozen: FROZEN })
    expect(await screen.findByText('Descriptive statistics')).toBeTruthy()
    expect(screen.getByText('method v1')).toBeTruthy()
    expect(screen.getByText(/predates method recording/)).toBeTruthy()
  })

  it('renders a live block by loading the saved definition and dataset rows', async () => {
    mockFetchDefinition.mockResolvedValue({
      id: 'def-1',
      workspace_id: 'ws',
      owner_user_id: 'user-1',
      name: 'Recovery summary',
      version: 5,
      definition: FROZEN.definition,
      source_revisions: [],
      created_at: '',
      updated_at: '',
    })
    const { resolveDatasetRef } = await import('#/lib/chart-data')
    vi.mocked(resolveDatasetRef).mockResolvedValue({
      source: {
        datasetId: '11111111-1111-1111-8111-111111111111',
        name: 'Stability',
        workspaceId: 'ws',
        schemaVersionId: 'sv-1',
        schemaVersionNumber: 3,
        revision: 1,
        columns: [
          {
            id: FIELD_RECOVERY,
            label: 'Recovery (%)',
            logicalType: 'decimal',
          },
        ],
      },
      rows: [{ [FIELD_RECOVERY]: 100 }, { [FIELD_RECOVERY]: 300 }],
      totalCount: 2,
      truncated: false,
    })

    renderPreview({ title: 'Recovery', definitionId: 'def-1' })
    await waitFor(() =>
      expect(screen.getByText(/Recovery summary · v5/)).toBeTruthy(),
    )
    await screen.findByRole('table')
    expect(screen.getByText('mean')).toBeTruthy()
  })

  it('surfaces an honest state when the referenced definition is gone', async () => {
    mockFetchDefinition.mockResolvedValue(null)
    renderPreview({ title: 'Gone', definitionId: 'deleted-def' })
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('prompts configuration for an empty draft', () => {
    renderPreview({})
    expect(screen.getByText(/No analysis configured/i)).toBeTruthy()
  })

  it('exposes the pinned Dataset affordance on a frozen block (NOTE-03)', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [{ [FIELD_RECOVERY]: 10 }],
      totalCount: 1,
      matchesProvenance: true,
    })
    renderPreview({ title: 'Recovery', definitionId: 'def-1', frozen: FROZEN })
    const open = await screen.findByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent('11111111-1111-1111-8111-111111111111')}`,
    )
  })

  it('exposes the canonical Dataset affordance on a live block (NOTE-03)', async () => {
    mockFetchDefinition.mockResolvedValue({
      id: 'def-1',
      workspace_id: 'ws',
      owner_user_id: 'user-1',
      name: 'Recovery summary',
      version: 5,
      definition: FROZEN.definition,
      source_revisions: [],
      created_at: '',
      updated_at: '',
    })
    const { resolveDatasetRef } = await import('#/lib/chart-data')
    vi.mocked(resolveDatasetRef).mockResolvedValue({
      source: {
        datasetId: '11111111-1111-1111-8111-111111111111',
        name: 'Stability',
        workspaceId: 'ws',
        schemaVersionId: 'sv-1',
        schemaVersionNumber: 3,
        revision: 1,
        columns: [
          {
            id: FIELD_RECOVERY,
            label: 'Recovery (%)',
            logicalType: 'decimal',
          },
        ],
      },
      rows: [{ [FIELD_RECOVERY]: 100 }],
      totalCount: 1,
      truncated: false,
    })

    renderPreview({ title: 'Recovery', definitionId: 'def-1' })
    await waitFor(() =>
      expect(screen.getByText(/Recovery summary · v5/)).toBeTruthy(),
    )
    const open = screen.getByRole('link', { name: 'Open dataset' })
    expect(open.getAttribute('href')).toBe(
      `/datasets/${encodeURIComponent('11111111-1111-1111-8111-111111111111')}`,
    )
  })
})

describe('merged analysis block: a chart, a statistic or both', () => {
  const DATASET = '11111111-1111-1111-8111-111111111111'
  const FIELD_TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
  const CHART = {
    specVersion: 1,
    type: 'scatter',
    datasets: [{ datasetId: DATASET }],
    fields: {
      x: { fieldId: FIELD_TIME },
      y: { fieldId: FIELD_RECOVERY },
      series: null,
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
      series: [],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
  }
  const columns = [
    { fieldId: FIELD_TIME, label: 'Time', logicalType: 'decimal' },
    { fieldId: FIELD_RECOVERY, label: 'Recovery (%)', logicalType: 'decimal' },
  ]
  const rows = [
    { [FIELD_TIME]: 0, [FIELD_RECOVERY]: 10 },
    { [FIELD_TIME]: 24, [FIELD_RECOVERY]: 30 },
  ]
  const pinned = (definition: unknown): FrozenAnalysis =>
    ({ ...FROZEN, columns, definition }) as FrozenAnalysis

  it('rebuilds a frozen statistic and its chart from the pinned rows', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows,
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({
      title: 'Recovery',
      definitionId: 'def-1',
      frozen: pinned({ ...FROZEN.definition, chart: CHART }),
    })
    expect(await screen.findByTestId('chart')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByTestId('chart').textContent).toBe('2 rows plotted')
  })

  it('shows only the chart for a frozen chart-only analysis', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows,
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({
      title: 'Recovery',
      definitionId: 'def-1',
      frozen: pinned({
        definitionVersion: 1,
        kind: 'chart',
        datasets: [{ datasetId: DATASET }],
        chart: CHART,
      }),
    })
    expect(await screen.findByTestId('chart')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a frozen statistic-only payload from before the merge rendering as it did', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [{ [FIELD_RECOVERY]: 10 }, { [FIELD_RECOVERY]: 30 }],
      totalCount: 2,
      matchesProvenance: true,
    })
    renderPreview({ title: 'Old', definitionId: 'def-1', frozen: FROZEN })
    await screen.findByRole('table')
    expect(screen.queryByTestId('chart')).toBeNull()
  })

  it('withholds the chart too when the pinned rows do not match the provenance', async () => {
    mockFetchFrozenRows.mockResolvedValue({
      flags: [],
      rows: [],
      totalCount: 9,
      matchesProvenance: false,
    })
    renderPreview({
      title: 'Mismatch',
      definitionId: 'def-1',
      frozen: pinned({ ...FROZEN.definition, chart: CHART }),
    })
    expect(await screen.findByText(/Evidence mismatch/i)).toBeTruthy()
    expect(screen.queryByTestId('chart')).toBeNull()
  })
})
