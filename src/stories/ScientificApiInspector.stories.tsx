import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScientificApiInspector } from '#/components/sheet/scientific-api-inspector'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

/**
 * The developer-facing API inspector: the REST paths and sample payloads for
 * the sheet it is mounted on. The details element is closed by default, so
 * open it in the canvas to read the examples.
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

const meta = {
  title: 'Sheet/Scientific API inspector',
  component: ScientificApiInspector,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { table },
} satisfies Meta<typeof ScientificApiInspector>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A selected row narrows the row examples to that row's id and version. */
export const WithSelectedRow: Story = {
  args: {
    selectedRowId: '0198d970-e266-4000-8000-000000000101',
    selectedRowVersion: 4,
  },
}

/** A selected column adds its field-specific examples. */
export const WithSelectedColumn: Story = {
  args: {
    selectedColumnId: '0198d970-e266-4000-8000-0000000000c2',
  },
}
