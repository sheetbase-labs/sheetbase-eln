import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  FillFromText,
  addedFillFields,
} from '#/components/assist/fill-from-text'
import { withPageAi } from './assist-fixtures'

/**
 * Sits at the top of a create form. The person pastes text, or picks a PDF, and
 * the fields it names are filled in, ready to check and save. It renders nothing
 * unless a real model is connected. A story has no model to answer, so reading
 * shows the "could not read that" notice.
 */
const FIELDS = addedFillFields([
  { fieldName: 'supplier', label: 'Supplier', logicalType: 'text' },
  { fieldName: 'received', label: 'Received', logicalType: 'date' },
  { fieldName: 'purity', label: 'Purity (%)', logicalType: 'decimal' },
  { fieldName: 'notes', label: 'Notes', logicalType: 'rich_text' },
])

const meta = {
  title: 'Assistant/Fill from text',
  component: FillFromText,
  tags: ['autodocs'],
  args: { fields: FIELDS, onFill: () => {} },
  decorators: [
    withPageAi('live'),
    (Story) => (
      <div className="w-[460px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FillFromText>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

/** Silent without a connected model. */
export const SilentWithoutLiveModel: Story = {
  decorators: [withPageAi('off')],
  render: (args) => (
    <div className="text-label text-fg-muted">
      <FillFromText {...args} />
      (nothing renders while AI is off)
    </div>
  ),
}
