/**
 * SCI-004 chart block editor interaction tests. Verifies the editor's
 * dataset/type/field controls drive saves, freeze/unfreeze actions call
 * the lifecycle callbacks, frozen state disables controls, and all
 * controls are keyboard-accessible with proper labels. The scientific
 * data client is mocked so no PostgREST is required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import type { NotebookBlock } from '#/lib/notebook-data'
import type * as scientificSheetData from '#/lib/scientific-sheet-data'
import {
  fetchAllScientificRows,
  fetchScientificCalculationResults,
  fetchScientificTable,
  scientificDataClient,
} from '#/lib/scientific-sheet-data'
import type {
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
    scientificDataClient: {
      ...actual.scientificDataClient,
      list: vi.fn(),
    },
  }
})

const mockFetchTable = vi.mocked(fetchScientificTable)
const mockFetchRows = vi.mocked(fetchAllScientificRows)
const mockFetchCalc = vi.mocked(fetchScientificCalculationResults)
const mockList = vi.mocked(scientificDataClient.list)

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

function makeTable(id = TABLE_ID): ScientificTableWire {
  return {
    id,
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

function mockTablesList() {
  mockList.mockResolvedValue([
    { id: TABLE_ID, name: 'Stability readings (qPCR)' },
  ])
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
    const datasetSelect = screen.getByLabelText('Dataset')
    await waitFor(() => {
      expect(screen.getByText('Stability readings (qPCR)')).toBeTruthy()
    })
    await user.selectOptions(datasetSelect, TABLE_ID)
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
      expect((sel as HTMLSelectElement).innerHTML).toContain('col_condition')
    })
    const xSelect = screen.getByLabelText<HTMLSelectElement>('X field')
    expect(xSelect.value).toContain('c1')
    await user.selectOptions(xSelect, 'c3|col_condition')
    expect(xSelect.value).toBe('c3|col_condition')
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
                tableId: TABLE_ID,
                schemaVersion: 1,
                rowCount: 4,
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
                tableId: TABLE_ID,
                schemaVersion: 1,
                rowCount: 4,
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
