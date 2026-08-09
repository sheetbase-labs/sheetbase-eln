/**
 * DATA-007 — Dataset Explorer route component tests.
 *
 * Covers the header states, the data table view (loading/empty/error/
 * populated + selection), the inspector (row, lineage, linked records), and
 * a DatasetDataTab smoke test with mocked queries so the TanStack Table,
 * filter toolbar, saved-view controls and chart preview render end-to-end.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'

import { useQuery } from '@tanstack/react-query'
import {
  DatasetDataTab,
  DatasetExplorerHeader,
  DatasetInspector,
} from './datasets'
import type { DatasetDataTabProps } from './datasets'
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

  it('renders a populated dataset selector', async () => {
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
    const select = screen.getByLabelText('Select dataset')
    expect((select as unknown as HTMLSelectElement).value).toBe(t.id)
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
    expect(
      screen.getByText(
        'Select a row to inspect its values, lineage and linked records.',
      ),
    ).toBeTruthy()
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
    expect(screen.getByText('A1')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Lineage' }))
    expect(screen.getByText('=col_alpha*2')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Links/ }))
    expect(screen.getByText('SMP-1')).toBeTruthy()
  })

  it('surfaces a lineage error', async () => {
    const user = userEvent.setup()
    render(
      <DatasetInspector
        table={table()}
        row={null}
        formulas={[]}
        dependencies={[]}
        links={[]}
        lineageLoading={false}
        lineageError={new Error('boom')}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Lineage' }))
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
      ...overrides,
    }
  }

  it('renders rows, filter toolbar and chart preview heading', () => {
    mockQueries([{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }], 1)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('A1')).toBeTruthy()
    expect(screen.getByText('Chart preview')).toBeTruthy()
    expect(screen.getByLabelText('Saved view name')).toBeTruthy()
  })

  it('uses the generic inspector trigger and clears selection when closed', async () => {
    const user = userEvent.setup()
    mockQueries([{ id: 'r-1', version: 1, col_alpha: 'A1', col_beta: 7.4 }], 1)
    render(<DatasetDataTab {...props()} />)

    const row = screen.getByRole('row', { name: /A1/ })
    await user.click(row)
    expect(row.getAttribute('aria-selected')).toBe('true')
    await user.click(
      screen.getByRole('button', { name: 'Open Dataset inspector' }),
    )

    const dialog = screen.getByRole('dialog', { name: 'Dataset inspector' })
    expect(within(dialog).getByText('Version 1')).toBeTruthy()
    await user.click(
      within(dialog).getByRole('button', { name: 'Close inspector' }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(row.getAttribute('aria-selected')).toBe('false')
  })

  it('shows the empty state when no rows are returned', () => {
    mockQueries([], 0)
    render(<DatasetDataTab {...props()} />)
    expect(screen.getByText('No rows yet')).toBeTruthy()
  })
})
