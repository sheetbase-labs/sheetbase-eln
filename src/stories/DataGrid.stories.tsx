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
import {
  DataGridTable,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from '#/components/reui/data-grid/data-grid-table'
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
}: {
  rows?: Row[]
  withSelection?: boolean
  withPagination?: boolean
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
          <DataGridContainer>
            <DataGridTable />
          </DataGridContainer>
          {withPagination ? <DataGridPagination /> : null}
        </DataGrid>
      </FramePanel>
      <FrameFooter>
        <span className="num text-label text-fg-muted">{rows.length} rows</span>
      </FrameFooter>
    </Frame>
  )
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
