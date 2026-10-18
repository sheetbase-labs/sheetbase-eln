import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { EmptyHint } from '#/components/record/inspector-sections'

/**
 * The one-line hint every inspector section falls back to when its list is
 * empty. Stories put it beside a heading so the muted tone is judgeable.
 */
const meta = {
  title: 'Record/Inspector sections/Empty hint',
  component: EmptyHint,
  tags: ['autodocs'],
  args: { children: 'No linked records' },
} satisfies Meta<typeof EmptyHint>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const InSection: Story = {
  render: (args) => (
    <section className="w-72 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold text-fg">Files</h3>
      <EmptyHint {...args}>No attached files</EmptyHint>
    </section>
  ),
}

/** A long hint wraps without breaking the section rhythm. */
export const LongHint: Story = {
  args: {
    children:
      'No comments yet — reviewers can anchor a comment to any block in the submitted revision.',
  },
}
