import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AttachmentChips } from '#/components/assist/chat/attachment-chips'

/** The files in a chat message or waiting in the box. */
const meta = {
  title: 'Assist/Attachment chips',
  component: AttachmentChips,
  args: {
    files: [
      { id: '1', name: 'picogreen-plate3.xlsx', kind: 'table' },
      { id: '2', name: 'taq-coa.pdf', kind: 'document' },
      { id: '3', name: 'gel-agarose-1pct.jpg', kind: 'image' },
    ],
  },
} satisfies Meta<typeof AttachmentChips>

export default meta

type Story = StoryObj<typeof meta>

/** On a sent message: no way to remove a file. */
export const Sent: Story = {}

/** Waiting in the box: removable, with one still being read. */
export const Waiting: Story = {
  args: { onRemove: () => undefined, reading: ['plate-4.csv'] },
}
