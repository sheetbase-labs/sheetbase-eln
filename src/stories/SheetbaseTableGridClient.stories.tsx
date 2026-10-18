import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetbaseTableGridClient } from '#/components/sheet/sheetbase-table-grid-client'
import type { SheetbaseGridProps } from '#/components/sheet/sheetbase-grid'

/**
 * COMP-06.2/.3 — the `sheetbase-table` adapter, rendering the real engine
 * over static rows. No queries and no persistence: writes reach
 * `onCellsChange`, which the stories leave unbound.
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
    id: 'sampled',
    label: 'Sampled',
    source: 'local',
    type: 'checkbox',
  },
  {
    id: 'sample',
    label: 'Sample',
    source: 'bound',
    type: 'record',
    readOnly: true,
  },
]

const rows: SheetbaseGridProps['rows'] = [
  { id: 'row-1', cells: [0, 0.05, '4 °C', true, 'SMP-2026-0142'] },
  { id: 'row-2', cells: [2, 0.12, '4 °C', true, 'SMP-2026-0142'] },
  { id: 'row-3', cells: [4, 0.34, '25 °C', false, 'SMP-2026-0143'] },
  { id: 'row-4', cells: [6, 0.68, '25 °C', false, 'SMP-2026-0143'] },
]

const meta = {
  title: 'Sheet/Table grid client',
  component: SheetbaseTableGridClient,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { columns, rows, ariaLabel: 'Plate reader kinetics', height: 320 },
} satisfies Meta<typeof SheetbaseTableGridClient>
export default meta
type Story = StoryObj<typeof meta>

/** Bound, local and derived-style columns in one sheet. */
export const Default: Story = {}

/** Read-only: selection and copy stay live, editing does not. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** Spare rows at the end for entry. */
export const SpareRows: Story = { args: { spareRows: 3 } }

/** The draft “new run” row after the last populated row. */
export const AppendRow: Story = {
  args: { appendRow: { label: 'New run' }, spareRows: 3 },
}

/** A sheet with its schema but no rows yet — the empty state is the grid. */
export const NoRows: Story = { args: { rows: [] } }

/** Column resizing and reordering enabled, as a full workspace sets them. */
export const ResizableAndReorderable: Story = {
  args: { resizable: true, reorderable: true, rowHeaders: false },
}

/** Narrow viewport: the engine scrolls horizontally rather than squashing. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[420px] max-w-full">
        <Story />
      </div>
    ),
  ],
}
