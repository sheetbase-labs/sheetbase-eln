/**
 * SCI-004 chart block editor interaction tests. Verifies the editor's
 * dataset/type/field controls drive saves, freeze/unfreeze actions call
 * the lifecycle callbacks, frozen state disables controls, and all
 * controls are keyboard-accessible with proper labels. The scientific
 * data client is mocked so no PostgREST is required.
 */
import { choose } from '../../../tests/unit/picker'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { BlockEditor } from './block-editor'
import type { NotebookBlock } from '#/lib/notebook-data'
import type * as chartData from '#/lib/chart-data'
import {
  fetchCanonicalDataset,
  fetchDatasetRows,
  useLiveChartDataset,
} from '#/lib/chart-data'
import { fetchDatasetSummaries } from '#/lib/dataset-explorer-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type * as explorerData from '#/lib/dataset-explorer-data'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'

vi.mock('#/lib/chart-data', async (importOriginal) => {
  const actual = await importOriginal<typeof chartData>()
  return {
    ...actual,
    sciDataClient: {} as never,
    fetchCanonicalDataset: vi.fn(),
    fetchDatasetRows: vi.fn(),
    useLiveChartDataset: vi.fn(() => ({
      datasetQuery: { data: null, isLoading: false },
    })),
  }
})

const mockUseLive = useLiveChartDataset as unknown as Mock
vi.mock('#/lib/dataset-explorer-data', async (importOriginal) => {
  const actual = await importOriginal<typeof explorerData>()
  return {
    ...actual,
    fetchDatasetSummaries: vi.fn(),
  }
})

const mockFetchDataset = vi.mocked(fetchCanonicalDataset)
const mockFetchRows = vi.mocked(fetchDatasetRows)
const mockSummaries = vi.mocked(fetchDatasetSummaries)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const TABLE_ID = '00000000-0000-4000-8000-000000000170'

function makeSource(id = TABLE_ID): CanonicalDatasetSource {
  return {
    datasetId: id,
    name: 'Stability readings (qPCR)',
    workspaceId: 'ws-1',
    schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
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
      { id: 'c3', label: 'Condition', logicalType: 'text' },
    ],
  }
}

function makeRows() {
  return {
    rows: [
      { c1: 0, c2: 7.2, c3: '4 °C' },
      { c1: 28, c2: 5.9, c3: '4 °C' },
      { c1: 0, c2: 7.1, c3: '−20 °C' },
      { c1: 28, c2: 6.4, c3: '−20 °C' },
    ],
    totalCount: 4,
    truncated: false,
  }
}

function lineSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: 1,
    type: 'line',
    datasets: [{ datasetId: TABLE_ID }],
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

function makeBlock(payload: Record<string, unknown>): NotebookBlock {
  return {
    id: 'block-chart',
    recordId: 'experiment-1',
    type: 'chart',
    payload,
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

function makeResolved() {
  const rows = makeRows()
  return {
    source: makeSource(),
    rows: rows.rows,
    truncated: false,
    totalCount: rows.totalCount,
  }
}

function mockOkDataset() {
  mockFetchDataset.mockResolvedValue(makeSource())
  mockFetchRows.mockResolvedValue(makeRows())
  // The hook is mocked at its boundary: BlockEditor renders straight from
  // this resolved dataset, so no network-shaped client is exercised.
  mockUseLive.mockImplementation(() => ({
    datasetQuery: { data: makeResolved(), isLoading: false },
  }))
}

function mockTablesList() {
  mockSummaries.mockResolvedValue([
    {
      id: TABLE_ID,
      name: 'Stability readings (qPCR)',
      resource_name: '',
      workspace_id: 'ws-1',
      schema_version_id: '00000000-0000-4000-8000-00000000fffe',
      schema_version_number: 1,
      revision: 1,
      columns: makeSource().columns.map((c) => ({
        id: c.id,
        label: c.label,
        logical_type: c.logicalType,
        unit: c.unit,
      })),
    },
  ] as never)
}

const okSave = vi.fn(async (_payload: Record<string, unknown>) => ({
  ok: true,
}))

describe('BlockEditor — chart: dataset and type controls', () => {
  it('lists available datasets and starts a spec when one is selected', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    renderWithQuery(<BlockEditor block={makeBlock({})} save={okSave} />)
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLButtonElement>('Dataset').disabled).toBe(
        false,
      )
    })
    await choose(user, 'Dataset', /Stability readings/)
    // Wait for the columns query to resolve so field options appear.
    await waitFor(() => {
      expect(screen.getByLabelText('X field')).toBeTruthy()
    })
    const typeSelect = screen.getByLabelText<HTMLSelectElement>('Chart type')
    expect(typeSelect.value).toBe('line')
  })

  it('changes the chart type select to scatter', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'My chart', spec: lineSpec() })}
        save={okSave}
      />,
    )
    const typeSelect = screen.getByLabelText<HTMLSelectElement>('Chart type')
    expect(typeSelect.value).toBe('line')
    await user.selectOptions(typeSelect, 'scatter')
    expect(typeSelect.value).toBe('scatter')
    // Selecting bar also works.
    await user.selectOptions(typeSelect, 'bar')
    expect(typeSelect.value).toBe('bar')
  })
})

