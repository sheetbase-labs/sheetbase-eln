import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScientificTransferPanel } from '#/components/sheet/scientific-transfer-panel'
import type {
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

/**
 * Sheet export/transfer panel. The panel only writes when Export is pressed
 * (it records the export and downloads two files), so the stories render its
 * statically reachable states: a transferable sheet and one over the
 * receipt's row ceiling.
 */
const table: ScientificTableWire = {
  id: '0198d970-e266-4000-8000-000000000030',
  resource_name: 'scientific_rows_3',
  name: 'Virus stability — plate readings',
  schema_version: 2,
  lifecycle: 'active',
  columns: [
    {
      id: '0198d970-e266-4000-8000-0000000000c1',
      field_name: 'time',
      label: 'Time (h)',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: 'h',
      validation: {},
      width: null,
      options: [],
    },
    {
      id: '0198d970-e266-4000-8000-0000000000c2',
      field_name: 'od',
      label: 'OD₆₀₀',
      display_order: 2,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: null,
      options: [],
    },
  ],
}

function row(index: number): ScientificRowWire {
  return {
    id: `0198d970-e266-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    version: 1,
    time: index * 2,
    od: 0.05 * index,
  }
}

const rows = Array.from({ length: 8 }, (_, index) => row(index + 1))

const meta = {
  title: 'Sheet/Scientific transfer panel',
  component: ScientificTransferPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { table, rows },
} satisfies Meta<typeof ScientificTransferPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** An empty sheet still exports its schema and unit metadata. */
export const NoRows: Story = { args: { rows: [] } }

/** Over the receipt's ceiling the panel states the limit instead of failing
 * after the click. */
export const OverRowLimit: Story = {
  args: {
    rows: Array.from({ length: 5001 }, (_, index) => row(index + 1)),
  },
}
