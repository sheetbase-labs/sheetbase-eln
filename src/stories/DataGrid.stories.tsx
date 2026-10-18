import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { useTable } from '@tanstack/react-table'
import type {
  ColumnDef,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
} from '#/components/reui/data-grid/data-grid'
import type { DataGridFeatures } from '#/components/reui/data-grid/data-grid'
import { DataGridPagination } from '#/components/reui/data-grid/data-grid-pagination'
import { DataGridScrollArea } from '#/components/reui/data-grid/data-grid-scroll-area'
import {
  DataGridTable,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '#/components/reui/data-grid/data-grid-table'
import { DataGridTableVirtual } from '#/components/reui/data-grid/data-grid-table-virtual'
import { mergeDataGridI18n } from '#/components/reui/data-grid/data-grid-i18n'
import type { DataGridI18nLabels } from '#/components/reui/data-grid/data-grid-i18n'
import { Frame, FrameFooter, FramePanel } from '#/components/reui/frame'

/**
 * ReUI `data-grid` (ADR-0055), installed from the pinned base-nova registry and
 * placed under `src/components/reui/data-grid/`. The rows are fixture text; no
 * record, dataset or route is read.
 */
interface Row {
  id: string
  name: string
  unit: string
  value: string
  note: string
}

const ROWS: Row[] = [
  {
    id: 'SMP-2231',
    name: 'Lentiviral vector',
    unit: 'TU/mL',
    value: '8.2 × 10⁸',
    note: 'In stock',
  },
  {
    id: 'SMP-2232',
    name: 'Plasmid DNA',
    unit: 'ng/µL',
    value: '412',
    note: 'In stock',
  },
  {
    id: 'SMP-2233',
    name: 'Total RNA',
    unit: 'ng/µL',
    value: '96',
    note: 'Low stock',
  },
  {
    id: 'SMP-2234',
    name: 'Antibody',
    unit: 'mg/mL',
    value: '1.0',
    note: 'In stock',
  },
  {
    id: 'SMP-2235',
    name: 'Cell lysate',
    unit: 'mg/mL',
    value: '2.4',
    note: 'Expiring',
  },
]

function FixtureGrid({
  rows = ROWS,
  withSelection = false,
  withPagination = false,
  virtual = false,
  labels,
}: {
  rows?: Row[]
  withSelection?: boolean
  withPagination?: boolean
  /** The virtual table under the grid's own scroll area, as `/protocols` composes it. */
  virtual?: boolean
  /** A partial override of the grid's built-in strings. */
  labels?: Partial<DataGridI18nLabels>
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const columns = useMemo<ColumnDef<DataGridFeatures, Row>[]>(() => {
    const base: ColumnDef<DataGridFeatures, Row>[] = [
      {
        accessorKey: 'id',
        header: 'ID',
        cell: ({ row }) => <span className="mono">{row.original.id}</span>,
      },
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { cellClassName: 'min-w-[200px]' },
      },
      {
        accessorKey: 'unit',
        header: 'Unit',
        meta: { cellClassName: 'text-fg-muted' },
      },
      {
        accessorKey: 'value',
        header: 'Value',
        meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      },
      {
        accessorKey: 'note',
        header: 'Status',
        meta: { cellClassName: 'text-fg-muted' },
      },
    ]
    if (!withSelection) return base
    return [
      {
        id: 'select',
        header: () => <DataGridTableRowSelectAll />,
        cell: ({ row }) => <DataGridTableRowSelect row={row} />,
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      ...base,
    ]
  }, [withSelection])

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: rows,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    manualPagination: !withPagination,
    enableRowSelection: withSelection,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 3 },
      columnPinning: { start: [], end: [] },
    },
  })

  return (
    <Frame spacing="sm" className="w-[720px]">
      <FramePanel className="p-0">
        <DataGrid
          table={table}
          recordCount={rows.length}
          i18n={labels ? mergeDataGridI18n({ labels }) : undefined}
          onRowClick={(row) =>
            withSelection && setRowSelection({ [row.id]: true })
          }
          tableLayout={{
            width: 'auto',
            columnsPinnable: true,
            headerSticky: true,
          }}
          tableClassNames={{ base: 'whitespace-nowrap' }}
        >
          {virtual ? (
            // The composed shape `/protocols` ships: the grid's own scroll area
            // holding the virtual table, which measures rows rather than
            // rendering them all. Needs a bounded box to scroll within.
            <div className="h-[320px]">
              <DataGridScrollArea orientation="both">
                <DataGridTableVirtual
                  height="100%"
                  estimateSize={33}
                  overscan={12}
                />
              </DataGridScrollArea>
            </div>
          ) : (
            <DataGridContainer>
              <DataGridTable />
            </DataGridContainer>
          )}
          {withPagination ? <DataGridPagination /> : null}
        </DataGrid>
      </FramePanel>
      <FrameFooter>
        <span className="num text-label text-fg-muted">{rows.length} rows</span>
      </FrameFooter>
    </Frame>
  )
}

/**
 * A row set large enough that virtualisation is doing something: the table
 * measures the rows and mounts the window it needs, rather than 200 rows at
 * once. Scroll it to see rows enter and leave.
 */
const MANY_ROWS: Row[] = Array.from({ length: 200 }, (_, i) => ({
  id: `SMP-${2300 + i}`,
  name: i % 7 === 0 ? 'Lentiviral vector, research grade' : `Material ${i + 1}`,
  unit: 'ng/µL',
  value: (512 - (i % 97)).toFixed(0),
  note: i % 11 === 0 ? 'Low stock' : 'In stock',
}))

/**
 * A caller may replace any of the grid's built-in strings; the partial is
 * merged over the defaults, and a more specific component prop still wins.
 */
const LABELS: Partial<DataGridI18nLabels> = {
  tableLabel: 'Materials',
  empty: 'No materials registered in this project.',
  allRowsLoaded: 'End of list',
}

const meta = {
  title: 'UI/DataGrid',
  component: FixtureGrid,
  tags: ['autodocs'],
  args: { withSelection: false, withPagination: false },
} satisfies Meta<typeof FixtureGrid>
export default meta
type Story = StoryObj<typeof meta>

/** The default state: rows, sorting by header, and the frame's footer. */
export const Default: Story = {}

/** Row selection, the state the protocols registry adopts. */
export const WithSelection: Story = { args: { withSelection: true } }

/** Pagination, for a grid whose data is a page rather than the whole set. */
export const WithPagination: Story = { args: { withPagination: true } }

/** No rows: the grid's own empty message, with the header intact. */
export const Empty: Story = { args: { rows: [] } }

/** The virtual table, as `/protocols` composes it, over 200 rows. */
export const VirtualRows: Story = {
  args: { rows: MANY_ROWS, virtual: true },
}

/** The row-selection column over the virtual table, as the registry screen ships it. */
export const VirtualRowsWithSelection: Story = {
  args: { rows: MANY_ROWS, virtual: true, withSelection: true },
}

/** The same grid reading a caller's own words for every built-in string. */
export const CustomLabels: Story = {
  args: { rows: [], labels: LABELS },
}
