import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { QueryClientProvider } from '@tanstack/react-query'

import { StockWithdrawButton } from '#/components/notebook/stock-withdraw-button'
import { stubDataClient, screenQueryClient } from './screen-stories'

/**
 * Withdraws a materials-block item from stock for the experiment. Pressing the
 * button would write to the stock ledger, so the stories show the button and
 * the withdrawn state it leaves behind; the data client refuses every write.
 */
const client = screenQueryClient()

const meta = {
  title: 'Notebook/Stock withdraw button',
  component: StockWithdrawButton,
  tags: ['autodocs'],
  args: {
    item: {
      kind: 'material',
      materialRecordId: 'material-1',
      identifier: 'RGT-0042',
      quantity: 5,
      unit: { symbol: 'mL' },
    },
    experimentId: 'experiment-1',
    onWithdrawn: () => {},
    client: stubDataClient(),
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof StockWithdrawButton>

export default meta

type Story = StoryObj<typeof meta>

/** Not yet withdrawn: the button offers it. */
export const Available: Story = {}

/** Withdrawn: the note replaces the button, so the row cannot be withdrawn twice. */
export const Withdrawn: Story = {
  args: { note: 'Withdrawn from stock 2026-10-21' },
}
