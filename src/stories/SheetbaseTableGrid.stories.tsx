import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetbaseTableGrid } from '#/components/sheet/sheetbase-grid'
import type { SheetbaseGridProps } from '#/components/sheet/sheetbase-grid'

/**
 * The grid façade: `SheetbaseGrid` lazily loads the `sheetbase-table` client
 * adapter, so stories render the loading shell first and the real engine once
 * the chunk resolves. Static rows only — nothing is persisted.
 */
const columns: SheetbaseGridProps['columns'] = [
  { id: 'time', label: 'Time (h)', source: 'bound', type: 'number' },
  { id: 'od', label: 'OD₆₀₀', source: 'bound', type: 'number' },
  {
    id: 'condition',
    label: 'Condition',
    source: 'bound',
    type: 'select',
    options: ['4 °C', '25 °C', '37 °C'],
  },
  {
    id: 'viability',
    label: 'Viability (%)',
    source: 'calculated',
    type: 'number',
    readOnly: true,
  },
]

const rows: SheetbaseGridProps['rows'] = [
  { id: 'row-1', cells: [0, 0.05, '4 °C', 91.4] },
  { id: 'row-2', cells: [2, 0.12, '4 °C', 90.1] },
  { id: 'row-3', cells: [4, 0.34, '25 °C', 78.6] },
]

const meta = {
  title: 'Sheet/Sheetbase table grid',
  component: SheetbaseTableGrid,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    columns,
    rows,
    ariaLabel: 'Plate reader kinetics',
    description: 'Absorbance readings from the 96-well plate run.',
    height: 320,
  },
} satisfies Meta<typeof SheetbaseTableGrid>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Derived columns are readable but never editable. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** Sorting and filtering restored from the sheet's saved view state. */
export const SortedAndFiltered: Story = {
  args: {
    sorting: true,
    filtering: true,
    sorts: [{ columnId: 'time', direction: 'asc' }],
    filters: [{ columnId: 'condition', operator: 'equals', value: '4 °C' }],
  },
}

/** A sheet larger than its container scrolls inside it. */
export const FillHeight: Story = {
  args: { height: 'fill' },
  decorators: [
    (Story) => (
      <div className="h-[420px] w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
}
