import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExplainThis } from '#/components/assist/explain-this'
import { withPageAi } from './assist-fixtures'

/**
 * "Explain this" for a dataset, chart or analysis. The facts come from the
 * page, worked out in code; the model only puts them into words. The answer
 * opens in a card beside the button, marked as AI-written, and is never saved.
 * It renders nothing when no real model is connected. A story has no model to
 * answer, so opening the card shows the failed state and its retry.
 */
const meta = {
  title: 'Assistant/Explain this',
  component: ExplainThis,
  tags: ['autodocs'],
  args: {
    subject: 'dataset',
    facts: '12 rows, 4 columns, 2 values outside the expected range.',
  },
  decorators: [withPageAi('live')],
} satisfies Meta<typeof ExplainThis>

export default meta

type Story = StoryObj<typeof meta>

export const Dataset: Story = {}

export const Chart: Story = { args: { subject: 'chart' } }

export const Analysis: Story = { args: { subject: 'analysis' } }

/** Only the built-in model, which cannot write words: nothing renders. */
export const SilentWithoutLiveModel: Story = {
  decorators: [withPageAi('built-in')],
  render: (args) => (
    <div className="flex items-center gap-2 text-label text-fg-muted">
      <ExplainThis {...args} />
      (nothing renders without a connected model)
    </div>
  ),
}
