import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDef } from '@tanstack/react-table'

import { RegistryComposition } from './registry-composition'
import type { RegistryCompositionProps } from './registry-composition'
import type { RegistryQuery } from '#/lib/registry'
import { createRegistrySavedViewStore } from '#/lib/registry'

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

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function props(
  overrides: Partial<RegistryCompositionProps<Row>> = {},
): RegistryCompositionProps<Row> {
  return {
    registryId: 'test-records',
    workspaceId: 'workspace-a',
    userId: 'user-a',
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
    savedViewStore: createRegistrySavedViewStore({
      registryId: 'test-records',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      storage: memoryStorage(),
    }),
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

    await user.selectOptions(
      screen.getByLabelText('Filter by Status'),
      'available',
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

  it('has accessible column headers and Sheetbase density controls', async () => {
    const user = userEvent.setup()
    render(<RegistryComposition {...props()} />)
    const table = screen.getByRole('table', { name: 'Test records' })
    expect(
      within(table).getByRole('columnheader', { name: /Identifier/ }),
    ).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Table density'), 'compact')
    expect(table.getAttribute('data-density')).toBe('compact')
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

describe('RegistryComposition saved views', () => {
  it('saves and reapplies the query, columns and density for this user/workspace', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    render(<RegistryComposition {...props({ onQueryChange })} />)

    await user.selectOptions(screen.getByLabelText('Table density'), 'compact')
    await user.click(
      screen.getByRole('button', { name: 'Choose visible columns' }),
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('columnheader', { name: /Status/ })).toBeNull()
    await user.type(
      screen.getByLabelText('Saved view name'),
      'Available compact',
    )
    await user.click(screen.getByRole('button', { name: 'Save current view' }))

    expect(screen.getByLabelText('Saved views').textContent).toContain(
      'Available compact',
    )

    await user.click(
      screen.getByRole('button', { name: 'Choose visible columns' }),
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('columnheader', { name: /Status/ })).toBeTruthy()

    await user.selectOptions(screen.getByLabelText('Saved views'), [
      screen.getByRole('option', { name: 'Available compact' }),
    ])
    expect(onQueryChange).toHaveBeenLastCalledWith(query)
    expect(screen.getByRole('table').getAttribute('data-density')).toBe(
      'compact',
    )
    expect(screen.queryByRole('columnheader', { name: /Status/ })).toBeNull()
  })

  it('sanitises persisted queries against the current registry contract', async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn()
    const store = createRegistrySavedViewStore({
      registryId: 'test-records',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      storage: memoryStorage(),
    })
    store.save({
      id: 'unsafe',
      name: 'Stale view',
      state: {
        query: {
          pageIndex: 99,
          pageSize: 999,
          sorting: [
            { id: 'identifier', desc: false },
            { id: 'actions', desc: false },
            { id: 'secret', desc: true },
          ],
          grouping: ['secret', 'status'],
          filters: [
            { id: 'secret', value: 'leak' },
            { id: 'status', value: 'available' },
          ],
        },
        columnVisibility: { identifier: true, actions: false, secret: true },
        density: 'compact',
      },
    })
    render(
      <RegistryComposition
        {...props({ savedViewStore: store, onQueryChange })}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Saved views'), 'unsafe')
    expect(onQueryChange).toHaveBeenLastCalledWith({
      pageIndex: 0,
      pageSize: 25,
      sorting: [{ id: 'identifier', desc: false }],
      grouping: ['status'],
      filters: [{ id: 'status', value: 'available' }],
    })
  })

  it('keeps distinct saved views whose names normalise the same way', async () => {
    const user = userEvent.setup()
    render(<RegistryComposition {...props()} />)

    await user.type(screen.getByLabelText('Saved view name'), 'QC ready')
    await user.click(screen.getByRole('button', { name: 'Save current view' }))
    await user.type(screen.getByLabelText('Saved view name'), 'QC-ready')
    await user.click(screen.getByRole('button', { name: 'Save current view' }))

    expect(screen.getAllByRole('option', { name: /QC.?ready/i })).toHaveLength(
      2,
    )
  })
})
