/**
 * DATA-007 — Dataset Explorer route component tests.
 *
 * Covers the header states, the data table view (loading/empty/error/
 * populated + selection), the inspector (row, lineage, linked records), and
 * a DatasetDataTab smoke test with mocked queries so the incremental grid,
 * filter toolbar and failure states render end-to-end.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import type * as chartDataModule from '#/lib/chart-data'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  DataTableView,
  DatasetDataTab,
  DatasetExplorerHeader,
  DatasetChartTab,
  DatasetInspector,
  DatasetSchemaTab,
  HistoricalDatasetVersionTable,
} from './datasets'
import type { DatasetDataTabProps } from './datasets'
import { useReactTable, getCoreRowModel } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import type {
  ScientificColumnWire,
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

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
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

// Mock react-query so the data tab never hits the network. `useQuery`
// returns a controlled result derived from its queryKey; `useMutation` and
// `useQueryClient` are inert stubs.
vi.mock('@tanstack/react-query', () => {
  const actual = vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useInfiniteQuery: vi.fn(),
    useQuery: vi.fn(),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  }
})
vi.mock('#/lib/chart-data', async (importOriginal) => {
  const actual = await importOriginal<typeof chartDataModule>()
  return {
    ...actual,
    useLiveChartDataset: () => ({
      datasetQuery: { data: null, isLoading: false },
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
  }
})

afterEach(() => {
  cleanup()
  vi.mocked(useInfiniteQuery).mockReset()
  vi.mocked(useQuery).mockReset()
})

describe('DatasetChartTab', () => {
  it('updates the shared chart spec without making a network request', async () => {
    render(
      <DatasetChartTab
        table={table({
          columns: [
            column({
              id: 'col-time',
              field_name: 'time',
              label: 'Time',
              logical_type: 'integer',
            }),
            column({
              id: 'col-ph',
              field_name: 'ph',
              label: 'pH',
              logical_type: 'decimal',
            }),
          ],
        })}
      />,
    )

    expect(
      screen
        .getByRole('radio', { name: /^line$/i })
        .getAttribute('aria-checked'),
    ).toBe('true')
    await userEvent.click(screen.getByRole('radio', { name: /^bar$/i }))
    expect(
      screen
        .getByRole('radio', { name: /^bar$/i })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(useQuery).not.toHaveBeenCalled()
  })
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
        includeArchived={false}
        onToggleArchived={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('Datasets')).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Scientific datasets' }),
    ).toBeTruthy()
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
        includeArchived={false}
        onToggleArchived={() => {}}
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
        includeArchived={false}
        onToggleArchived={() => {}}
        onSelect={onSelect}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Select dataset' })
    expect(trigger.textContent).toContain('Browse 121 datasets')
    expect(screen.getByRole('heading', { name: 'Stability' })).toBeTruthy()

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
        includeArchived={false}
        onToggleArchived={() => {}}
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
  it('shows pinned Schema Version fields without legacy schema language', () => {
    render(<DatasetSchemaTab table={table()} />)

    expect(screen.getByText('Schema Version')).toBeTruthy()
    expect(screen.getByText('Pinned fields')).toBeTruthy()
    expect(screen.getByText('Sample')).toBeTruthy()
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

// --- DatasetInspector -----------------------------------------------------

describe('DatasetInspector', () => {
  it('prompts to select a row when none is selected', () => {
    vi.mocked(useQuery).mockReturnValue(queryResult([]))
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
    vi.mocked(useQuery).mockReturnValue(queryResult([]))
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
        dependencies={[
          {
            formula_id: 'f-1',
            source_table_id: 't-1',
            source_row_id: 'r-1',
            source_column_id: 'col-1',
          },
        ]}
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
    // Formula definitions and honest downstream usage are in Details.
    expect(screen.getByText('=col_alpha*2')).toBeTruthy()
    expect(screen.getByText('Downstream uses')).toBeTruthy()
    expect(screen.getByText('Uses Sample as an input')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Links/ }))
    expect(screen.getByText('SMP-1')).toBeTruthy()
  })

  it('surfaces a lineage error', () => {
    vi.mocked(useQuery).mockReturnValue(queryResult([]))
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
    // Formula usage errors are shown in the Details tab.
    expect(screen.getByText('Could not load formula usage.')).toBeTruthy()
  })
})

// --- DatasetDataTab (smoke) ----------------------------------------------

describe('DatasetDataTab', () => {
  function mockQueries(
    rows: ScientificRowWire[],
    totalCount: number,
    hasNextPage = false,
    state: {
      isRefetchError?: boolean
      error?: Error | null
    } = {},
  ) {
    const fetchNextPage = vi.fn()
    vi.mocked(useInfiniteQuery).mockReturnValue({
      data: { pages: [{ rows, totalCount }], pageParams: [0] },
      isLoading: false,
      isLoadingError: false,
      isRefetchError: state.isRefetchError ?? false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      hasNextPage,
      error: state.error ?? null,
      fetchNextPage,
      refetch: vi.fn(),
    } as any)
    vi.mocked(useQuery).mockImplementation((opts: any) => {
      const key = opts.queryKey as readonly unknown[]
      const head = key[0]
      if (head === 'dataset-explorer-lineage') {
        return queryResult({ formulas: [], dependencies: [] })
      }
      if (head === 'dataset-explorer-links') {
        return queryResult([])
      }
      return queryResult(null)
    })
    return fetchNextPage
  }

  function props(
    overrides: Partial<DatasetDataTabProps> = {},
  ): DatasetDataTabProps {
    return {
      table: table(),
      ...overrides,
    }
  }

  it('renders incremental rows without pagination or secondary previews', () => {
    mockQueries([{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }], 1)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('All records loaded')).toBeTruthy()
    expect(screen.queryByLabelText('Rows per page')).toBeNull()
    expect(screen.queryByLabelText('Next page')).toBeNull()
    expect(screen.queryByLabelText('Formula expression')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Distribution' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Correlations' })).toBeNull()
    expect(
      screen.queryByRole('separator', { name: 'Resize dataset preview' }),
    ).toBeNull()
    expect(screen.queryByText('Column summary')).toBeNull()
  })

  it('shows the empty state when no rows are returned', () => {
    mockQueries([], 0)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('No rows yet')).toBeTruthy()
  })

  it('requests the next incremental batch without pagination controls', async () => {
    const user = userEvent.setup()
    const fetchNextPage = mockQueries(
      [{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }],
      120,
      true,
    )
    render(<DatasetDataTab {...props()} />)

    expect(screen.queryByLabelText('Rows per page')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(fetchNextPage).toHaveBeenCalledOnce()
    expect(fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
  })

  it('reports a failed background refresh instead of presenting cached rows as current', () => {
    mockQueries(
      [{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }],
      1,
      false,
      { isRefetchError: true, error: new Error('refresh failed') },
    )
    render(<DatasetDataTab {...props()} />)

    expect(screen.getByText('Could not load records')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('All records loaded')).toBeNull()
  })
})

describe('HistoricalDatasetVersionTable', () => {
  it('renders frozen rows using the pinned Schema Version, not later live columns', () => {
    render(
      <HistoricalDatasetVersionTable
        columns={[{ id: 'ph-field', label: 'pH' }]}
        rows={[{ rowId: 'row-1', values: { 'ph-field': 7.2 } }]}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'pH' })).toBeTruthy()
    expect(screen.getByText('7.2')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Colour' })).toBeNull()
  })
})
