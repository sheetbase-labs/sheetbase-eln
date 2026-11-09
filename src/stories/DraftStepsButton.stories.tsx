import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DraftStepsButton } from '#/components/assist/draft-steps'
import { withPageAi } from './assist-fixtures'

/**
 * "Draft steps" for a protocol being written. The draft is a list the person
 * edits before adding; nothing reaches the document until they choose to. It
 * renders nothing unless a real model is connected. A story has no model to
 * answer, so writing a draft shows the failed notice.
 */
const meta = {
  title: 'Assistant/Draft steps',
  component: DraftStepsButton,
  tags: ['autodocs'],
  args: {
    recordId: '0198d970-e266-4000-8000-000000000b01',
    title: 'Cell seeding',
    onAdd: async () => {},
  },
  decorators: [withPageAi('live')],
} satisfies Meta<typeof DraftStepsButton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SilentWithoutLiveModel: Story = {
  decorators: [withPageAi('off')],
  render: (args) => (
    <div className="text-label text-fg-muted">
      <DraftStepsButton {...args} />
      (nothing renders while AI is off)
    </div>
  ),
}
