import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import type { BulkSelection } from '#/components/inventory/bulk-selection'
import { screenQueryClient } from './screen-stories'

/**
 * The strip above a list that acts on the ticked rows
 * (`src/components/inventory/record-bulk-bar.tsx`). It is static here: the
 * actions go through the data client, which a story does not reach.
 */
function selection(ids: string[]): BulkSelection {
  return {
    ids,
    count: ids.length,
    has: (id) => ids.includes(id),
    toggle: () => {},
    setMany: () => {},
    retain: () => {},
    replace: () => {},
    clear: () => {},
  }
}

const meta = {
  title: 'Inventory/Record bulk bar',
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/** Someone who can edit: every action. */
export const Editor: Story = {
  render: () => (
    <RecordBulkBar
      selection={selection(['a', 'b', 'c'])}
      kind="sample"
      move="location"
      canWrite
      onChanged={() => {}}
    />
  ),
}

/** A viewer can still print labels, nothing else. */
export const ViewerOnly: Story = {
  render: () => (
    <RecordBulkBar
      selection={selection(['a'])}
      canWrite={false}
      onChanged={() => {}}
    />
  ),
}
