import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PipelineProposalUnreadable } from '#/components/notebook/pipeline-output-block-proposal'

/**
 * A proposal is pinned to this run but could not be read. The block says so
 * rather than showing stale content or offering a decision on it.
 */
const meta = {
  title: 'Notebook/Pipeline proposal unreadable',
  component: PipelineProposalUnreadable,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PipelineProposalUnreadable>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
