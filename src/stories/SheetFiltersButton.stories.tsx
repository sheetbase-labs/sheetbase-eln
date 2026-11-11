import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetFiltersButton } from '#/components/sheet/sheet-filters-popover'
import type {
  SheetbaseGridColumn,
  SheetbaseGridFilter,
} from '#/components/sheet/sheetbase-grid'

/**
 * The sheet toolbar's Filters button. It lists every filter on the sheet and
 * edits the same filters the column menus set; the count shows on the button
 * while any are on.
 */
const columns: SheetbaseGridColumn[] = [
  { id: 'train', label: 'Filter train', type: 'text', source: 'local' },
  { id: 'load', label: 'Load', type: 'number', source: 'local' },
  {
    id: 'clarity',
    label: 'Visual clarity',
    type: 'text',
    source: 'local',
    options: ['Clear', 'Slight haze', 'Hazy'],
  },
]

function FiltersDemo({
  initial,
  compact,
}: {
  initial: SheetbaseGridFilter[]
  compact?: boolean
}) {
  const [filters, setFilters] = useState(initial)

  return (
    <SheetFiltersButton
      columns={columns}
      filters={filters}
      onChange={setFilters}
      compact={compact}
    />
  )
}

const meta = {
  title: 'Sheet/Filters button',
  component: FiltersDemo,
  args: { initial: [] },
} satisfies Meta<typeof FiltersDemo>

export default meta

type Story = StoryObj<typeof meta>

export const NoFilters: Story = {}

export const OneFilter: Story = {
  args: {
    initial: [{ columnId: 'clarity', operator: 'equals', value: 'Clear' }],
  },
}

export const Phone: Story = {
  args: {
    compact: true,
    initial: [{ columnId: 'load', operator: 'equals', value: 150 }],
  },
}
