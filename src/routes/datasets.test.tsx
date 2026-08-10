/**
 * DATA-007 — Dataset Explorer route component tests.
 *
 * Covers the header states, the data table view (loading/empty/error/
 * populated + selection), the inspector (row, lineage, linked records), and
 * a DatasetDataTab smoke test with mocked queries so the TanStack Table,
 * filter toolbar, saved-view controls and chart preview render end-to-end.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'

import { useQuery } from '@tanstack/react-query'
import {
  ColumnSummary,
  DataTableView,
  DatasetDataTab,
  DatasetExplorerHeader,
  DatasetInspector,
  DatasetSchemaTab,
} from './datasets'
import type { DatasetDataTabProps } from './datasets'
import { useReactTable, getCoreRowModel } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import type {
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import type { DatasetSavedView } from '#/lib/dataset-explorer-data'

// jsdom does not implement ResizeObserver; radix tabs read it on mount.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({ useRouteContext: () => ({}) }),
  redirect: (options: unknown) => options,
}))

// Mock react-query so the data tab never hits the network. `useQuery`
// returns a controlled result derived from its queryKey; `useMutation` and
// `useQueryClient` are inert stubs.
vi.mock('@tanstack/react-query', () => {
  const actual = vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})
vi.mock('#/lib/chart-data', () => ({
  useLiveChartDataset: () => ({
    datasetQuery: { data: null, isLoading: false },
    calcQuery: { data: null, isLoading: false },
  }),
  materialiseLiveChart: () => ({
    state: { kind: 'empty_dataset' },
    columns: [],
    rows: [],
    series: [],
    xLabel: 'x',
    yLabel: 'y',
    xUnit: undefined,
    yUnit: undefined,
  }),
}))

afterEach(() => {
  cleanup()
  vi.mocked(useQuery).mockReset()
})

function column(
  overrides: Partial<ScientificColumnWire> = {},
): ScientificColumnWire {
  return {
    id: 'col-1',
    field_name: 'col_alpha',
    label: 'Sample',
    display_order: 0,
    logical_type: 'text',
    nullable: true,
    unit: null,
    validation: {},
    width: null,
    options: [],
    ...overrides,
  }
}

function table(
  overrides: Partial<ScientificTableWire> = {},
): ScientificTableWire {
  return {
    id: 't-1',
    resource_name: 'sheet_alpha',
    name: 'Stability',
    schema_version: 1,
    lifecycle: 'active',
    record_id: 'rec-1',
    columns: [
      column({ id: 'col-1', field_name: 'col_alpha', label: 'Sample' }),
      column({
        id: 'col-2',
        field_name: 'col_beta',
        label: 'pH',
        logical_type: 'decimal',
      }),
    ],
    ...overrides,
  }
}

function queryResult<T>(
  data: T | null,
  overrides: Partial<UseQueryResult<T, Error>> = {},
): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    isSuccess: Boolean(data) || data === null,
    status: 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<T, Error>
}

// --- DatasetExplorerHeader ------------------------------------------------

describe('DatasetExplorerHeader', () => {
  it('renders a skeleton while loading', () => {
    render(
      <DatasetExplorerHeader
        datasets={[]}
        loading
        error={null}
        selectedTableId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Dataset Explorer')).toBeTruthy()
    // No select while loading.
    expect(screen.queryByLabelText('Select dataset')).toBeNull()
  })

  it('renders an error badge on failure', () => {
    render(
      <DatasetExplorerHeader
        datasets={[]}
        loading={false}
        error={new Error('boom')}
        selectedTableId={null}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Could not load datasets')).toBeTruthy()
  })

  it('searches and selects from a populated dataset picker', async () => {
    const user = userEvent.setup()
    const t = table()
    const datasets = Array.from({ length: 120 }, (_, index) =>
      table({ id: `process-${index}`, name: `Process dataset ${index + 1}` }),
    )
    const onSelect = vi.fn()
    render(
      <DatasetExplorerHeader
        datasets={[t, ...datasets]}
        loading={false}
        error={null}
        selectedTableId={t.id}
        onSelect={onSelect}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Select dataset' })
    expect(trigger.textContent).toContain('Stability')

    await user.click(trigger)
    const search = screen.getByRole('combobox', { name: 'Search datasets' })
    await user.type(search, 'Process dataset 117')

    expect(screen.getByText('Process dataset 117')).toBeTruthy()
    expect(screen.queryByText('Process dataset 3')).toBeNull()
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('process-116')
    expect(
      screen.queryByRole('combobox', { name: 'Search datasets' }),
    ).toBeNull()
  })

  it('shows an empty result for an unmatched dataset search', async () => {
    const user = userEvent.setup()
    const t = table()
    render(
      <DatasetExplorerHeader
        datasets={[t]}
        loading={false}
        error={null}
        selectedTableId={t.id}
        onSelect={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Select dataset' }))
    await user.type(
      screen.getByRole('combobox', { name: 'Search datasets' }),
      'unavailable assay',
    )

    expect(screen.getByText('No datasets match your search.')).toBeTruthy()
  })
})

describe('DatasetSchemaTab', () => {
  it('describes table-owned fields without legacy implementation language', () => {
    vi.mocked(useQuery).mockReturnValue(
      queryResult({ schema: null, fields: [] }),
    )

    render(<DatasetSchemaTab table={table()} />)

    expect(screen.getByText('Dataset structure')).toBeTruthy()
    expect(
      screen.getByText('Fields are defined directly in this dataset.'),
    ).toBeTruthy()
    expect(screen.getByText('Local fields')).toBeTruthy()
    expect(screen.queryByText(/legacy ad-hoc/i)).toBeNull()
    expect(screen.queryByText('col_alpha')).toBeNull()
  })
})

// --- DataTableView --------------------------------------------------------

function makeTableInstance(
  rows: ScientificRowWire[],
  columns: ScientificColumnWire[],
) {
  const defs: ColumnDef<ScientificRowWire, unknown>[] = columns.map((c) => ({
    id: c.field_name,
    accessorKey: c.field_name,
    header: c.label,
    cell: ({ row }) => String(row.original[c.field_name] ?? '—'),
  }))
  // useReactTable is a hook; wrap in a tiny component to capture the instance.
  let instance: ReturnType<typeof useReactTable<ScientificRowWire>> | null =
    null
  function Harness() {
    instance = useReactTable({
      data: rows,
      columns: defs,
      getCoreRowModel: getCoreRowModel(),
    })
    return null
  }
  render(<Harness />)
  return instance!
}

describe('DataTableView', () => {
  it('shows a loading state before any rows arrive', () => {
    const instance = makeTableInstance([], [column()])
    render(
      <DataTableView
        table={instance}
        density="comfortable"
        loading
        error={null}
        rowCount={0}
        selectedRowId={null}
        onSelectRow={() => {}}
        emptyTitle="No rows yet"
      />,
    )
    expect(screen.getByLabelText('Loading dataset rows')).toBeTruthy()
  })

  it('shows the empty title when there are no rows', () => {
    const instance = makeTableInstance([], [column()])
    render(
      <DataTableView
        table={instance}
        density="comfortable"
        loading={false}
        error={null}
        rowCount={0}
        selectedRowId={null}
        onSelectRow={() => {}}
        emptyTitle="No matching rows"
      />,
    )
    expect(screen.getByText('No matching rows')).toBeTruthy()
  })

  it('shows an error alert on failure', () => {
    const instance = makeTableInstance([], [column()])
    render(
      <DataTableView
        table={instance}
        density="comfortable"
        loading={false}
        error={new Error('boom')}
        rowCount={0}
        selectedRowId={null}
        onSelectRow={() => {}}
        emptyTitle="No rows yet"
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('renders rows and selects a row on click', async () => {
    const user = userEvent.setup()
    let selected: string | null = null
    const rows: ScientificRowWire[] = [
      { id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 },
      { id: 'r-2', version: 1, col_alpha: 'A2', col_beta: 7.5 },
    ]
    const instance = makeTableInstance(rows, [
      column({ id: 'col-1', field_name: 'col_alpha', label: 'Sample' }),
      column({
        id: 'col-2',
        field_name: 'col_beta',
        label: 'pH',
        logical_type: 'decimal',
      }),
    ])
    render(
      <DataTableView
        table={instance}
        density="comfortable"
        loading={false}
        error={null}
        rowCount={2}
        selectedRowId={null}
        onSelectRow={(id) => (selected = id)}
        emptyTitle="No rows yet"
      />,
    )
    expect(screen.getByText('A1')).toBeTruthy()
    expect(screen.getByText('A2')).toBeTruthy()
    await user.click(screen.getByText('A1').closest('tr')!)
    expect(selected).toBe('r-1')
  })
})

describe('ColumnSummary', () => {
  it('computes completeness and numeric summaries for the loaded rows', () => {
    render(
      <ColumnSummary
        columns={table().columns}
        rows={[
          { id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.2 },
          { id: 'r-2', version: 1, col_alpha: 'A2', col_beta: 7.4 },
        ]}
        totalCount={12}
      />,
    )

    expect(
      screen.getByText('Based on 2 of 12 rows in the current result.'),
    ).toBeTruthy()
    expect(screen.getAllByText('2/2 (100%)')).toHaveLength(2)
    expect(screen.getByText('Mean 7.3 · 7.2–7.4')).toBeTruthy()
    expect(screen.getByText('2 unique values')).toBeTruthy()
  })
})

// --- DatasetInspector -----------------------------------------------------

describe('DatasetInspector', () => {
  it('prompts to select a row when none is selected', () => {
    render(
      <DatasetInspector
        table={table()}
        row={null}
        formulas={[]}
        dependencies={[]}
        links={[]}
        lineageLoading={false}
        lineageError={null}
      />,
    )
    expect(screen.getByText('Nothing selected')).toBeTruthy()
    expect(screen.getByText('Dataset row')).toBeTruthy()
  })

  it('shows row values, lineage and links for a selected row', async () => {
    const user = userEvent.setup()
    render(
      <DatasetInspector
        table={table()}
        row={{ id: 'r-1', version: 3, col_alpha: 'A1', col_beta: 7.4 }}
        formulas={[
          {
            id: 'f-1',
            target_table_id: 't-1',
            target_row_id: 'r-1',
            target_column_id: 'col-2',
            source_expression: '=col_alpha*2',
            template: {},
            bindings: {},
            engine_expression: 'col_alpha*2',
            syntax_profile: 'scientific',
            function_profile: 'arithmetic',
            literal_profile: 'numeric',
            engine_version: '1',
            status: 'supported',
            version: 1,
            created_at: '2025-01-01T00:00:00Z',
          },
        ]}
        dependencies={[]}
        links={[
          {
            id: 'l-1',
            targetKind: 'sample',
            targetIdentifier: 'SMP-1',
            linkType: 'sample',
          },
        ]}
        lineageLoading={false}
        lineageError={null}
      />,
    )
    // Inspector title uses the first text column value
    expect(screen.getAllByText('A1').length).toBeGreaterThanOrEqual(1)
    // Lineage content is now in the Details tab
    expect(screen.getByText('=col_alpha*2')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Links/ }))
    expect(screen.getByText('SMP-1')).toBeTruthy()
  })

  it('surfaces a lineage error', () => {
    render(
      <DatasetInspector
        table={table()}
        row={{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }}
        formulas={[]}
        dependencies={[]}
        links={[]}
        lineageLoading={false}
        lineageError={new Error('boom')}
      />,
    )
    // Lineage error is shown in the Details tab
    expect(screen.getByText('Could not load lineage.')).toBeTruthy()
  })
})

// --- DatasetDataTab (smoke) ----------------------------------------------

describe('DatasetDataTab', () => {
  function mockQueries(rows: ScientificRowWire[], totalCount: number) {
    vi.mocked(useQuery).mockImplementation((opts: any) => {
      const key = opts.queryKey as readonly unknown[]
      const head = key[0]
      if (head === 'dataset-explorer-rows') {
        return queryResult({ rows, totalCount })
      }
      if (head === 'dataset-explorer-lineage') {
        return queryResult({ formulas: [], dependencies: [] })
      }
      if (head === 'dataset-explorer-links') {
        return queryResult([])
      }
      return queryResult(null)
    })
  }

  function props(
    overrides: Partial<DatasetDataTabProps> = {},
  ): DatasetDataTabProps {
    return {
      table: table(),
      workspaceId: 'ws-1',
      userId: 'u-1',
      viewStore: {
        list: () => [],
        save: (v: DatasetSavedView) => v,
        remove: () => {},
      },
      ...overrides,
    }
  }

  it('renders rows, working summary and a draggable chart preview', async () => {
    const user = userEvent.setup()
    mockQueries([{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }], 1)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('A1')).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLInputElement>('Formula expression').value,
    ).toBe('Titer (TU/mL) = [Vector genome (copies/mL)] / [Volume (mL)]')
    expect(screen.getByText('Apply')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Correlations' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Save current view' }),
    ).toBeTruthy()

    const layout = document.querySelector('[data-preview-height]')
    const separator = screen.getByRole('separator', {
      name: 'Resize dataset preview',
    })
    expect(layout?.getAttribute('data-preview-height')).toBe('240')
    separator.focus()
    await user.keyboard('{ArrowUp}')
    expect(layout?.getAttribute('data-preview-height')).toBe('256')
    expect(separator.getAttribute('aria-valuenow')).toBe('256')
    expect(screen.queryByRole('button', { name: 'Expand preview' })).toBeNull()
    expect(screen.queryByText(/Show data table/)).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Column summary' }))
    expect(screen.getByRole('table', { name: 'Column summary' })).toBeTruthy()
    expect(screen.getByText('Mean 7.4 · 7.4–7.4')).toBeTruthy()
  })

  it('shows the empty state when no rows are returned', () => {
    mockQueries([], 0)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('No rows yet')).toBeTruthy()
  })
})
