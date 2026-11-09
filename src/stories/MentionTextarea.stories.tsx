import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { userEvent, within } from 'storybook/test'

import { MentionTextarea } from '#/components/comments/mention-textarea'

/**
 * A comment box that offers workspace members when the caret is in an `@word`.
 * The members are a literal list, so the story needs no workspace.
 */
const candidates = [
  { userId: 'user-1', name: 'Ava Chen' },
  { userId: 'user-2', name: 'Priya Shah' },
  { userId: 'user-3', name: 'Ali Hassan' },
]

function Box({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)

  return (
    <MentionTextarea
      value={value}
      onChange={setValue}
      candidates={candidates}
      rows={4}
      placeholder="Write a comment"
      className="w-[420px] max-w-full"
    />
  )
}

const meta = {
  title: 'Comments/Mention textarea',
  component: MentionTextarea,
  tags: ['autodocs'],
  args: { value: '', onChange: () => {}, candidates },
} satisfies Meta<typeof MentionTextarea>

export default meta

type Story = StoryObj<typeof meta>

/** Empty: nothing is offered until someone types an `@`. */
export const Empty: Story = { render: () => <Box /> }

/** Typing `@` offers the members who match. */
export const Suggesting: Story = {
  render: () => <Box />,
  play: async ({ canvasElement }) => {
    const box = await within(canvasElement).findByRole('combobox')
    await userEvent.type(box, 'Can you check this, @p')
  },
}

/** With no members to offer, it is a plain text box. */
export const NoMembers: Story = {
  render: () => (
    <MentionTextarea
      value="Nobody to mention here."
      onChange={() => {}}
      candidates={[]}
      rows={3}
      className="w-[420px] max-w-full"
    />
  ),
}
