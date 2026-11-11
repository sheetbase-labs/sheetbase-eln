import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  SheetCellHistory,
  SheetChangeList,
} from '#/components/sheet/sheet-changes-panel'
import type { SheetChangeRow } from '#/components/sheet/sheet-changes-panel'

/**
 * Show changes: the change list under the grid and one cell's history beside
 * it. The old value is struck through; a first entry reads "entered".
 */
const rows: SheetChangeRow[] = [
  {
    id: '1',
    cellKey: 'row-9|load',
    who: 'Gareth P.',
    when: '09:41',
    cell: 'Row 9 · Load',
    before: '150 L/m²',
    after: '146 L/m²',
    beforeKnown: true,
    reason: 'Throughput from filtration log',
  },
  {
    id: '2',
    cellKey: 'row-8|turbidity',
    who: 'Gareth P.',
    when: '09:42',
    cell: 'Row 8 · Turbidity',
    before: '24.3 NTU',
    after: '23.9 NTU',
    beforeKnown: true,
    reason: null,
  },
  {
    id: '3',
    cellKey: 'row-9|load',
    who: 'Gareth P.',
    when: '24 Sep',
    cell: 'Row 9 · Load',
    before: '',
    after: '150 L/m²',
    beforeKnown: true,
    reason: null,
  },
]

const meta = {
  title: 'Sheet/Show changes',
  component: SheetChangeList,
  args: {
    rows,
    todayCount: 2,
    selectedCellKey: 'row-9|load',
    onSelect: () => {},
  },
} satisfies Meta<typeof SheetChangeList>

export default meta

type Story = StoryObj<typeof meta>

export const ChangeList: Story = {}

export const NoChanges: Story = { args: { rows: [], todayCount: 0 } }

export const CellHistory: Story = {
  render: () => (
    <div className="flex h-72">
      <SheetCellHistory
        cell={{
          title: 'Row 9 · Load',
          value: '146 L/m²',
          rows: rows.filter((row) => row.cellKey === 'row-9|load'),
        }}
      />
    </div>
  ),
}
