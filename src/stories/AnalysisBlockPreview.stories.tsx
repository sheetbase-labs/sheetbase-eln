import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisBlockPreview } from '#/components/notebook/block-preview'

/**
 * The analysis block's read view (SCI-03). Its payload names a saved
 * analysis; the preview renders what the block carries — the cited method,
 * the frozen numbers when they exist, and an honest state when none is
 * configured.
 */
const meta = {
  title: 'Notebook/Analysis block preview',
  component: AnalysisBlockPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[680px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {},
} satisfies Meta<typeof AnalysisBlockPreview>
export default meta
type Story = StoryObj<typeof meta>

/** Nothing configured yet: the block says what to do. */
export const Unconfigured: Story = { args: { payload: {} } }

/** A named analysis with its provenance and no frozen numbers. */
export const NamedAnalysis: Story = {
  args: {
    payload: {
      title: 'Recovery by storage condition',
      provenance: 'Grouped descriptive statistics · ANOVA',
      definitionId: 'analysis-1',
    },
  },
}
