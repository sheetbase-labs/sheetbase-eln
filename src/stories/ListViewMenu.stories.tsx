import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { SortingState } from '@tanstack/react-table'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { exportFileName } from '#/components/inventory/list-view-menu'
import type { ListView } from '#/lib/list-views'

/**
 * The gear at the end of every registry list's header
 * (`src/components/inventory/list-view-menu.tsx`): choose the columns to show,
 * reset sorting and columns, and export what is on screen as CSV or Excel.
 * The grid below keeps the choice in memory instead of saving it per person.
 */
interface Row {
  id: string
  name: string
  location: string
  quantity: number
}

const ROWS: Row[] = [
  {
    id: 'S-0003',
    name: 'Harvest lot HL-0934',
    location: 'Freezer 2',
    quantity: 12,
  },
  {
    id: 'S-0001',
    name: 'Clarified lysate',
    location: 'Cold room',
    quantity: 4,
  },
  { id: 'S-0002', name: 'Eluate pool', location: 'Freezer 1', quantity: 30 },
]

const COLUMNS: RegistryColumn<Row>[] = [
  { id: 'id', header: 'ID', accessorFn: (r) => r.id, enableHiding: false },
  { id: 'name', header: 'Name', accessorFn: (r) => r.name },
  { id: 'location', header: 'Location', accessorFn: (r) => r.location },
  { id: 'quantity', header: 'Quantity', accessorFn: (r) => r.quantity },
]

const meta = {
  title: 'Inventory/List view menu',
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

function Demo() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [hidden, setHidden] = useState<string[]>([])
  const view: ListView = {
    sorting,
    hidden,
    ready: true,
    setSorting: (u) => setSorting((c) => (typeof u === 'function' ? u(c) : u)),
    setHidden: (u) => setHidden((c) => (typeof u === 'function' ? u(c) : u)),
    reset: () => {
      setSorting([])
      setHidden([])
    },
  }
  return (
    <RegistryGrid
      label="Samples"
      exportName={exportFileName('Samples', 'csv')}
      rows={ROWS}
      columns={COLUMNS}
      getRowId={(r) => r.id}
      view={view}
    />
  )
}

/** Click a header to sort; open the gear to hide a column or export. */
export const Default: Story = { render: () => <Demo /> }
