import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PartFormDialog,
  SplitIntoPartsDialog,
} from '#/components/notebook/parts-menu'

/**
 * Adding or changing a part, and splitting a notebook that has none. The
 * writes are only sent on submit; the stories record nothing. The dialogs call
 * mutations, so they need a client in context, as the router gives them.
 */
const meta = {
  title: 'Notebook/Parts dialogs',
  component: PartFormDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    recordId: '0198d970-e266-4000-8000-0000000000a1',
    onClose: () => {},
    onSaved: () => {},
  },
} satisfies Meta<typeof PartFormDialog>
export default meta
type Story = StoryObj<typeof meta>

/** A new part starts empty, after the last one. */
export const Add: Story = {}

/** Divide a notebook that has no parts at its level-2 headings. */
export const Split: Story = {
  render: (args) => (
    <SplitIntoPartsDialog
      recordId={args.recordId}
      onClose={args.onClose}
      points={[
        { title: 'Seed cells', firstBlockId: 'b1' },
        { title: 'Dose with compound', firstBlockId: 'b2' },
        { title: 'Read the plate', firstBlockId: 'b3' },
      ]}
    />
  ),
}
