import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { UndoPanel } from '#/components/assist/chat/undo-panel'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * Undo for a card or plan that has run. At rest it is one small button; in the
 * corner of a card it sits top right beside the title. Pressing it asks the
 * server what would be put back, so a story that never reaches the server shows
 * the failed state with its Keep it button.
 */
const client = screenQueryClient()

const meta = {
  title: 'Assistant/Undo panel',
  component: UndoPanel,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: { route: screenRoutes('/', []), path: '/' },
    },
  },
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="relative w-[420px] rounded-xl border border-border bg-surface p-3">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    setId: '0198d970-e266-4000-8000-0000000000b1',
  },
} satisfies Meta<typeof UndoPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The button rests in the top right of the card around it. */
export const InCorner: Story = {
  args: { corner: true, setId: '0198d970-e266-4000-8000-0000000000b2' },
}
