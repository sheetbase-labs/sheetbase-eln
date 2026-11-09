import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  RegistryGrid,
  bandRow,
  rightAligned,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import { Status } from '#/components/ui/status'

/**
 * The registry grid the inventory lists share
 * (`src/components/inventory/registry-grid.tsx`): selectable rows that
 * drive an inspector, group bands, a right-aligned numeric column, and the
 * loading state. Rows are static fixtures.
 */
interface Row {
  id: string
  name: string
  type: string
  quantity: number
  status: 'ok' | 'warn'
}

const ROWS: Row[] = [
  {
    id: 'r1',
    name: 'Harvest lot HL-0934',
    type: 'Cell harvest',
    quantity: 4600,
    status: 'ok',
  },
  {
    id: 'r2',
    name: 'Harvest lot HL-0935',
    type: 'Cell harvest',
    quantity: 1200,
    status: 'warn',
  },
  {
    id: 'r3',
    name: 'Buffer A pool',
    type: 'Buffer',
    quantity: 900,
    status: 'ok',
  },
]

const COLUMNS: RegistryColumn<Row>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name },
  { id: 'type', header: 'Type', accessorFn: (row) => row.type },
  {
    id: 'quantity',
    header: 'Quantity (mL)',
    accessorFn: (row) => row.quantity.toLocaleString('en-GB'),
    ...rightAligned<Row>(),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Status tone={row.original.status}>
        {row.original.status === 'ok' ? 'In stock' : 'Low'}
      </Status>
    ),
  },
]

const meta = {
  title: 'Inventory/Registry grid',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-[320px] w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function Focusable({ rows }: { rows: RegistryRow<Row>[] }) {
  const [selected, setSelected] = useState<string | null>('r2')
  const focus = useRowFocus(selected, setSelected)

  return (
    <RegistryGrid
      label="Samples"
      rows={rows}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      onRowClick={(row) => setSelected(row.id)}
      {...focus}
    />
  )
}

/** A selectable grid: one row focused, as when an inspector shows it. */
export const Default: Story = {
  render: () => <Focusable rows={ROWS} />,
}

/** A grouped grid: bands between groups carry a label and the group's size. */
export const WithBands: Story = {
  render: () => (
    <Focusable
      rows={[
        bandRow('Cell harvest', 2),
        ROWS[0],
        ROWS[1],
        bandRow('Buffer', 1),
        ROWS[2],
      ]}
    />
  ),
}

/** A detail table whose rows are not a selection. */
export const NotSelectable: Story = {
  render: () => (
    <RegistryGrid
      label="Samples"
      rows={ROWS}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      selectable={false}
    />
  ),
}

/** Rows still loading. */
export const Loading: Story = {
  render: () => (
    <RegistryGrid
      label="Samples"
      rows={[]}
      columns={COLUMNS}
      getRowId={(row) => row.id}
      isLoading
    />
  ),
}
