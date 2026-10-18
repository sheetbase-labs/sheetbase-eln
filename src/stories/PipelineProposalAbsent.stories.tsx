import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineProposalAbsent } from '#/components/notebook/pipeline-output-block-proposal'

/**
 * No proposal is pinned to the run this block renders, so the block states
 * that instead of rendering inert decision controls. `PipelineProposalUnreadable`
 * covers the other fallback (a pinned proposal that could not be read).
 */
const meta = {
  title: 'Notebook/Pipeline proposal absent',
  component: PipelineProposalAbsent,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PipelineProposalAbsent>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
