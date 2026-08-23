/**
 * SCI-004 chart block preview tests. Verifies the ChartBlockPreview
 * resolves a live dataset through the shared scientific-sheet-data client,
 * surfaces missing-field, empty-dataset, log-scale-invalid and stale
 * states, renders a frozen snapshot without live re-read, and shows
 * loading/permission/empty states. The data client is mocked so no
 * PostgREST is required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BlockPreview } from './block-preview'
import type { NotebookBlock } from '#/lib/notebook-data'
import type * as scientificSheetData from '#/lib/scientific-sheet-data'
import {
  fetchAllScientificRows,
  fetchScientificCalculationResults,
  fetchScientificTable,
} from '#/lib/scientific-sheet-data'
import type {
  FormulaResultWire,
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'

vi.mock('#/lib/scientific-sheet-data', async (importOriginal) => {
  const actual = await importOriginal<typeof scientificSheetData>()
  return {
    ...actual,
    fetchScientificTable: vi.fn(),
    fetchAllScientificRows: vi.fn(),
    fetchScientificCalculationResults: vi.fn(),
  }
})

const mockFetchTable = vi.mocked(fetchScientificTable)
const mockFetchRows = vi.mocked(fetchAllScientificRows)
const mockFetchCalc = vi.mocked(fetchScientificCalculationResults)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

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

function mockOkDataset() {
  mockFetchTable.mockResolvedValue(makeTable())
  mockFetchRows.mockResolvedValue(makeRows())
  mockFetchCalc.mockResolvedValue([])
}

describe('ChartBlockPreview — live resolution', () => {
  it('renders a live chart from the resolved dataset', async () => {
    mockOkDataset()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Stability curve',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('Stability curve')).toBeTruthy()
      expect(screen.getByText('Live')).toBeTruthy()
    })
    await waitFor(() => {
      expect(document.querySelector('[role="img"]')).toBeTruthy()
    })
  })

  it('renders a loading state while the dataset resolves', () => {
    mockFetchTable.mockReturnValue(new Promise(() => {}))
    mockFetchRows.mockResolvedValue([])
    mockFetchCalc.mockResolvedValue([])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Loading chart',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('renders a permission/error state when the dataset cannot be loaded', async () => {
    mockFetchTable.mockRejectedValue(new Error('permission denied'))
    mockFetchRows.mockResolvedValue([])
    mockFetchCalc.mockResolvedValue([])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'No access',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    })
  })

  it('surfaces a missing-dataset state when no spec is present', () => {
    renderWithQuery(<BlockPreview block={makeBlock({ title: 'Empty' })} />)
    expect(screen.getByText(/No chart configured/i)).toBeTruthy()
  })

  it('surfaces a missing-field state when a bound column is absent', async () => {
    mockFetchTable.mockResolvedValue(makeTable())
    mockFetchRows.mockResolvedValue(makeRows())
    mockFetchCalc.mockResolvedValue([])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Missing field',
          spec: lineSpec({
            fields: {
              x: { columnId: 'c1', fieldName: 'col_time' },
              y: { columnId: 'missing-col', fieldName: 'col_absent' },
              series: null,
              color: null,
              size: null,
              facet: null,
            },
          }),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/missing field/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces an empty-dataset state when filters match no rows', async () => {
    mockFetchTable.mockResolvedValue(makeTable())
    mockFetchRows.mockResolvedValue([])
    mockFetchCalc.mockResolvedValue([])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Empty dataset',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/no rows matching/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces a log-scale-invalid state for non-positive values on a log axis', async () => {
    mockFetchTable.mockResolvedValue(makeTable())
    // Include a non-positive y value.
    mockFetchRows.mockResolvedValue([
      {
        id: 'r1',
        version: 1,
        col_time: 0,
        col_titer: -1,
        col_condition: '4 °C',
      },
    ])
    mockFetchCalc.mockResolvedValue([])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Log invalid',
          spec: lineSpec({
            display: {
              ...lineSpec().display,
              axes: {
                x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
                y: { label: 'Log titer', scale: 'log', unit: 'log₁₀' },
              },
            },
          }),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/log scale/i).length).toBeGreaterThan(0)
    })
  })

  it('surfaces a stale-calculation state when a plotted formula is stale', async () => {
    mockFetchTable.mockResolvedValue(makeTable())
    mockFetchRows.mockResolvedValue(makeRows())
    const stale: FormulaResultWire = {
      formula_id: 'f1',
      target_table_id: TABLE_ID,
      target_row_id: 'r1',
      target_column_id: 'c2',
      cell_kind: 'formula',
      value_is_authoritative: false,
      definition_status: 'supported',
      formula_version: 1,
      current_input_revision: 1,
      calculation_status: 'stale',
      calculated_value: null,
      calculation_error_code: null,
      cache_input_revision: null,
      engine_version: null,
      profile_fingerprint: null,
      runtime_fingerprint: null,
      calculated_at: null,
    }
    mockFetchCalc.mockResolvedValue([stale])
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Stale calc',
          spec: lineSpec(),
          frozen: null,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0)
    })
  })
})

describe('ChartBlockPreview — frozen snapshot', () => {
  it('renders a frozen snapshot without live re-read', () => {
    mockOkDataset()
    renderWithQuery(
      <BlockPreview
        block={makeBlock({
          title: 'Frozen snapshot',
          spec: lineSpec(),
          frozen: {
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
      />,
    )
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    // Frozen path must not call the live dataset resolver.
    expect(mockFetchTable).not.toHaveBeenCalled()
    expect(document.querySelector('[role="img"]')).toBeTruthy()
  })
})
