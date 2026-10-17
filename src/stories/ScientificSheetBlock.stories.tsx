import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScientificSheetBlock } from '#/components/sheet/scientific-sheet-block'
import type { NotebookBlock } from '#/lib/notebook-data'

/**
 * The `scientific_sheet` notebook block. It reads its table by id on mount,
 * so the stories show what a reader sees before that read returns and what a
 * misconfigured block reports. Editing states need a live table.
 */
const block: NotebookBlock = {
  id: '0198d970-e266-4000-8000-0000000000b1',
  recordId: '0198d970-e266-4000-8000-0000000000a1',
  type: 'scientific_sheet',
  payload: {
    tableId: '0198d970-e266-4000-8000-000000000030',
    title: 'Plate readings',
  },
  payloadSchemaVersion: 1,
  order: 3,
  version: 2,
}

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise(() => {}) },
    },
  })
}

const meta = {
  title: 'Sheet/Scientific sheet block',
  component: ScientificSheetBlock,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="w-[880px] max-w-full rounded-md border border-border">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { block },
} satisfies Meta<typeof ScientificSheetBlock>
export default meta
type Story = StoryObj<typeof meta>

/** The table read in flight: the block keeps its chrome and states it. */
export const Loading: Story = {}

/** Read-only in a frozen revision or a submitted submission. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** A block whose payload carries no table id reports that instead of
 * rendering an empty grid. */
export const MissingTableId: Story = {
  args: {
    block: { ...block, payload: { title: 'Plate readings' } },
  },
}

/** The configuring state a writer sees — the block still reads its table. */
export const Editing: Story = {
  args: { block: { ...block, version: 3 } },
  render: (args) => {
    const [value] = useState(args.block)
    return <ScientificSheetBlock block={value} />
  },
}