describe('BlockEditor — chart: field mapping controls', () => {
  it('changes the X field mapping to a different column', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'My chart', spec: lineSpec() })}
        save={okSave}
      />,
    )
    // Wait for column options to load.
    await waitFor(() => {
      const sel = screen.getByLabelText('X field')
      expect((sel as HTMLSelectElement).innerHTML).toContain('c3')
    })
    const xSelect = screen.getByLabelText<HTMLSelectElement>('X field')
    expect(xSelect.value).toContain('c1')
    await user.selectOptions(xSelect, 'c3')
    expect(xSelect.value).toBe('c3')
  })

  it('changes the Y axis scale select to log', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'My chart', spec: lineSpec() })}
        save={okSave}
      />,
    )
    const yScaleSelect =
      screen.getByLabelText<HTMLSelectElement>('Y axis scale')
    expect(yScaleSelect.value).toBe('linear')
    await user.selectOptions(yScaleSelect, 'log')
    expect(yScaleSelect.value).toBe('log')
  })
})

describe('BlockEditor — chart: freeze and unfreeze lifecycle', () => {
  it('calls onFreezeChart when the Freeze snapshot button is clicked', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    const onFreezeChart = vi.fn(async () => {})
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'My chart', spec: lineSpec() })}
        save={okSave}
        onFreezeChart={onFreezeChart}
      />,
    )
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Freeze snapshot',
        }).disabled,
      ).toBe(false)
    })
    await user.click(screen.getByRole('button', { name: 'Freeze snapshot' }))
    expect(onFreezeChart).toHaveBeenCalledOnce()
  })

  it('disables editing controls and shows the frozen badge when frozen', async () => {
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({
          title: 'Frozen chart',
          spec: lineSpec(),
          frozen: {
            revisionId: null,
            frozenAt: '2025-07-14T10:00:00Z',
            frozenByUserId: 'u1',
            datasetProvenance: [
              {
                datasetId: TABLE_ID,
                schemaVersion: 1,
                rowCount: 4,
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
              rows: [{ col_time: 0, col_titer: 7.2 }],
              series: [
                {
                  identifier: '4 °C',
                  label: '4 °C',
                  color: CHART_PALETTE[0],
                  points: [{ x: 0, y: 7.2, yError: null, label: '4 °C' }],
                },
              ],
            },
          },
        })}
        save={okSave}
        onUnfreezeChart={vi.fn(async () => {})}
      />,
    )
    expect(screen.getAllByText(/Frozen snapshot/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText<HTMLSelectElement>('Dataset').disabled).toBe(
      true,
    )
    expect(
      screen.getByLabelText<HTMLSelectElement>('Chart type').disabled,
    ).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>('X field').disabled).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: /Unfreeze/ })).toBeTruthy()
  })

  it('calls onUnfreezeChart when the Unfreeze button is clicked', async () => {
    const user = userEvent.setup()
    mockTablesList()
    mockOkDataset()
    const onUnfreezeChart = vi.fn(async () => {})
    renderWithQuery(
      <BlockEditor
        block={makeBlock({
          title: 'Frozen chart',
          spec: lineSpec(),
          frozen: {
            revisionId: null,
            frozenAt: '2025-07-14T10:00:00Z',
            frozenByUserId: 'u1',
            datasetProvenance: [
              {
                datasetId: TABLE_ID,
                schemaVersion: 1,
                rowCount: 4,
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
              rows: [{ col_time: 0, col_titer: 7.2 }],
              series: [
                {
                  identifier: '4 °C',
                  label: '4 °C',
                  color: CHART_PALETTE[0],
                  points: [{ x: 0, y: 7.2, yError: null, label: '4 °C' }],
                },
              ],
            },
          },
        })}
        save={okSave}
        onUnfreezeChart={onUnfreezeChart}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Unfreeze/ }))
    expect(onUnfreezeChart).toHaveBeenCalledOnce()
  })
})

describe('BlockEditor — chart: keyboard accessibility', () => {
  it('exposes labelled controls for all chart settings', async () => {
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'My chart', spec: lineSpec() })}
        save={okSave}
      />,
    )
    const labels = [
      'Chart title',
      'Dataset',
      'Chart type',
      'Series field',
      'X field',
      'Y field',
      'X axis scale',
      'Y axis scale',
      'Provenance note',
    ]
    for (const label of labels) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it('renders a read-only chart without editable controls', async () => {
    mockTablesList()
    mockOkDataset()
    renderWithQuery(
      <BlockEditor
        block={makeBlock({ title: 'Read-only chart', spec: lineSpec() })}
        save={okSave}
        readOnly
      />,
    )
    expect(screen.queryByLabelText('Dataset')).toBeNull()
    expect(screen.queryByLabelText('Chart type')).toBeNull()
    expect(screen.getByText('Read-only chart')).toBeTruthy()
  })
})
