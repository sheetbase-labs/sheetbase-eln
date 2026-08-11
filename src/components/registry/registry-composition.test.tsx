import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'

import { RegistryComposition } from './registry-composition'
import type { RegistryCompositionProps } from './registry-composition'
import type { RegistryQuery } from '#/lib/registry'

interface Row {
  id: string
  identifier: string
  status: string
  value: number
}

const rows: Row[] = [
  { id: 'one', identifier: 'SMP-0001', status: 'available', value: 1.2 },
  { id: 'two', identifier: 'SMP-0002', status: 'reserved', value: 2.4 },
]

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'identifier', header: 'Identifier' },
  { accessorKey: 'status', header: 'Status' },
  {
    accessorKey: 'value',
    header: 'Concentration',
    meta: { registryFormat: { kind: 'scientific', unit: 'µg/mL' } },
  },
  {
    id: 'actions',
    header: 'Actions',
    enableSorting: false,
    enableHiding: false,
    cell: () => 'Open',
  },
]

const query: RegistryQuery = {
  pageIndex: 0,
  pageSize: 25,
  sorting: [],
  grouping: [],
  filters: [],
}

function props(
  overrides: Partial<RegistryCompositionProps<Row>> = {},
): RegistryCompositionProps<Row> {
  return {
    registryId: 'test-records',
    title: 'Test records',
    description: 'Reusable registry proof.',
    rows,
    totalCount: 2,
    columns,
    query,
    onQueryChange: vi.fn(),
    getRowId: (row) => row.id,
    selectedId: null,
    onSelectedIdChange: vi.fn(),
    summaries: [{ label: 'Total', value: '1.25m' }],
    filterDefinitions: [
      {
        id: 'status',
        label: 'Status',
        options: [
          { value: 'available', label: 'Available' },
          { value: 'reserved', label: 'Reserved' },
        ],
      },
    ],
    groupingOptions: [{ id: 'status', label: 'Status' }],
    renderInspector: (row) => (
      <div>{row ? `Inspecting ${row.identifier}` : 'Nothing selected'}</div>
    ),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('RegistryComposition server contracts', () => {
  it('uses the reported total for pagination without loading all rows', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(
      <RegistryComposition
        {...props({ totalCount: 1_250_000, onQueryChange })}
      />,
    )

    expect(screen.getByText('1,250,000 records')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onQueryChange).toHaveBeenCalledWith({ ...query, pageIndex: 1 })
  })

  it('emits manual sorting, filtering and grouping query changes', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(<RegistryComposition {...props({ onQueryChange })} />)

    await user.click(
      screen.getByRole('button', { name: 'Sort by Identifier ascending' }),
    )
    expect(onQueryChange).toHaveBeenCalledWith({
      ...query,
      pageIndex: 0,
      sorting: [{ id: 'identifier', desc: false }],
    })

    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await user.click(screen.getByRole('menuitem', { name: 'Status' }))
    await user.click(screen.getByRole('button', { name: 'Select' }))
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Available' }),
    )

    expect(onQueryChange).toHaveBeenCalledWith({
      ...query,
      pageIndex: 0,
      filters: [{ id: 'status', value: 'available' }],
    })

    await user.selectOptions(screen.getByLabelText('Group rows'), 'status')
    expect(onQueryChange).toHaveBeenCalledWith({
      ...query,
      pageIndex: 0,
      grouping: ['status'],
    })
  })

  it('shows the active option value in a filter trigger', () => {
    render(
      <RegistryComposition
        {...props({
          query: {
            ...query,
            filters: [{ id: 'status', value: 'available' }],
          },
        })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Available' })).toBeTruthy()
  })

  it('keeps a newly added filter open until the user selects a value', async () => {
    const user = userEvent.setup()

    function ControlledRegistry() {
      const [controlledQuery, setControlledQuery] = useState(query)
      return (
        <RegistryComposition
          {...props({
            query: controlledQuery,
            onQueryChange: setControlledQuery,
          })}
        />
      )
    }

    render(<ControlledRegistry />)
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await user.click(screen.getByRole('menuitem', { name: 'Status' }))

    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy()
  })

  it('debounces server-owned text search updates', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(
      <RegistryComposition
        {...props({
          onQueryChange,
          searchDebounceMs: 300,
          filterDefinitions: [
            { id: 'q', label: 'Search', placeholder: 'Identifier or title' },
          ],
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await user.click(screen.getByRole('menuitem', { name: 'Search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Anti')
    expect(onQueryChange).not.toHaveBeenCalled()
    await waitFor(() => expect(onQueryChange).toHaveBeenCalledOnce(), {
      timeout: 600,
    })
    expect(onQueryChange).toHaveBeenCalledWith({
      ...query,
      filters: [{ id: 'q', value: 'Anti' }],
    })
  })

  it('keeps text search immediate unless a consumer opts into debouncing', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(
      <RegistryComposition
        {...props({
          onQueryChange,
          filterDefinitions: [{ id: 'q', label: 'Search' }],
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await user.click(screen.getByRole('menuitem', { name: 'Search' }))
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'A')
    expect(onQueryChange).toHaveBeenCalledWith({
      ...query,
      filters: [{ id: 'q', value: 'A' }],
    })
  })

  it('makes page-local group counts explicit when results are paginated', () => {
    render(
      <RegistryComposition
        {...props({
          totalCount: 50,
          query: { ...query, grouping: ['status'] },
        })}
      />,
    )

    expect(screen.getAllByText('(1 on this page)')).toHaveLength(2)
    expect(
      screen.getByText('50 records · groups continue across pages'),
    ).toBeTruthy()
  })

  it('reports incremental loading without page controls', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    render(
      <RegistryComposition
        {...props({
          totalCount: 50,
          incrementalRows: {
            hasMore: true,
            loadingMore: false,
            onLoadMore,
          },
        })}
      />,
    )

    expect(screen.getByText('50 records · 2 loaded')).toBeTruthy()
    expect(screen.queryByLabelText('Rows per page')).toBeNull()
    expect(screen.queryByLabelText('Next page')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('exposes accessible column resize handles when enabled', () => {
    render(<RegistryComposition {...props({ resizableColumns: true })} />)

    const handle = screen.getByRole('separator', {
      name: 'Resize Identifier column',
    })
    const initialSize = Number(handle.getAttribute('aria-valuenow'))
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(initialSize + 10)
  })

  it('preserves loaded rows when an incremental append fails', () => {
    render(
      <RegistryComposition
        {...props({
          totalCount: 50,
          incrementalRows: {
            hasMore: true,
            loadingMore: false,
            loadError: new Error('next page failed'),
            onLoadMore: vi.fn(),
          },
        })}
      />,
    )

    expect(screen.getByText('Could not load more records')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByText('50 records · 2 loaded')).toBeTruthy()
  })
})

describe('RegistryComposition interaction and states', () => {
  it('supports keyboard row navigation and preserves controlled selection after refresh', () => {
    const onSelectedIdChange = vi.fn()
    const { container, rerender } = render(
      <RegistryComposition {...props({ onSelectedIdChange })} />,
    )
    const first = screen.getByRole('row', { name: /SMP-0001/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const second = screen.getByRole('row', { name: /SMP-0002/ })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(onSelectedIdChange).toHaveBeenCalledWith('two')

    rerender(
      <RegistryComposition
        {...props({
          rows: rows.map((row) => ({ ...row })),
          selectedId: 'two',
          onSelectedIdChange,
        })}
      />,
    )
    // Inspector Sheet opens on selection; Radix marks the rest inert,
    // so query the DOM directly instead of using getByRole.
    const selectedRow = container.querySelector(
      'tr[data-registry-row-id="two"]',
    )
    expect(selectedRow?.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Inspecting SMP-0002')).toBeTruthy()
  })

  it('navigates data rows across group headers', () => {
    render(
      <RegistryComposition
        {...props({ query: { ...query, grouping: ['status'] } })}
      />,
    )

    const first = screen.getByRole('row', { name: /SMP-0001/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(
      screen.getByRole('row', { name: /SMP-0002/ }),
    )
  })

  it('keeps a selected record visible when it is loaded outside the current page', () => {
    render(
      <RegistryComposition
        {...props({
          rows: [rows[0]],
          selectedId: 'two',
          selectedRecord: rows[1],
        })}
      />,
    )

    expect(screen.getByText('Inspecting SMP-0002')).toBeTruthy()
  })

  it.each([
    ['loading', { loading: true }, 'Loading Test records'],
    ['permission', { permissionDenied: true }, 'Permission denied'],
    ['empty', { rows: [], totalCount: 0 }, 'No records yet'],
    [
      'no-results',
      {
        rows: [],
        totalCount: 0,
        query: { ...query, filters: [{ id: 'status', value: 'missing' }] },
      },
      'No matching records',
    ],
  ] as const)('renders the %s state', (_name, overrides, expected) => {
    render(
      <RegistryComposition
        {...props(overrides as Partial<RegistryCompositionProps<Row>>)}
      />,
    )
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('labels partial result pages without hiding returned rows', () => {
    render(<RegistryComposition {...props({ partialData: true })} />)
    expect(screen.getByRole('status').textContent).toContain('Partial data')
    expect(screen.getByText('SMP-0001')).toBeTruthy()
  })

  it('hides all server-derived summaries, totals and controls when denied', () => {
    render(
      <RegistryComposition
        {...props({
          permissionDenied: true,
          actions: <button type="button">Export secret rows</button>,
        })}
      />,
    )

    expect(screen.getByText('Permission denied')).toBeTruthy()
    expect(screen.queryByText('1.25m')).toBeNull()
    expect(screen.queryByText('2 records')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Export secret rows' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Filter by Status')).toBeNull()
    expect(screen.queryByLabelText('Registry inspector')).toBeNull()
  })

  it('has accessible column headers and a fixed compact density', () => {
    render(<RegistryComposition {...props()} />)
    const table = screen.getByRole('table', { name: 'Test records' })
    expect(
      within(table).getByRole('columnheader', { name: /Identifier/ }),
    ).toBeTruthy()
    expect(table.getAttribute('data-density')).toBe('compact')
    expect(screen.queryByLabelText('Table density')).toBeNull()
    expect(within(table).getByText('1.2 µg/mL')).toBeTruthy()
  })

  it('uses a generic labelled Sheet for the inspector, opened by row selection', () => {
    render(
      <RegistryComposition
        {...props({ inspectorLabel: 'Record details', selectedId: 'one' })}
      />,
    )
    // Inspector auto-opens when a row is selected
    expect(screen.getByRole('dialog', { name: 'Record details' })).toBeTruthy()
    expect(screen.getAllByText('Inspecting SMP-0001')).toBeTruthy()
  })

  it('preserves an explicit custom renderer for numeric cells', () => {
    render(
      <RegistryComposition
        {...props({
          columns: [
            {
              accessorKey: 'value',
              header: 'Progress',
              cell: ({ getValue }) => `Custom ${getValue<number>()}`,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Custom 1.2')).toBeTruthy()
  })
})
